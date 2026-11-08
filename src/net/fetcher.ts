// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import http from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import zlib from 'node:zlib';
import { BlockedRequestError, hostOf, resolveAndCheck, type NetworkPolicy } from './guard.js';

/** Limits applied to every fetched response. */
export interface FetchLimits {
  /** Maximum decoded body size of one response, in bytes. */
  readonly maxResponseBytes: number;
  /** Time limit for one request, in milliseconds. */
  readonly requestTimeoutMs: number;
}

/** Shared byte budget for a whole scan. */
export class ByteBudget {
  private used = 0;
  constructor(readonly maxBytes: number) {}
  /** Record bytes; throws when the budget is exhausted. */
  consume(bytes: number): void {
    this.used += bytes;
    if (this.used > this.maxBytes) {
      throw new BlockedRequestError(`Scan byte budget of ${this.maxBytes} bytes exhausted`, 'budget');
    }
  }
  get usedBytes(): number {
    return this.used;
  }
}

/** Outgoing request. */
export interface OutgoingRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: Buffer | undefined;
}

/** Fetched response, decoded. */
export interface FetchedResponse {
  readonly status: number;
  /** Lower-case header names. Multiple `set-cookie` values are joined with "\n". */
  readonly headers: Record<string, string>;
  readonly body: Buffer;
}

/** Request headers never forwarded. */
const DROP_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'keep-alive',
  'proxy-authorization',
  'proxy-connection',
  'authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'accept-encoding',
]);

/** Response headers never passed back to the browser. */
const DROP_RESPONSE_HEADERS = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'alt-svc',
  'proxy-authenticate',
  'trailer',
  'upgrade',
]);

const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

/** Filter request headers before sending. Exported for tests. */
export function sanitizeRequestHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (DROP_REQUEST_HEADERS.has(lower) || lower.startsWith(':') || lower.startsWith('proxy-')) continue;
    if (/[\r\n]/.test(value)) continue;
    out[lower] = value;
  }
  out['accept-encoding'] = 'gzip, deflate, br';
  return out;
}

function decode(body: Buffer, encoding: string | undefined, maxBytes: number): Buffer {
  const enc = (encoding ?? '').trim().toLowerCase();
  const opts = { maxOutputLength: maxBytes };
  try {
    if (enc === '' || enc === 'identity') return body;
    if (enc === 'gzip' || enc === 'x-gzip') return zlib.gunzipSync(body, opts);
    if (enc === 'deflate') {
      try {
        return zlib.inflateSync(body, opts);
      } catch (error) {
        if (error instanceof RangeError) throw error;
        return zlib.inflateRawSync(body, opts);
      }
    }
    if (enc === 'br') return zlib.brotliDecompressSync(body, opts);
  } catch (error) {
    if (error instanceof RangeError) {
      throw new BlockedRequestError(`Decoded response exceeds ${maxBytes} bytes`, 'size');
    }
    throw new BlockedRequestError('Response body could not be decoded', 'encoding');
  }
  throw new BlockedRequestError(`Unsupported content-encoding ${enc}`, 'encoding');
}

/**
 * Fetch one URL with the SSRF guard. Resolves DNS once, checks every address
 * and connects only to the checked address (pinned), so a DNS answer that
 * changes between check and connect cannot reach a blocked address.
 * Redirects are NOT followed; the caller sees the 3xx response.
 *
 * @throws BlockedRequestError
 */
export async function guardedFetch(
  request: OutgoingRequest,
  policy: NetworkPolicy,
  limits: FetchLimits,
  budget: ByteBudget,
): Promise<FetchedResponse> {
  const method = request.method.toUpperCase();
  if (!ALLOWED_METHODS.has(method)) throw new BlockedRequestError(`Method ${method} not allowed`, 'method');
  const { url, address } = await resolveAndCheck(request.url, policy);
  const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
    if (options.all === true) {
      callback(null, [{ address: address.address, family: address.family }]);
    } else {
      callback(null, address.address, address.family);
    }
  };
  const isHttps = url.protocol === 'https:';
  const host = hostOf(url);
  const headers = sanitizeRequestHeaders(request.headers);
  if (request.body !== undefined) headers['content-length'] = String(request.body.length);

  return await new Promise<FetchedResponse>((resolveOuter, rejectOuter) => {
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const resolve = (value: FetchedResponse): void => {
      finish(() => {
        resolveOuter(value);
      });
    };
    const reject = (error: Error): void => {
      finish(() => {
        rejectOuter(error);
      });
    };
    const options: https.RequestOptions = {
      protocol: url.protocol,
      hostname: host,
      port: url.port === '' ? undefined : Number(url.port),
      path: `${url.pathname}${url.search}`,
      method,
      headers,
      lookup: pinnedLookup,
      agent: false,
      timeout: limits.requestTimeoutMs,
      maxHeaderSize: 32 * 1024,
      ...(isHttps ? { servername: address.address === host ? undefined : host } : {}),
    };
    const req = (isHttps ? https : http).request(options, (res) => {
      const chunks: Buffer[] = [];
      let received = 0;
      res.on('data', (chunk: Buffer) => {
        received += chunk.length;
        try {
          if (received > limits.maxResponseBytes) {
            throw new BlockedRequestError(`Response exceeds ${limits.maxResponseBytes} bytes`, 'size');
          }
          budget.consume(chunk.length);
        } catch (error) {
          req.destroy();
          reject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        try {
          const raw = Buffer.concat(chunks);
          const encoding = res.headers['content-encoding'];
          const body = method === 'HEAD' ? Buffer.alloc(0) : decode(raw, encoding, limits.maxResponseBytes);
          const out: Record<string, string> = {};
          for (const [name, value] of Object.entries(res.headers)) {
            if (value === undefined || DROP_RESPONSE_HEADERS.has(name)) continue;
            out[name] = Array.isArray(value) ? value.join(name === 'set-cookie' ? '\n' : ', ') : value;
          }
          resolve({ status: res.statusCode ?? 502, headers: out, body });
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
      res.on('error', (error) => {
        reject(error);
      });
    });
    // Total deadline (the socket `timeout` option only covers idle time).
    const timer = setTimeout(() => {
      const error = new BlockedRequestError(`Request timed out after ${limits.requestTimeoutMs} ms`, 'timeout');
      req.destroy(error);
      reject(error);
    }, limits.requestTimeoutMs);
    req.on('timeout', () => {
      req.destroy(new BlockedRequestError(`Request timed out after ${limits.requestTimeoutMs} ms`, 'timeout'));
    });
    req.on('error', (error) => {
      reject(error);
    });
    if (request.body !== undefined) req.write(request.body);
    req.end();
  });
}
