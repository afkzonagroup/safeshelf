// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { readFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import type { ResolvedAddress, Resolver } from '../../src/net/guard.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/shop');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

/** A valid 1x1 PNG. */
export const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a1d1f3b50000000049454e44ae426082', 'hex');

/** Fixture server plus a "secret" internal server that must never be reached. */
export interface Fixtures {
  /** Base URL using the host name shop.test (resolved by `resolver`). */
  readonly base: string;
  readonly port: number;
  readonly secretPort: number;
  /** Paths requested from the fixture server. */
  readonly requests: string[];
  /** Number of HTTP requests on the secret server. */
  secretHits(): number;
  /** Number of TCP connections to the secret server (any protocol). */
  secretConnections(): number;
  readonly resolver: Resolver;
  /** Policy allow-list for the fixture server address. */
  readonly allowAddresses: readonly string[];
  close(): Promise<void>;
}

function sitemapIndex(base: string, secretPort: number): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>${base}/sitemaps/pages.xml</loc></sitemap>
  <sitemap><loc>${base}/sitemaps/products.xml.gz</loc></sitemap>
  <sitemap><loc>${base}/sitemaps/bomb.xml.gz</loc></sitemap>
  <sitemap><loc>http://internal.test:${String(secretPort)}/sitemap.xml</loc></sitemap>
  <sitemap><loc>${base}/sitemaps/redirect-out.xml</loc></sitemap>
</sitemapindex>`;
}

function urlset(urls: readonly string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}\n</urlset>`;
}

/** Start the fixture servers. */
export async function startFixtures(): Promise<Fixtures> {
  const requests: string[] = [];
  let secretHits = 0;
  let secretConnections = 0;

  const secret = http.createServer((_req, res) => {
    secretHits += 1;
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>secret</title><h1>Manufacturer: SECRET-TOKEN GmbH</h1>');
  });
  secret.on('connection', () => {
    secretConnections += 1;
  });
  await new Promise<void>((resolve) => secret.listen(0, '::', resolve));
  const secretPort = (secret.address() as AddressInfo).port;
  let base = '';

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://shop.test');
    requests.push(url.pathname);
    const send = (status: number, headers: Record<string, string>, body: string | Buffer = ''): void => {
      res.writeHead(status, headers);
      res.end(body);
    };
    if (url.pathname.startsWith('/img/')) {
      send(200, { 'content-type': 'image/png' }, PNG);
      return;
    }
    switch (url.pathname) {
      case '/sitemap.xml':
        send(200, { 'content-type': 'application/xml' }, sitemapIndex(base, secretPort));
        return;
      case '/sitemaps/pages.xml':
        send(200, { 'content-type': 'application/xml' }, urlset([`${base}/`, `${base}/category.html`, 'https://elsewhere.example/products/x']));
        return;
      case '/sitemaps/products.xml.gz':
        send(
          200,
          { 'content-type': 'application/gzip' },
          zlib.gzipSync(urlset(['kettle-de', 'mug-fr', 'lamp-marketplace', 'toy-lt'].map((p) => `${base}/products/${p}.html`))),
        );
        return;
      case '/sitemaps/bomb.xml.gz':
        // 60 MB of zeros compressed to about 60 KB: must hit the decompression cap.
        send(200, { 'content-type': 'application/gzip' }, zlib.gzipSync(Buffer.alloc(60 * 1024 * 1024)));
        return;
      case '/sitemaps/redirect-out.xml':
        send(302, { location: `http://internal.test:${String(secretPort)}/sitemap.xml` });
        return;
      case '/redirect-metadata':
        send(302, { location: 'http://169.254.169.254/latest/meta-data/' });
        return;
      case '/redirect-internal':
        send(302, { location: `http://internal.test:${String(secretPort)}/secret` });
        return;
      case '/redirect-internal-ip':
        send(302, { location: `http://[::ffff:127.0.0.1]:${String(secretPort)}/secret` });
        return;
      case '/redirect-chain': {
        const n = Number(url.searchParams.get('n') ?? '0');
        if (n < 8) send(302, { location: `/redirect-chain?n=${String(n + 1)}` });
        else send(200, { 'content-type': 'text/html' }, '<!doctype html><p>end of chain</p>');
        return;
      }
      case '/big':
        send(200, { 'content-type': 'text/html' }, `<!doctype html><h1>Big</h1><p>${'x'.repeat(300 * 1024)}</p>`);
        return;
      case '/download.bin':
        send(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="payload.bin"' }, Buffer.alloc(4096, 1));
        return;
      case '/not-html':
        send(200, { 'content-type': 'text/plain' }, 'plain text');
        return;
      case '/cart':
        send(200, { 'content-type': 'text/html' }, '<!doctype html><h1>Cart</h1>');
        return;
      default:
        break;
    }
    const rel = path.normalize(decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)).replace(/^([/\\])+/, '');
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT + path.sep)) {
      send(404, { 'content-type': 'text/plain' }, 'not found');
      return;
    }
    readFile(file)
      .then((data) => {
        const type = TYPES[path.extname(file)] ?? 'application/octet-stream';
        const body = type.startsWith('text/html') ? data.toString('utf8').replaceAll('{{SECRET_PORT}}', String(secretPort)) : data;
        send(200, { 'content-type': type }, body);
      })
      .catch(() => {
        send(404, { 'content-type': 'text/plain' }, 'not found');
      });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  base = `http://shop.test:${String(port)}`;

  const table: Record<string, ResolvedAddress[]> = {
    'shop.test': [{ address: '127.0.0.1', family: 4 }],
    'internal.test': [{ address: '::ffff:127.0.0.1', family: 6 }],
    'metadata.test': [{ address: '169.254.169.254', family: 4 }],
    'mixed.test': [
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ],
  };
  const resolver: Resolver = (host) => {
    const hit = table[host];
    return hit === undefined ? Promise.reject(new Error('ENOTFOUND')) : Promise.resolve(hit);
  };

  return {
    base,
    port,
    secretPort,
    requests,
    secretHits: () => secretHits,
    secretConnections: () => secretConnections,
    resolver,
    allowAddresses: ['127.0.0.1'],
    close: async () => {
      server.closeAllConnections();
      secret.closeAllConnections();
      await Promise.all([
        new Promise<void>((resolve) => server.close(() => { resolve(); })),
        new Promise<void>((resolve) => secret.close(() => { resolve(); })),
      ]);
    },
  };
}
