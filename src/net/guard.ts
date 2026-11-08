// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { lookup as dnsLookup } from 'node:dns/promises';
import { canonicalIp, classifyIp, parseIp } from './ip.js';

/** A resolved address. */
export interface ResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

/** DNS resolver signature (injectable for tests). Must return every address for the name. */
export type Resolver = (hostname: string) => Promise<readonly ResolvedAddress[]>;

/** Default resolver: the operating system resolver, all addresses. */
export const systemResolver: Resolver = async (hostname) => {
  const results = await dnsLookup(hostname, { all: true, order: 'verbatim' });
  return results.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 }));
};

/** Network policy for the SSRF guard. */
export interface NetworkPolicy {
  /**
   * Exact IP addresses that may be fetched even though they are in a blocked
   * range (for example a staging server on your own private network).
   * Cloud metadata addresses can never be allowed.
   */
  readonly allowAddresses: readonly string[];
  /** DNS resolver. */
  readonly resolver: Resolver;
}

/** Thrown when a URL or address is refused by the guard. */
export class BlockedRequestError extends Error {
  /** Machine-readable reason, for example "loopback" or "scheme". */
  readonly reason: string;
  constructor(message: string, reason: string) {
    super(message);
    this.name = 'BlockedRequestError';
    this.reason = reason;
  }
}

const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.home.arpa', '.lan', '.intranet', '.corp'];
const BLOCKED_HOSTS = new Set(['localhost', 'localhost.localdomain', 'metadata', 'metadata.google.internal', 'instance-data']);

const MAX_URL_LENGTH = 2048;

/**
 * Validate a URL string before any network activity: http/https only, no
 * credentials, length cap, no blocked host names. Returns the parsed URL.
 *
 * @throws BlockedRequestError
 */
export function checkUrlSyntax(input: string): URL {
  if (typeof input !== 'string' || input.length === 0 || input.length > MAX_URL_LENGTH) {
    throw new BlockedRequestError('URL is empty or longer than 2048 characters', 'length');
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new BlockedRequestError('URL does not parse', 'syntax');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlockedRequestError(`Scheme ${url.protocol} is not allowed (http and https only)`, 'scheme');
  }
  if (url.username !== '' || url.password !== '') {
    throw new BlockedRequestError('URLs with credentials are not allowed', 'credentials');
  }
  const host = hostOf(url);
  if (host.length === 0) throw new BlockedRequestError('URL has no host', 'syntax');
  if (BLOCKED_HOSTS.has(host) || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new BlockedRequestError(`Host ${host} is an internal name`, 'internal-name');
  }
  if (!host.includes('.') && parseIp(host) === null) {
    throw new BlockedRequestError(`Host ${host} is a single-label name`, 'internal-name');
  }
  return url;
}

/** Host name without IPv6 brackets and trailing dot, lower case. */
export function hostOf(url: URL): string {
  let h = url.hostname.toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  if (h.endsWith('.')) h = h.slice(0, -1);
  return h;
}

/**
 * Check a single IP address against the policy.
 *
 * @throws BlockedRequestError when the address is blocked and not allow-listed.
 */
export function checkAddress(address: string, policy: Pick<NetworkPolicy, 'allowAddresses'>): void {
  const verdict = classifyIp(address);
  if (!verdict.blocked) return;
  if (!verdict.metadata) {
    const canon = canonicalIp(address);
    if (canon !== null && policy.allowAddresses.some((a) => canonicalIp(a) === canon)) return;
  }
  throw new BlockedRequestError(`Address ${address} is not allowed (${verdict.reason})`, verdict.reason);
}

/**
 * Validate a URL and resolve its host. Every resolved address must pass;
 * a single blocked address blocks the request (defeats mixed DNS answers).
 * Returns the address to connect to (pin it to defeat DNS rebinding).
 *
 * @throws BlockedRequestError
 */
export async function resolveAndCheck(input: string | URL, policy: NetworkPolicy): Promise<{ url: URL; address: ResolvedAddress }> {
  const url = checkUrlSyntax(typeof input === 'string' ? input : input.href);
  const host = hostOf(url);
  const literal = parseIp(host);
  if (literal !== null) {
    checkAddress(host, policy);
    return { url, address: { address: host, family: literal.family } };
  }
  let addresses: readonly ResolvedAddress[];
  try {
    addresses = await policy.resolver(host);
  } catch {
    throw new BlockedRequestError(`Host ${host} did not resolve`, 'dns');
  }
  if (addresses.length === 0) throw new BlockedRequestError(`Host ${host} did not resolve`, 'dns');
  for (const a of addresses) checkAddress(a.address, policy);
  const first = addresses[0];
  if (first === undefined) throw new BlockedRequestError(`Host ${host} did not resolve`, 'dns');
  return { url, address: first };
}
