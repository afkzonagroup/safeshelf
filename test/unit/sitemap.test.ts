// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { gunzipCapped, parseSitemap, sameOrigin } from '../../src/crawl/sitemap.js';
import { BlockedRequestError } from '../../src/net/guard.js';

describe('sitemaps', () => {
  it('reads URL sets and sitemap indexes, keeping only absolute http(s) locations', () => {
    const set = parseSitemap('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc> https://a.example/p/1 </loc></url><url><loc>javascript:x</loc></url><url><loc>/rel</loc></url><url/></urlset>', 100);
    expect(set).toEqual({ kind: 'urlset', locations: ['https://a.example/p/1'] });
    const index = parseSitemap('<sitemapindex><sitemap><loc>https://a.example/s1.xml</loc></sitemap></sitemapindex>', 100);
    expect(index).toEqual({ kind: 'index', locations: ['https://a.example/s1.xml'] });
  });
  it('caps the number of locations and refuses other documents and DOCTYPEs', () => {
    const many = `<urlset>${Array.from({ length: 50 }, (_v, i) => `<url><loc>https://a.example/${String(i)}</loc></url>`).join('')}</urlset>`;
    expect(parseSitemap(many, 10)?.locations).toHaveLength(10);
    expect(parseSitemap('<html><body/></html>', 10)).toBeNull();
    expect(parseSitemap('<!DOCTYPE x [<!ENTITY a "b">]><urlset/>', 10)).toBeNull();
    expect(parseSitemap('not xml', 10)).toBeNull();
  });
  it('decompresses gzip with an output cap', () => {
    expect(gunzipCapped(zlib.gzipSync(Buffer.from('<urlset/>')), 1000).toString()).toBe('<urlset/>');
    expect(() => gunzipCapped(zlib.gzipSync(Buffer.alloc(10_000)), 1000)).toThrow(BlockedRequestError);
    expect(() => gunzipCapped(Buffer.from([0x1f, 0x8b, 1, 2, 3]), 1000)).toThrow(/could not be decompressed/);
  });
  it('compares origins', () => {
    expect(sameOrigin('https://a.example/x', 'https://a.example')).toBe(true);
    expect(sameOrigin('https://a.example:444/x', 'https://a.example')).toBe(false);
    expect(sameOrigin('nonsense', 'https://a.example')).toBe(false);
  });
});

describe('collectSitemapUrls', () => {
  it('reads only sitemaps and URLs of the shop’s own origin, even when another host is reachable', async () => {
    const http = await import('node:http');
    const { collectSitemapUrls } = await import('../../src/crawl/sitemap.js');
    const { ByteBudget } = await import('../../src/net/fetcher.js');
    const hosts: string[] = [];
    let port = 0;
    const server = http.createServer((req, res) => {
      const host = req.headers.host ?? '';
      hosts.push(`${host}${req.url ?? ''}`);
      const own = `http://shop.test:${String(port)}`;
      const other = `http://other.test:${String(port)}`;
      if (req.url === '/sitemap.xml') {
        res.writeHead(200, { 'content-type': 'application/xml' });
        res.end(`<sitemapindex><sitemap><loc>${other}/foreign.xml</loc></sitemap><sitemap><loc>${own}/redirect.xml</loc></sitemap><sitemap><loc>${own}/own.xml</loc></sitemap></sitemapindex>`);
      } else if (req.url === '/redirect.xml') {
        res.writeHead(302, { location: `${other}/via-redirect.xml` });
        res.end();
      } else {
        res.writeHead(200, { 'content-type': 'application/xml' });
        res.end(`<urlset><url><loc>${own}/products/a</loc></url><url><loc>${other}/products/b</loc></url></urlset>`);
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as { port: number }).port;
    try {
      const ctx = {
        policy: { allowAddresses: ['127.0.0.1'], resolver: () => Promise.resolve([{ address: '127.0.0.1', family: 4 as const }]) },
        limits: { maxResponseBytes: 1e6, requestTimeoutMs: 5000 },
        budget: new ByteBudget(1e7),
        maxRedirects: 3,
      };
      const r = await collectSitemapUrls(`http://shop.test:${String(port)}`, [`http://other.test:${String(port)}/listed-in-robots.xml`], ctx);
      expect(r.urls).toEqual([`http://shop.test:${String(port)}/products/a`]);
      expect(r.notes.some((n) => n.includes('redirected to another site'))).toBe(true);
      // Sitemaps on another host are never fetched; a redirect to one is followed by the guard but not used.
      expect(hosts.filter((h) => h.startsWith('other.test'))).toEqual([`other.test:${String(port)}/via-redirect.xml`]);
    } finally {
      server.close();
    }
  });
});
