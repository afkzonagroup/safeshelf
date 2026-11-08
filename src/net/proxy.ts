// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Guard proxy: a local HTTP/HTTPS forward proxy that the browser must use for
 * all traffic. It is the network enforcement point of the SSRF guard.
 *
 * Why a proxy as well as route interception: Playwright does not call route
 * handlers for redirect hops, WebSockets or some browser-internal requests.
 * Every connection the browser makes still has to pass this proxy, which
 * resolves the host, checks every address and connects only to the checked
 * address (pinned, so DNS rebinding cannot swap it).
 *
 * - Listens on 127.0.0.1 only, random port, random credentials (constant-time check).
 * - Plain HTTP: absolute-form requests are forwarded with a per-response size cap.
 * - HTTPS: CONNECT tunnels to the pinned address; bytes in both directions are counted against the scan budget.
 * - Upgrade requests (plain WebSocket) are refused.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import { BlockedRequestError, checkUrlSyntax, hostOf, resolveAndCheck, type NetworkPolicy } from './guard.js';
import type { ByteBudget, FetchLimits } from './fetcher.js';

/** A request the guard refused. */
export interface BlockedRequest {
  readonly url: string;
  readonly reason: string;
  /** Which layer refused it: the route check before sending, or the guard proxy at connect time. */
  readonly stage: 'route' | 'proxy';
}

/** Running proxy. */
export interface GuardProxy {
  readonly server: string;
  readonly username: string;
  readonly password: string;
  /** Requests refused so far (capped at 200 entries). */
  readonly blocked: readonly BlockedRequest[];
  close(): Promise<void>;
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
]);

const MAX_BLOCKED_LOG = 200;

/** Methods a browser sends through a forward proxy (CONNECT is handled separately). */
const PROXY_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/** Start the guard proxy. */
export async function startGuardProxy(policy: NetworkPolicy, limits: FetchLimits, budget: ByteBudget): Promise<GuardProxy> {
  const username = 'safeshelf';
  const password = randomBytes(24).toString('base64url');
  const expected = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  const blocked: BlockedRequest[] = [];
  const sockets = new Set<Duplex>();

  const record = (url: string, reason: string): void => {
    if (blocked.length < MAX_BLOCKED_LOG) blocked.push({ url: url.slice(0, 300), reason, stage: 'proxy' });
  };
  const authorised = (header: string | undefined): boolean => header !== undefined && safeEqual(header, expected);
  const reasonOf = (error: unknown): string => (error instanceof BlockedRequestError ? error.reason : 'error');

  const server = http.createServer((req, res) => {
    if (!authorised(req.headers['proxy-authorization'])) {
      res.writeHead(407, { 'proxy-authenticate': 'Basic realm="safeshelf"', 'content-type': 'text/plain' });
      res.end('Proxy authentication required');
      return;
    }
    const target = req.url ?? '';
    void (async () => {
      let pinned: Awaited<ReturnType<typeof resolveAndCheck>>;
      try {
        if (!PROXY_METHODS.has((req.method ?? '').toUpperCase())) throw new BlockedRequestError('Method not allowed', 'method');
        const url = checkUrlSyntax(target);
        if (url.protocol !== 'http:') throw new BlockedRequestError('Only http is proxied without CONNECT', 'scheme');
        pinned = await resolveAndCheck(url, policy);
      } catch (error) {
        record(target, reasonOf(error));
        res.writeHead(403, { 'content-type': 'text/plain' });
        res.end('Blocked by Safeshelf network guard');
        return;
      }
      const { url, address } = pinned;
      const headers: http.OutgoingHttpHeaders = {};
      for (const [name, value] of Object.entries(req.headers)) {
        if (value === undefined || HOP_BY_HOP.has(name)) continue;
        headers[name] = value;
      }
      headers.host = url.host;
      const upstream = http.request(
        {
          hostname: hostOf(url),
          port: url.port === '' ? 80 : Number(url.port),
          path: `${url.pathname}${url.search}`,
          method: req.method ?? 'GET',
          headers,
          agent: false,
          lookup: (_h, options, cb) => {
            if (options.all === true) cb(null, [{ address: address.address, family: address.family }]);
            else cb(null, address.address, address.family);
          },
          timeout: limits.requestTimeoutMs,
        },
        (upRes) => {
          const outHeaders: http.OutgoingHttpHeaders = {};
          for (const [name, value] of Object.entries(upRes.headers)) {
            if (value === undefined || HOP_BY_HOP.has(name)) continue;
            outHeaders[name] = value;
          }
          res.writeHead(upRes.statusCode ?? 502, outHeaders);
          let received = 0;
          upRes.on('data', (chunk: Buffer) => {
            received += chunk.length;
            try {
              if (received > limits.maxResponseBytes) {
                throw new BlockedRequestError('Response too large', 'size');
              }
              budget.consume(chunk.length);
            } catch (error) {
              record(target, reasonOf(error));
              upRes.destroy();
              res.destroy();
              return;
            }
            res.write(chunk);
          });
          upRes.on('end', () => res.end());
          upRes.on('error', () => res.destroy());
        },
      );
      const deadline = setTimeout(() => {
        record(target, 'timeout');
        upstream.destroy();
        res.destroy();
      }, limits.requestTimeoutMs);
      upstream.on('close', () => {
        clearTimeout(deadline);
      });
      upstream.on('timeout', () => upstream.destroy());
      upstream.on('error', () => {
        if (!res.headersSent) {
          res.writeHead(502, { 'content-type': 'text/plain' });
          res.end('Upstream error');
        } else {
          res.destroy();
        }
      });
      // Request bodies count against the scan budget too, so a page cannot make
      // the scanner upload without limit.
      req.on('data', (chunk: Buffer) => {
        try {
          budget.consume(chunk.length);
        } catch (error) {
          record(target, reasonOf(error));
          upstream.destroy();
          res.destroy();
          return;
        }
        upstream.write(chunk);
      });
      req.on('end', () => upstream.end());
    })();
  });

  server.on('connect', (req: http.IncomingMessage, clientSocket: Duplex, head: Buffer) => {
    sockets.add(clientSocket);
    clientSocket.on('close', () => sockets.delete(clientSocket));
    clientSocket.on('error', () => clientSocket.destroy());
    if (!authorised(req.headers['proxy-authorization'])) {
      clientSocket.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="safeshelf"\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    const target = req.url ?? '';
    void (async () => {
      let address: { address: string; family: 4 | 6 };
      let port: number;
      try {
        if (!/^[a-zA-Z0-9.\-[\]:]{1,300}:\d{1,5}$/.test(target)) throw new BlockedRequestError('Bad CONNECT target', 'syntax');
        const url = checkUrlSyntax(`https://${target}/`);
        port = url.port === '' ? 443 : Number(url.port);
        ({ address } = await resolveAndCheck(url, policy));
      } catch (error) {
        record(`https://${target}`, reasonOf(error));
        clientSocket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
        return;
      }
      const upstream = net.connect({ host: address.address, port, family: address.family });
      sockets.add(upstream);
      upstream.on('close', () => sockets.delete(upstream));
      upstream.setTimeout(limits.requestTimeoutMs, () => upstream.destroy());
      clientSocket.on('close', () => upstream.destroy());
      upstream.on('error', () => clientSocket.destroy());
      upstream.on('connect', () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        const count = (chunk: Buffer): boolean => {
          try {
            budget.consume(chunk.length);
            return true;
          } catch (error) {
            record(`https://${target}`, reasonOf(error));
            upstream.destroy();
            clientSocket.destroy();
            return false;
          }
        };
        // Bytes the client sent together with the CONNECT request count too.
        if (head.length > 0 && count(head)) upstream.write(head);
        upstream.on('data', (chunk: Buffer) => {
          if (count(chunk)) clientSocket.write(chunk);
        });
        clientSocket.on('data', (chunk: Buffer) => {
          if (count(chunk)) upstream.write(chunk);
        });
        upstream.on('end', () => clientSocket.end());
        clientSocket.on('end', () => upstream.end());
      });
    })();
  });

  server.on('upgrade', (req: http.IncomingMessage, socket: Duplex) => {
    record(req.url ?? '', 'websocket');
    socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
  });
  server.on('clientError', (_error, socket: Duplex) => {
    socket.destroy();
  });
  server.headersTimeout = 30_000;
  server.requestTimeout = limits.requestTimeoutMs;
  server.maxHeadersCount = 200;

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const addr = server.address();
  if (addr === null || typeof addr === 'string') throw new Error('Guard proxy did not bind');

  return {
    server: `http://127.0.0.1:${String(addr.port)}`,
    username,
    password,
    blocked,
    close: async () => {
      for (const s of sockets) s.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}
