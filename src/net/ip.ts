// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pure IP address parsing and classification for the SSRF guard.
 *
 * IPv4 parsing follows the inet_aton rules browsers and many resolvers accept
 * (decimal, octal and hexadecimal parts; 1 to 4 parts), so that "2130706433",
 * "0177.0.0.1" and "0x7f.1" are all recognised as 127.0.0.1.
 */

/** Parsed address: IPv4 as a 32-bit number, IPv6 as 8 16-bit groups. */
export type ParsedIp = { readonly family: 4; readonly value: number } | { readonly family: 6; readonly groups: readonly number[] };

function parseIpv4Part(part: string): number | null {
  if (part.length === 0 || part.length > 34) return null;
  let radix = 10;
  let digits = part;
  if (/^0x/i.test(part)) {
    radix = 16;
    digits = part.slice(2);
    if (digits.length === 0) return 0;
    if (!/^[0-9a-f]+$/i.test(digits)) return null;
  } else if (part.length > 1 && part.startsWith('0')) {
    radix = 8;
    digits = part.slice(1);
    if (!/^[0-7]+$/.test(digits)) return null;
  } else if (!/^[0-9]+$/.test(part)) {
    return null;
  }
  const value = Number.parseInt(digits, radix);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Parse an IPv4 address in any inet_aton form. Returns the 32-bit value or null.
 *
 * @example
 * ```ts
 * parseIpv4('0177.0.0.1'); // 2130706433
 * ```
 */
export function parseIpv4(input: string): number | null {
  if (input.length === 0 || input.length > 64) return null;
  const raw = input.endsWith('.') ? input.slice(0, -1) : input;
  const parts = raw.split('.');
  if (parts.length < 1 || parts.length > 4) return null;
  const nums: number[] = [];
  for (const part of parts) {
    const n = parseIpv4Part(part);
    if (n === null) return null;
    nums.push(n);
  }
  const last = nums[nums.length - 1];
  if (last === undefined) return null;
  const head = nums.slice(0, -1);
  if (head.some((n) => n > 255)) return null;
  const lastMax = 2 ** (8 * (5 - nums.length)) - 1;
  if (last > lastMax) return null;
  let value = 0;
  head.forEach((n, i) => {
    value += n * 2 ** (8 * (3 - i));
  });
  value += last;
  return value >>> 0;
}

/**
 * Parse an IPv6 address (with optional brackets, zone id and embedded IPv4).
 * Returns 8 groups or null.
 */
export function parseIpv6(input: string): number[] | null {
  let s = input;
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  const zone = s.indexOf('%');
  if (zone !== -1) s = s.slice(0, zone);
  if (s.length < 2 || s.length > 64 || !s.includes(':')) return null;
  if (!/^[0-9a-fA-F:.]+$/.test(s)) return null;

  const lastColon = s.lastIndexOf(':');
  const lastPart = s.slice(lastColon + 1);
  if (lastPart.includes('.')) {
    // Embedded dotted IPv4 tail: rewrite as two hex groups, then parse as usual.
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(lastPart)) return null;
    const octets = lastPart.split('.').map((o) => Number.parseInt(o, 10));
    if (octets.some((o) => o > 255)) return null;
    const [a = 0, b = 0, c = 0, d = 0] = octets;
    s = `${s.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const doubleColon = s.indexOf('::');
  if (doubleColon !== s.lastIndexOf('::')) return null;
  const parseGroups = (part: string): number[] | null => {
    if (part.length === 0) return [];
    const out: number[] = [];
    for (const g of part.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      out.push(Number.parseInt(g, 16));
    }
    return out;
  };

  if (doubleColon === -1) {
    const parsed = parseGroups(s);
    return parsed?.length === 8 ? parsed : null;
  }
  const left = parseGroups(s.slice(0, doubleColon));
  const right = parseGroups(s.slice(doubleColon + 2));
  if (left === null || right === null) return null;
  const fill = 8 - left.length - right.length;
  if (fill < 1) return null;
  return [...left, ...new Array<number>(fill).fill(0), ...right];
}

/** Parse an IPv4 or IPv6 literal. */
export function parseIp(input: string): ParsedIp | null {
  const v4 = parseIpv4(input);
  if (v4 !== null) return { family: 4, value: v4 };
  const v6 = parseIpv6(input);
  if (v6 !== null) return { family: 6, groups: v6 };
  return null;
}

/** Format a 32-bit IPv4 value as dotted quad. */
export function formatIpv4(value: number): string {
  return [24, 16, 8, 0].map((shift) => String((value >>> shift) & 255)).join('.');
}

interface V4Range {
  readonly base: number;
  readonly bits: number;
  readonly reason: string;
}

const v4 = (cidr: string, reason: string): V4Range => {
  const [addr = '', bits = '32'] = cidr.split('/');
  const base = parseIpv4(addr);
  if (base === null) throw new Error(`bad range ${cidr}`);
  return { base, bits: Number.parseInt(bits, 10), reason };
};

/** IPv4 ranges that are never fetched. */
export const BLOCKED_V4: readonly V4Range[] = Object.freeze([
  v4('0.0.0.0/8', 'this-network'),
  v4('10.0.0.0/8', 'private'),
  v4('100.64.0.0/10', 'cgnat'),
  v4('127.0.0.0/8', 'loopback'),
  v4('169.254.0.0/16', 'link-local'),
  v4('172.16.0.0/12', 'private'),
  v4('192.0.0.0/24', 'ietf-protocol'),
  v4('192.0.2.0/24', 'documentation'),
  v4('192.88.99.0/24', '6to4-relay'),
  v4('192.168.0.0/16', 'private'),
  v4('198.18.0.0/15', 'benchmarking'),
  v4('198.51.100.0/24', 'documentation'),
  v4('203.0.113.0/24', 'documentation'),
  v4('224.0.0.0/4', 'multicast'),
  v4('240.0.0.0/4', 'reserved'),
  v4('255.255.255.255/32', 'broadcast'),
]);

/** Cloud metadata endpoints. Blocked even if an allow-list entry would match. */
export const METADATA_V4: readonly number[] = Object.freeze(
  ['169.254.169.254', '169.254.170.2', '100.100.100.200', '168.63.129.16', '192.0.0.192'].map((a) => {
    const n = parseIpv4(a);
    if (n === null) throw new Error('bad metadata ip');
    return n;
  }),
);

const inV4 = (value: number, r: V4Range): boolean => {
  if (r.bits === 0) return true;
  const mask = r.bits === 32 ? 0xffffffff : (~((1 << (32 - r.bits)) - 1)) >>> 0;
  return (value & mask) >>> 0 === (r.base & mask) >>> 0;
};

/** Result of classifying an address. */
export interface IpVerdict {
  readonly blocked: boolean;
  /** Why the address is blocked, for example "loopback". Empty when allowed. */
  readonly reason: string;
  /** True for cloud metadata endpoints (never allow-listable). */
  readonly metadata: boolean;
}

const ALLOWED: IpVerdict = Object.freeze({ blocked: false, reason: '', metadata: false });

function classifyV4(value: number): IpVerdict {
  if (METADATA_V4.includes(value)) return { blocked: true, reason: 'metadata', metadata: true };
  for (const r of BLOCKED_V4) {
    if (inV4(value, r)) return { blocked: true, reason: r.reason, metadata: false };
  }
  return ALLOWED;
}

function classifyV6(g: readonly number[]): IpVerdict {
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = g;
  const embedded = ((g6 << 16) | g7) >>> 0;
  const allZeroPrefix = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
  // fd00:ec2::254 (AWS IMDS over IPv6)
  if (g0 === 0xfd00 && g1 === 0xec2 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 0x254) {
    return { blocked: true, reason: 'metadata', metadata: true };
  }
  if (allZeroPrefix && g5 === 0 && g6 === 0 && g7 === 0) return { blocked: true, reason: 'unspecified', metadata: false };
  if (allZeroPrefix && g5 === 0 && g6 === 0 && g7 === 1) return { blocked: true, reason: 'loopback', metadata: false };
  // IPv4-mapped ::ffff:0:0/96 and IPv4-translated ::ffff:0:0:0/96: judge the embedded IPv4 address.
  if (allZeroPrefix && g5 === 0xffff) {
    const inner = classifyV4(embedded);
    return inner.blocked ? inner : { blocked: true, reason: 'ipv4-mapped', metadata: false };
  }
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0xffff && g5 === 0) {
    return { blocked: true, reason: 'ipv4-translated', metadata: false };
  }
  // Deprecated IPv4-compatible ::/96
  if (allZeroPrefix && g5 === 0) return { blocked: true, reason: 'ipv4-compatible', metadata: false };
  // NAT64 64:ff9b::/96 and 64:ff9b:1::/48
  if (g0 === 0x64 && g1 === 0xff9b) return { blocked: true, reason: 'nat64', metadata: false };
  // Discard-only 100::/64
  if (g0 === 0x100 && g1 === 0 && g2 === 0 && g3 === 0) return { blocked: true, reason: 'discard', metadata: false };
  // 2001::/23 IETF protocol assignments (includes Teredo 2001::/32)
  if (g0 === 0x2001 && g1 < 0x200) return { blocked: true, reason: 'ietf-protocol', metadata: false };
  // 2001:db8::/32 documentation
  if (g0 === 0x2001 && g1 === 0xdb8) return { blocked: true, reason: 'documentation', metadata: false };
  // 2002::/16 6to4
  if (g0 === 0x2002) return { blocked: true, reason: '6to4', metadata: false };
  // 3fff::/20 documentation (RFC 9637)
  if (g0 === 0x3fff && g1 < 0x1000) return { blocked: true, reason: 'documentation', metadata: false };
  // fc00::/7 unique local
  if ((g0 & 0xfe00) === 0xfc00) return { blocked: true, reason: 'unique-local', metadata: false };
  // fe80::/10 link-local
  if ((g0 & 0xffc0) === 0xfe80) return { blocked: true, reason: 'link-local', metadata: false };
  // fec0::/10 site-local (deprecated)
  if ((g0 & 0xffc0) === 0xfec0) return { blocked: true, reason: 'site-local', metadata: false };
  // ff00::/8 multicast
  if ((g0 & 0xff00) === 0xff00) return { blocked: true, reason: 'multicast', metadata: false };
  // Only global unicast 2000::/3 is allowed.
  if ((g0 & 0xe000) !== 0x2000) return { blocked: true, reason: 'not-global-unicast', metadata: false };
  return ALLOWED;
}

/**
 * Classify an IP literal. Anything that does not parse is blocked.
 *
 * @example
 * ```ts
 * classifyIp('::ffff:127.0.0.1').blocked; // true
 * classifyIp('93.184.216.34').blocked;   // false
 * ```
 */
export function classifyIp(input: string): IpVerdict {
  const parsed = parseIp(input);
  if (parsed === null) return { blocked: true, reason: 'unparseable', metadata: false };
  return parsed.family === 4 ? classifyV4(parsed.value) : classifyV6(parsed.groups);
}

/** Canonical text form used for allow-list comparison. */
export function canonicalIp(input: string): string | null {
  const parsed = parseIp(input);
  if (parsed === null) return null;
  if (parsed.family === 4) return formatIpv4(parsed.value);
  return parsed.groups.map((g) => g.toString(16)).join(':');
}
