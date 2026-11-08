// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import zlib from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ByteBudget, guardedFetch, sanitizeRequestHeaders } from '../../src/net/fetcher.js';
import { BlockedRequestError, type NetworkPolicy } from '../../src/net/guard.js';
import { startGuardProxy, type GuardProxy } from '../../src/net/proxy.js';
import { guardedGet } from '../../src/net/get.js';
import { fetchRobots } from '../../src/net/robots-fetch.js';
import { parseRobots } from '../../src/net/robots.js';

let server: http.Server;
let port = 0;
let lastHeaders: http.IncomingHttpHeaders = {};
let hits = 0;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits += 1;
    lastHeaders = req.headers;
    const url = new URL(req.url ?? '/', 'http://x');
    switch (url.pathname) {
      case '/big':
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('x'.repeat(100_000));
        return;
      case '/bomb': {
        const body = zlib.gzipSync(Buffer.alloc(5_000_000));
        res.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'gzip' });
        res.end(body);
        return;
      }
      case '/gzip':
        res.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'gzip', 'set-cookie': ['a=1', 'b=2'] });
        res.end(zlib.gzipSync(Buffer.from('hello')));
        return;
      case '/slow':
        setTimeout(() => res.end('late'), 3000);
        return;
      case '/drip': {
        // One byte every 100 ms: the socket never goes idle, so only the total deadline stops it.
        res.writeHead(200, { 'content-type': 'text/plain' });
        const timer = setInterval(() => res.write('x'), 100);
        setTimeout(() => {
          clearInterval(timer);
          res.end();
        }, 4000);
        res.on('close', () => { clearInterval(timer); });
        return;
      }
      case '/redirect':
        res.writeHead(302, { location: 'http://169.254.169.254/' });
        res.end();
        return;
      case '/robots.txt':
        if ((req.headers.host ?? '').startsWith('redir.test')) {
          res.writeHead(302, { location: 'http://169.254.169.254/robots.txt' });
          res.end();
          return;
        }
        if ((req.headers.host ?? '').startsWith('five.test')) {
          res.writeHead(503, { 'content-type': 'text/plain' });
          res.end('busy');
          return;
        }
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('User-agent: *\nDisallow: /private\nSitemap: https://local.test/sitemap.xml\n');
        return;
      case '/hop':
        res.writeHead(302, { location: `/hop2` });
        res.end();
        return;
      case '/hop2':
        res.writeHead(302, { location: 'http://[::ffff:7f00:1]/' });
        res.end();
        return;
      case '/loop':
        res.writeHead(302, { location: '/loop' });
        res.end();
        return;
      default:
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => { resolve(); }));
});

const policy = (allow: string[] = ['127.0.0.1']): NetworkPolicy => ({
  allowAddresses: allow,
  resolver: (host) =>
    host === 'local.test' || host === 'redir.test' || host === 'five.test'
      ? Promise.resolve([{ address: '127.0.0.1', family: 4 }])
      : host === 'rebind.test'
        ? Promise.resolve([{ address: '10.9.9.9', family: 4 }])
        : Promise.reject(new Error('ENOTFOUND')),
});
const limits = { maxResponseBytes: 50_000, requestTimeoutMs: 1000 };
const url = (path: string): string => `http://local.test:${String(port)}${path}`;
const get = (path: string, p = policy(), budget = new ByteBudget(10_000_000)) =>
  guardedFetch({ url: url(path), method: 'GET', headers: { authorization: 'Bearer secret', cookie: 'sid=1', 'x-ok': 'yes', 'proxy-authorization': 'x' } }, p, limits, budget);

const reason = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'allowed';
  } catch (error) {
    return error instanceof BlockedRequestError ? error.reason : `other:${String(error)}`;
  }
};

describe('guardedFetch', () => {
  it('fetches through the pinned, checked address and strips credentials', async () => {
    const res = await get('/');
    expect(res.status).toBe(200);
    expect(res.body.toString()).toBe('ok');
    expect(lastHeaders.authorization).toBeUndefined();
    expect(lastHeaders['proxy-authorization']).toBeUndefined();
    expect(lastHeaders['x-ok']).toBe('yes');
    expect(lastHeaders.host).toBe(`local.test:${String(port)}`);
  });

  it('refuses a blocked address without connecting', async () => {
    const before = hits;
    expect(await reason(get('/', policy([])))).toBe('loopback');
    expect(hits).toBe(before);
  });

  it('refuses names resolving to private ranges', async () => {
    expect(
      await reason(guardedFetch({ url: 'http://rebind.test/', method: 'GET', headers: {} }, policy(), limits, new ByteBudget(1e6))),
    ).toBe('private');
  });

  it('does not follow redirects (caller re-checks each hop)', async () => {
    const res = await get('/redirect');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('http://169.254.169.254/');
  });

  it('caps response size', async () => {
    expect(await reason(get('/big'))).toBe('size');
  });

  it('caps decompressed size (gzip bomb)', async () => {
    expect(await reason(get('/bomb'))).toBe('size');
  });

  it('decodes gzip and joins set-cookie with newlines', async () => {
    const res = await get('/gzip');
    expect(res.body.toString()).toBe('hello');
    expect(res.headers['set-cookie']).toBe('a=1\nb=2');
    expect(res.headers['content-encoding']).toBeUndefined();
  });

  it('enforces the total deadline', async () => {
    expect(await reason(get('/slow'))).toBe('timeout');
  });

  it('enforces the total deadline when the server keeps sending a little', async () => {
    const started = Date.now();
    expect(await reason(get('/drip'))).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(2500);
  });

  it('enforces the scan byte budget', async () => {
    const budget = new ByteBudget(10);
    expect(await reason(get('/big', policy(), budget))).toMatch(/budget|size/);
    // With a response cap above the body size, only the scan budget can stop it.
    const roomy = { maxResponseBytes: 1_000_000, requestTimeoutMs: 1000 };
    expect(await reason(guardedFetch({ url: url('/big'), method: 'GET', headers: {} }, policy(), roomy, new ByteBudget(20_000)))).toBe('budget');
  });

  it('refuses unsupported methods and schemes', async () => {
    expect(await reason(guardedFetch({ url: url('/'), method: 'TRACE', headers: {} }, policy(), limits, new ByteBudget(1e6)))).toBe('method');
    expect(await reason(guardedFetch({ url: 'file:///etc/passwd', method: 'GET', headers: {} }, policy(), limits, new ByteBudget(1e6)))).toBe('scheme');
  });

  it('sanitizes request headers', () => {
    const h = sanitizeRequestHeaders({ Authorization: 'x', Host: 'evil', 'X-Bad': 'a\r\nb', Cookie: 'c=1', 'Proxy-Foo': 'y' });
    expect(h).toEqual({ cookie: 'c=1', 'accept-encoding': 'gzip, deflate, br' });
  });
});

describe('guardedGet', () => {
  const ctx = (maxRedirects = 5) => ({ policy: policy(), limits, budget: new ByteBudget(1e7), maxRedirects });
  it('re-checks every redirect hop and refuses one that reaches a blocked address', async () => {
    expect(await reason(guardedGet(url('/hop'), ctx(), {}))).toBe('loopback');
  });
  it('stops redirect loops', async () => {
    expect(await reason(guardedGet(url('/loop'), ctx(3), {}))).toBe('redirects');
  });
  it('applies a smaller per-call size cap', async () => {
    expect(await reason(guardedGet(url('/big'), ctx(), {}, 1000))).toBe('size');
  });
  it('returns the final URL', async () => {
    const res = await guardedGet(url('/'), ctx(), {});
    expect(res.finalUrl).toBe(url('/'));
    expect(res.body.toString()).toBe('ok');
  });
});

describe('guard proxy', () => {
  let proxy: GuardProxy;
  beforeAll(async () => {
    proxy = await startGuardProxy(policy(), limits, new ByteBudget(10_000_000));
  });
  afterAll(async () => {
    await proxy.close();
  });
  const proxyPort = (): number => Number(new URL(proxy.server).port);
  const auth = (): string => `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64')}`;

  const viaProxy = (target: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> =>
    new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: proxyPort(), path: target, method: 'GET', headers }, (res) => {
        let body = '';
        res.on('data', (c: Buffer) => (body += c.toString()));
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body });
        });
      });
      req.on('error', reject);
      req.end();
    });

  const connect = (target: string, headers: Record<string, string> = {}): Promise<string> =>
    new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: proxyPort(), method: 'CONNECT', path: target, headers });
      req.on('connect', (res, socket) => {
        socket.destroy();
        resolve(String(res.statusCode));
      });
      req.on('response', (res) => {
        resolve(String(res.statusCode));
      });
      req.on('error', reject);
      req.end();
    });

  it('listens on loopback only and requires its credentials', async () => {
    expect(new URL(proxy.server).hostname).toBe('127.0.0.1');
    expect((await viaProxy(url('/'))).status).toBe(407);
    expect((await viaProxy(url('/'), { 'proxy-authorization': 'Basic d3Jvbmc6d3Jvbmc=' })).status).toBe(407);
    expect(await connect(`local.test:${String(port)}`)).toBe('407');
  });

  it('forwards allowed HTTP requests', async () => {
    const res = await viaProxy(url('/'), { 'proxy-authorization': auth() });
    expect(res.status).toBe(200);
    expect(res.body).toBe('ok');
  });

  it('refuses blocked HTTP targets and records them', async () => {
    const res = await viaProxy('http://169.254.169.254/latest/', { 'proxy-authorization': auth() });
    expect(res.status).toBe(403);
    expect(proxy.blocked.some((b) => b.reason === 'metadata')).toBe(true);
    expect((await viaProxy('http://[::ffff:127.0.0.1]/', { 'proxy-authorization': auth() })).status).toBe(403);
    expect((await viaProxy('ftp://local.test/', { 'proxy-authorization': auth() })).status).toBe(403);
  });

  it('refuses methods a browser does not proxy', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: proxyPort(), path: url('/'), method: 'TRACE', headers: { 'proxy-authorization': auth() } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(403);
  });

  it('refuses CONNECT to blocked or malformed targets', async () => {
    expect(await connect('169.254.169.254:443', { 'proxy-authorization': auth() })).toBe('403');
    expect(await connect('10.0.0.1:443', { 'proxy-authorization': auth() })).toBe('403');
    expect(await connect('rebind.test:443', { 'proxy-authorization': auth() })).toBe('403');
    expect(await connect('bad%target:443', { 'proxy-authorization': auth() })).toBe('403');
    expect(await connect('local.test', { 'proxy-authorization': auth() })).toBe('403');
  });

  it('opens CONNECT tunnels to allowed targets', async () => {
    expect(await connect(`local.test:${String(port)}`, { 'proxy-authorization': auth() })).toBe('200');
  });

  it('caps proxied response size', async () => {
    const res = await viaProxy(url('/big'), { 'proxy-authorization': auth() }).catch(() => ({ status: -1, body: '' }));
    expect(res.body.length).toBeLessThan(100_000);
  });

  it('refuses plain WebSocket upgrades', async () => {
    const status = await new Promise<string>((resolve) => {
      const socket = net.connect(proxyPort(), '127.0.0.1', () => {
        socket.write(`GET ${url('/ws')} HTTP/1.1\r\nHost: local.test\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nProxy-Authorization: ${auth()}\r\n\r\n`);
      });
      socket.on('data', (d: Buffer) => {
        resolve(d.toString().split('\r\n')[0] ?? '');
        socket.destroy();
      });
    });
    expect(status).toContain('403');
  });
});

describe('scan budget in the proxy', () => {
  const roomy = { maxResponseBytes: 1_000_000, requestTimeoutMs: 2000 };
  const authOf = (proxy: GuardProxy): string => `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64')}`;

  it('charges proxied HTTP responses to the scan budget', async () => {
    const budget = new ByteBudget(20_000);
    const proxy = await startGuardProxy(policy(), roomy, budget);
    try {
      const body = await new Promise<string>((resolve) => {
        const req = http.request({ host: '127.0.0.1', port: Number(new URL(proxy.server).port), path: url('/big'), headers: { 'proxy-authorization': authOf(proxy) } }, (res) => {
          let b = '';
          res.on('data', (c: Buffer) => (b += c.toString()));
          res.on('end', () => { resolve(b); });
          res.on('error', () => { resolve(b); });
          res.on('aborted', () => { resolve(b); });
        });
        req.on('error', () => { resolve(''); });
        req.end();
      });
      expect(body.length).toBeLessThan(100_000);
      expect(proxy.blocked.map((b) => b.reason)).toContain('budget');
    } finally {
      await proxy.close();
    }
  });

  /** Open a CONNECT tunnel, write `upload` bytes through it and collect what comes back until it closes. */
  const tunnel = (proxy: GuardProxy, write: (socket: net.Socket) => void): Promise<number> =>
    new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: Number(new URL(proxy.server).port), method: 'CONNECT', path: `local.test:${String(port)}`, headers: { 'proxy-authorization': authOf(proxy) } });
      req.on('connect', (_res, socket: net.Socket) => {
        let received = 0;
        socket.on('data', (c: Buffer) => (received += c.length));
        socket.on('close', () => { resolve(received); });
        socket.on('error', () => undefined);
        write(socket);
      });
      req.on('error', reject);
      req.end();
    });

  it('charges bytes coming back through a CONNECT tunnel', async () => {
    const budget = new ByteBudget(20_000);
    const proxy = await startGuardProxy(policy(), roomy, budget);
    try {
      const received = await tunnel(proxy, (s) => s.write('GET /big HTTP/1.1\r\nHost: local.test\r\nConnection: close\r\n\r\n'));
      expect(received).toBeLessThan(100_000);
      expect(proxy.blocked.map((b) => b.reason)).toContain('budget');
    } finally {
      await proxy.close();
    }
  });

  it('charges bytes sent in the same packet as the CONNECT request', async () => {
    const budget = new ByteBudget(1_000_000);
    const proxy = await startGuardProxy(policy(), roomy, budget);
    try {
      const extra = Buffer.alloc(50_000, 0x41);
      await new Promise<void>((resolve) => {
        const socket = net.connect(Number(new URL(proxy.server).port), '127.0.0.1', () => {
          socket.write(Buffer.concat([Buffer.from(`CONNECT local.test:${String(port)} HTTP/1.1\r\nHost: local.test\r\nProxy-Authorization: ${authOf(proxy)}\r\n\r\n`), extra]));
        });
        socket.on('data', () => {
          socket.destroy();
          resolve();
        });
        socket.on('error', () => { resolve(); });
      });
      await new Promise((r) => setTimeout(r, 200));
      expect(budget.usedBytes).toBeGreaterThanOrEqual(50_000);
    } finally {
      await proxy.close();
    }
  });

  it('charges bytes sent out through a CONNECT tunnel', async () => {
    const budget = new ByteBudget(20_000);
    const proxy = await startGuardProxy(policy(), roomy, budget);
    try {
      await tunnel(proxy, (s) => {
        s.write(`POST / HTTP/1.1\r\nHost: local.test\r\nContent-Length: 200000\r\n\r\n`);
        s.write(Buffer.alloc(200_000));
      });
      expect(proxy.blocked.map((b) => b.reason)).toContain('budget');
      expect(budget.usedBytes).toBeGreaterThan(20_000);
    } finally {
      await proxy.close();
    }
  });
});

describe('DNS rebinding and upload budget', () => {
  it('the proxy resolves once and connects to the address it checked, even if DNS changes afterwards', async () => {
    let calls = 0;
    // First answer passes the check; every later answer is the metadata address.
    const flipping: NetworkPolicy = {
      allowAddresses: ['127.0.0.1'],
      resolver: () => {
        calls += 1;
        return Promise.resolve([{ address: calls === 1 ? '127.0.0.1' : '169.254.169.254', family: 4 }]);
      },
    };
    const proxy = await startGuardProxy(flipping, limits, new ByteBudget(10_000_000));
    try {
      const auth = `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64')}`;
      const status = await new Promise<number>((resolve, reject) => {
        const req = http.request(
          { host: '127.0.0.1', port: Number(new URL(proxy.server).port), path: `http://flip.test:${String(port)}/`, headers: { 'proxy-authorization': auth } },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on('error', reject);
        req.end();
      });
      expect(status).toBe(200);
      expect(calls).toBe(1);
      // The next request sees the rebound answer and is refused.
      const second = await new Promise<number>((resolve, reject) => {
        const req = http.request(
          { host: '127.0.0.1', port: Number(new URL(proxy.server).port), path: `http://flip.test:${String(port)}/`, headers: { 'proxy-authorization': auth } },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on('error', reject);
        req.end();
      });
      expect(second).toBe(403);
    } finally {
      await proxy.close();
    }
  });

  it('request bodies sent through the proxy count against the scan budget', async () => {
    const budget = new ByteBudget(64 * 1024);
    const proxy = await startGuardProxy(policy(), limits, budget);
    try {
      const auth = `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64')}`;
      await new Promise<void>((resolve) => {
        const req = http.request({ host: '127.0.0.1', port: Number(new URL(proxy.server).port), method: 'POST', path: url('/'), headers: { 'proxy-authorization': auth } }, (res) => {
          res.resume();
          res.on('end', resolve);
          res.on('error', () => { resolve(); });
        });
        req.on('error', () => { resolve(); });
        req.end(Buffer.alloc(256 * 1024));
      });
      expect(proxy.blocked.map((b) => b.reason)).toContain('budget');
      expect(budget.usedBytes).toBeGreaterThan(64 * 1024);
    } finally {
      await proxy.close();
    }
  });
});

describe('robots', () => {
  it('parses groups, wildcards and precedence', () => {
    const rules = parseRobots(
      ['User-agent: other', 'Disallow: /', '', 'User-agent: *', 'Disallow: /private', 'Allow: /private/public', 'Disallow: /*.pdf$', 'Disallow: /tmp*/x'].join('\n'),
      'Safeshelf',
    );
    expect(rules.isAllowed('/')).toBe(true);
    expect(rules.isAllowed('/private/x')).toBe(false);
    expect(rules.isAllowed('/private/public/a')).toBe(true);
    expect(rules.isAllowed('/a.pdf')).toBe(false);
    expect(rules.isAllowed('/a.pdf?x=1')).toBe(true);
    expect(rules.isAllowed('/tmp123/x')).toBe(false);
    expect(rules.isAllowed('/robots.txt')).toBe(true);
  });
  it('prefers a group naming the product token', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: safeshelf\nAllow: /\n', 'Safeshelf');
    expect(rules.isAllowed('/x')).toBe(true);
    // An empty or partial user-agent value does not name Safeshelf, so the "*" group applies.
    expect(parseRobots('User-agent:\nAllow: /\n\nUser-agent: *\nDisallow: /\n', 'Safeshelf').isAllowed('/x')).toBe(false);
    expect(parseRobots('User-agent: safe\nAllow: /\n\nUser-agent: *\nDisallow: /\n', 'Safeshelf').isAllowed('/x')).toBe(false);
  });
  it('ignores comments and unknown lines; empty disallow allows', () => {
    const rules = parseRobots('# hi\nUser-agent: * # all\nDisallow:\nCrawl-delay: 5\n', 'Safeshelf');
    expect(rules.isAllowed('/anything')).toBe(true);
  });
  it('fetches robots.txt through the guard and refuses redirects to blocked hosts', async () => {
    const budget = new ByteBudget(1e6);
    const ctx = { policy: policy(), limits, budget, maxRedirects: 3 };
    const rules = await fetchRobots(`http://local.test:${String(port)}`, ctx);
    expect(rules.isAllowed('/private/a')).toBe(false);
    expect(rules.sitemaps).toEqual(['https://local.test/sitemap.xml']);
    // Redirect to metadata: the hop is refused by the guard; robots is treated as unavailable (allow).
    const viaRedirect = await fetchRobots(`http://redir.test:${String(port)}`, ctx);
    expect(viaRedirect.isAllowed('/private/a')).toBe(true);
  });
  it('a 5xx robots.txt disallows everything (RFC 9309 2.3.1.4)', async () => {
    const rules = await fetchRobots(`http://five.test:${String(port)}`, { policy: policy(), limits, budget: new ByteBudget(1e6), maxRedirects: 3 });
    expect(rules.isAllowed('/')).toBe(false);
  });
  it('collects only absolute http(s) Sitemap lines', () => {
    const rules = parseRobots('Sitemap: /relative.xml\nSitemap: https://a.test/s.xml\nSitemap: javascript:alert(1)\nUser-agent: *\nDisallow:', 'Safeshelf');
    expect(rules.sitemaps).toEqual(['https://a.test/s.xml']);
  });
});
