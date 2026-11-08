// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * End-to-end scans of the fixture shop through the full network guard (route
 * interception plus the guard proxy), with Playwright's bundled Chromium and
 * its sandbox on.
 */
import { readFileSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BlockedRequestError } from '../../src/net/guard.js';
import { renderHtmlReport } from '../../src/report/html.js';
import type { SafeshelfReport } from '../../src/report/types.js';
import { BrowserSession, CHROMIUM_ARGS, contextOptions, launchOptions } from '../../src/browser/session.js';
import { ByteBudget } from '../../src/net/fetcher.js';
import { launchErrorMessage, normaliseLimits, sandboxSetting, scan, isCrawlable, type ScanOptions } from '../../src/scan.js';
import type { ElementId, Status } from '../../src/types.js';
import { validate } from '../helpers/jsonschema.js';
import { startFixtures, type Fixtures } from '../helpers/server.js';

const schema = JSON.parse(readFileSync(new URL('../../schema/report.schema.json', import.meta.url), 'utf8')) as Record<string, unknown>;

let fx: Fixtures;
let dir: string;
let crawl: SafeshelfReport;
beforeAll(async () => {
  fx = await startFixtures();
  dir = await mkdtemp(path.join(os.tmpdir(), 'safeshelf-scan-'));
  crawl = await scan(opts({ url: `${fx.base}/`, sitemap: true, maxPages: 40, outputDir: path.join(dir, 'crawl') }));
}, 180_000);
afterAll(async () => {
  await fx.close();
  await rm(dir, { recursive: true, force: true });
});

function opts(extra: Partial<ScanOptions>): ScanOptions {
  return { resolver: fx.resolver, allowAddresses: fx.allowAddresses, ...extra };
}

const product = (r: SafeshelfReport, file: string) => {
  const p = r.products.find((x) => x.source.kind === 'page' && x.source.url.endsWith(`/products/${file}`));
  if (p === undefined) throw new Error(`no result for ${file}`);
  return p;
};
const statusOf = (r: SafeshelfReport, file: string): Record<ElementId, Status> =>
  Object.fromEntries(product(r, file).elements.map((e) => [e.element, e.status])) as Record<ElementId, Status>;

describe('crawl with sitemaps', () => {
  it('finds product pages first, skips listings and robots-disallowed pages, never reaches the internal server', () => {
    const byStatus = (s: string) => crawl.pages.filter((p) => p.status === s).map((p) => new URL(p.url).pathname);
    expect(byStatus('product')).toEqual(
      expect.arrayContaining(['/products/kettle-de.html', '/products/mug-fr.html', '/products/lamp-marketplace.html', '/products/toy-lt.html', '/products/no-info.html', '/products/accordion-nl.html']),
    );
    expect(byStatus('product').slice(0, 4)).toEqual(['/products/kettle-de.html', '/products/mug-fr.html', '/products/lamp-marketplace.html', '/products/toy-lt.html']);
    expect(byStatus('not-product')).toEqual(expect.arrayContaining(['/', '/category.html']));
    expect(byStatus('skipped-robots')).toEqual(['/private/secret.html']);
    expect(fx.requests).not.toContain('/private/secret.html');
    expect(fx.requests).not.toContain('/cart');
    expect(crawl.pages.filter((p) => new URL(p.url).pathname === '/')).toHaveLength(1);
    expect(fx.secretHits()).toBe(0);
    expect(fx.secretConnections()).toBe(0);
  });

  it('reports sitemap problems: a gzip bomb, a redirect to an internal host and an internal sitemap', () => {
    expect(crawl.notes).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/bomb\.xml\.gz could not be read \(size\)/),
        expect.stringMatching(/redirect-out\.xml could not be read \(loopback\)/),
        expect.stringMatching(/^Sitemaps listed \d+ URL\(s\) on this site\.$/),
      ]),
    );
    expect(crawl.notes.join('\n')).not.toContain('elsewhere.example');
  });

  it('German shop page with structured data, a visible manufacturer section and warnings in a closed details element', () => {
    expect(statusOf(crawl, 'kettle-de.html')).toEqual({
      'manufacturer-name': 'found',
      'manufacturer-postal-address': 'found',
      'manufacturer-electronic-address': 'found',
      'responsible-person-name': 'not-applicable',
      'responsible-person-postal-address': 'not-applicable',
      'responsible-person-electronic-address': 'not-applicable',
      'product-picture': 'found',
      'product-type': 'found',
      'product-identifier': 'found',
      'safety-information': 'found',
    });
    const safety = product(crawl, 'kettle-de.html').elements.find((e) => e.element === 'safety-information');
    expect(safety?.confidence).toBe('medium');
    expect(safety?.evidence[0]).toMatchObject({ visibility: 'collapsed', label: 'warnhinweise', labelLanguage: 'de', labelSource: 'official-text' });
  });

  it('French page with a brand only', () => {
    expect(statusOf(crawl, 'mug-fr.html')).toMatchObject({ 'manufacturer-name': 'review', 'manufacturer-postal-address': 'not-found', 'manufacturer-electronic-address': 'not-found', 'responsible-person-name': 'review', 'product-identifier': 'found' });
  });

  it('marketplace listing: seller box is not the manufacturer; tab panel content is found but collapsed', () => {
    const s = statusOf(crawl, 'lamp-marketplace.html');
    expect(s).toMatchObject({ 'manufacturer-name': 'found', 'responsible-person-name': 'found', 'responsible-person-postal-address': 'found', 'safety-information': 'found' });
    const name = product(crawl, 'lamp-marketplace.html').elements.find((e) => e.element === 'manufacturer-name');
    expect(name?.evidence[0]?.text).toBe('Lumo Lighting Ltd');
    expect(name?.evidence[0]?.visibility).toBe('collapsed');
  });

  it('Lithuanian page: non-EU manufacturer with an EU responsible person in a definition list', () => {
    expect(statusOf(crawl, 'toy-lt.html')).toEqual({
      'manufacturer-name': 'found',
      'manufacturer-postal-address': 'found',
      'manufacturer-electronic-address': 'found',
      'responsible-person-name': 'found',
      'responsible-person-postal-address': 'found',
      'responsible-person-electronic-address': 'found',
      'product-picture': 'found',
      'product-type': 'found',
      'product-identifier': 'found',
      'safety-information': 'found',
    });
    expect(product(crawl, 'toy-lt.html').elements[0]?.evidence[0]?.text).toBe('Shenzhen Toyworks Co., Ltd.');
  });

  it('manufacturer only in JSON-LD is found but not visible', () => {
    expect(statusOf(crawl, 'jsonld-only.html')).toMatchObject({ 'manufacturer-name': 'found-not-visible', 'manufacturer-postal-address': 'found-not-visible', 'manufacturer-electronic-address': 'found-not-visible', 'responsible-person-name': 'not-applicable' });
  });

  it('a bare product page: information not found with medium confidence', () => {
    const p = product(crawl, 'no-info.html');
    expect(p.missing).toEqual(['manufacturer-name', 'manufacturer-postal-address', 'manufacturer-electronic-address', 'product-picture', 'product-identifier']);
    expect(p.elements.find((e) => e.element === 'manufacturer-name')?.confidence).toBe('medium');
  });

  it('false positives: running text, warranty, Type-C, seller and footer addresses are not taken', () => {
    const s = statusOf(crawl, 'false-positive.html');
    expect(s).toMatchObject({ 'manufacturer-name': 'not-found', 'manufacturer-postal-address': 'not-found', 'manufacturer-electronic-address': 'not-found', 'product-type': 'review', 'product-identifier': 'not-found', 'safety-information': 'review' });
    expect(product(crawl, 'false-positive.html').elements[0]?.explanation).toMatch(/Seller information was found \("CableMart GmbH"\)/);
  });

  it('Polish microdata page: GTIN only in a meta tag is not visible', () => {
    expect(statusOf(crawl, 'microdata-pl.html')).toMatchObject({ 'manufacturer-name': 'found', 'manufacturer-postal-address': 'found', 'manufacturer-electronic-address': 'found', 'product-type': 'found', 'product-identifier': 'found-not-visible', 'safety-information': 'found' });
  });

  it('Dutch accordion: closed panels are read through aria-controls', () => {
    expect(statusOf(crawl, 'accordion-nl.html')).toMatchObject({ 'manufacturer-name': 'found', 'manufacturer-postal-address': 'found', 'manufacturer-electronic-address': 'found', 'responsible-person-name': 'not-applicable', 'safety-information': 'found' });
  });

  it('a page with frames and background pictures lowers the confidence of "not found"', () => {
    const p = product(crawl, 'image-only.html');
    expect(p.elements.find((e) => e.element === 'manufacturer-name')).toMatchObject({ status: 'not-found', confidence: 'low' });
    expect(p.elements.find((e) => e.element === 'product-picture')?.explanation).toMatch(/frame\(s\) were not read; pictures set as CSS backgrounds/);
  });

  it('takes cropped screenshots of visible evidence and embeds them in the HTML report', async () => {
    const shots = await readdir(path.join(dir, 'crawl', 'screenshots'));
    expect(shots.length).toBeGreaterThan(5);
    expect(shots.every((s) => /^E\d{4}\.jpg$/.test(s))).toBe(true);
    const html = await renderHtmlReport(crawl, { baseDir: path.join(dir, 'crawl') });
    expect(html.match(/data:image\/jpeg;base64,/g)?.length ?? 0).toBeGreaterThan(5);
  });

  it('the report matches the published schema', () => {
    expect(validate(schema, JSON.parse(JSON.stringify(crawl)))).toEqual([]);
  });
});

describe('URL lists and marketplace context', () => {
  it('checks listed pages even without product signals and cites Art. 22(9) for marketplaces', async () => {
    const r = await scan(opts({ urls: [`${fx.base}/products/lamp-marketplace.html`, `${fx.base}/category.html`, `${fx.base}/not-html`], context: 'marketplace' }));
    expect(r.pages.map((p) => p.status)).toEqual(['product', 'product', 'not-html']);
    expect(r.products[1]?.notes[0]).toMatch(/^Checked because the URL was listed/);
    expect(r.provisions.map((p) => p.id)).toContain('gpsr-22-9-a');
    expect(r.input).toEqual({ urlCount: 3 });
  });
  it('validates the list', async () => {
    await expect(scan(opts({ urls: [] }))).rejects.toThrow(/empty/);
    await expect(scan(opts({ urls: ['ftp://x.example/'] }))).rejects.toThrow(BlockedRequestError);
    await expect(scan(opts({ url: `${fx.base}/`, urls: [`${fx.base}/`] }))).rejects.toThrow(/either url/);
  });
});

describe('network guard in the browser', () => {
  it('refuses redirects to internal and metadata addresses, and long redirect chains', async () => {
    const r = await scan(opts({ urls: ['/redirect-internal', '/redirect-metadata', '/redirect-internal-ip', '/redirect-chain'].map((p) => `${fx.base}${p}`), maxRedirects: 5 }));
    expect(r.pages.map((p) => p.status)).toEqual(['error', 'error', 'error', 'error']);
    expect(r.blockedRequests.map((b) => b.reason)).toEqual(expect.arrayContaining(['metadata']));
    expect(r.blockedRequests.some((b) => b.stage === 'proxy')).toBe(true);
    expect(fx.secretHits()).toBe(0);
    expect(fx.secretConnections()).toBe(0);
  }, 120_000);

  it('blocks every browser-side SSRF vector on a hostile page', async () => {
    const r = await scan(opts({ urls: [`${fx.base}/hostile-ssrf.html`] }));
    expect(r.pages[0]?.status).toBe('product');
    expect(r.blockedRequests.length).toBeGreaterThan(5);
    expect(new Set(r.blockedRequests.map((b) => b.stage))).toEqual(new Set(['route', 'proxy']));
    // Sub-resources are refused by the route check before they are sent, not only by the proxy.
    expect(r.blockedRequests.some((b) => b.stage === 'route' && b.reason === 'metadata')).toBe(true);
    expect(r.blockedRequests.some((b) => b.stage === 'route' && b.reason === 'nat64')).toBe(true);
    expect(r.blockedRequests.filter((b) => b.stage === 'route' && b.reason === 'loopback').length).toBeGreaterThan(5);
    // WebSockets are refused by the WebSocket route before any connection, and service workers are never registered.
    expect(r.blockedRequests.some((b) => b.stage === 'route' && b.reason === 'websocket')).toBe(true);
    expect(fx.requests).not.toContain('/sw.js');
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(fx.secretHits()).toBe(0);
    expect(fx.secretConnections()).toBe(0);
  }, 120_000);

  it('refuses a blocked start URL before launching anything', async () => {
    await expect(scan(opts({ url: `http://internal.test:${String(fx.secretPort)}/` }))).rejects.toThrow(BlockedRequestError);
    await expect(scan(opts({ url: 'http://mixed.test/' }))).rejects.toThrow(/private/);
    await expect(scan(opts({ url: 'http://169.254.169.254/', allowAddresses: ['169.254.169.254'] }))).rejects.toThrow(/metadata/);
    expect(fx.secretConnections()).toBe(0);
  });
});

describe('resource limits and hostile pages', () => {
  it('caps the response size', async () => {
    const r = await scan(opts({ urls: [`${fx.base}/big`], maxResponseBytes: 64 * 1024 }));
    expect(r.pages[0]?.status).toBe('error');
    expect(r.blockedRequests.some((b) => b.reason === 'size')).toBe(true);
  });

  it('caps the total bytes of a scan', async () => {
    const r = await scan(opts({ urls: Array.from({ length: 6 }, (_v, i) => `${fx.base}/big?i=${String(i)}`), maxTotalBytes: 1024 * 1024 }));
    expect(r.pages.some((p) => p.status === 'error')).toBe(true);
    expect(r.blockedRequests.some((b) => b.reason === 'budget')).toBe(true);
  });

  it('caps pages and products', async () => {
    const r = await scan(opts({ url: `${fx.base}/`, sitemap: true, maxProducts: 2 }));
    expect(r.products).toHaveLength(2);
    expect(r.notes).toContain('The product limit of 2 was reached.');
    const p = await scan(opts({ url: `${fx.base}/`, maxPages: 2 }));
    expect(p.pages).toHaveLength(2);
  });

  it('closes pop-ups and keeps scanning', async () => {
    const r = await scan(opts({ urls: [`${fx.base}/hostile-popups.html`, `${fx.base}/products/kettle-de.html`] }));
    expect(r.pages.map((p) => p.status)).toEqual(['product', 'product']);
    expect(r.blockedRequests.filter((b) => b.reason === 'popup').length).toBeGreaterThan(0);
    expect(r.products[1]?.elements[0]?.status).toBe('found');
  });

  it('tampering with built-ins does not reach the collector, which runs in an isolated world', async () => {
    const r = await scan(opts({ urls: [`${fx.base}/hostile-dom.html`] }));
    expect(r.pages.map((p) => p.status)).toEqual(['product']);
    const p = r.products[0];
    expect(p?.elements.slice(0, 3).map((e) => e.status)).toEqual(['found', 'found', 'found']);
    expect(p?.elements[0]?.evidence[0]?.text).toBe('Honest Maker GmbH');
  }, 120_000);

  it('a page that blocks its main thread fails alone after the evaluation deadline', async () => {
    const r = await scan(opts({ urls: [`${fx.base}/hostile-loop.html`, `${fx.base}/products/mug-fr.html`] }));
    expect(r.pages.map((p) => p.status)).toEqual(['error', 'product']);
    expect(r.pages[0]?.error).toMatch(/Analysis failed: Page evaluation exceeded 15000 ms/);
  }, 120_000);
});

describe('browser session', () => {
  it('closes pages opened by the scanned page as soon as they appear', async () => {
    const session = await BrowserSession.start({
      policy: { allowAddresses: fx.allowAddresses, resolver: fx.resolver },
      limits: { maxResponseBytes: 1e7, requestTimeoutMs: 10_000 },
      budget: new ByteBudget(1e8),
      maxRedirects: 5,
      viewport: { width: 800, height: 600 },
      locale: 'en-GB',
      chromiumSandbox: true,
    });
    try {
      const context = await session.newContext();
      const page = await context.newPage();
      await page.goto(`${fx.base}/products/no-info.html`);
      await page.evaluate(() => {
        for (let i = 0; i < 5; i += 1) window.open(`/products/no-info.html?w=${String(i)}`);
      });
      await new Promise((resolve) => setTimeout(resolve, 1000));
      expect(context.pages()).toHaveLength(1);
      expect(session.blocked.filter((b) => b.reason === 'popup').length).toBe(5);
    } finally {
      await session.close();
    }
  });
});

describe('downloads', () => {
  it('cancels downloads a page starts, so nothing is written to disk', async () => {
    const session = await BrowserSession.start({
      policy: { allowAddresses: fx.allowAddresses, resolver: fx.resolver },
      limits: { maxResponseBytes: 1e7, requestTimeoutMs: 10_000 },
      budget: new ByteBudget(1e8),
      maxRedirects: 5,
      viewport: { width: 800, height: 600 },
      locale: 'en-GB',
      chromiumSandbox: true,
    });
    try {
      const context = await session.newContext();
      const page = await context.newPage();
      await page.goto(`${fx.base}/products/no-info.html`);
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 10_000 }),
        page.evaluate(() => {
          const a = document.createElement('a');
          a.href = '/download.bin';
          a.download = 'payload.bin';
          document.body.append(a);
          a.click();
        }),
      ]);
      expect(await download.failure()).not.toBeNull();
    } finally {
      await session.close();
    }
  });
});

describe('pure helpers', () => {
  it('normalises limits into safe ranges', () => {
    expect(normaliseLimits({ maxPages: 1e9, maxProducts: -5, maxDurationMs: Number.NaN, maxRedirects: 99 })).toMatchObject({ maxPages: 2000, maxProducts: 1, maxDurationMs: 600_000, maxRedirects: 20, respectRobotsTxt: true });
  });
  it('crawls only same-origin pages that are not assets, carts or accounts', () => {
    const o = 'https://shop.example';
    expect(isCrawlable('https://shop.example/products/a', o)?.pathname).toBe('/products/a');
    for (const bad of ['https://other.example/x', 'https://u:p@shop.example/x', 'https://shop.example/a.pdf', 'https://shop.example/cart', 'https://shop.example/?add-to-cart=5', 'https://shop.example/my-account/', 'nonsense']) {
      expect(isCrawlable(bad, o)).toBeNull();
    }
  });
  it('keeps the Chromium sandbox on unless explicitly turned off, and routes everything through the proxy', () => {
    expect(sandboxSetting({})).toBe(true);
    expect(sandboxSetting({ chromiumSandbox: false })).toBe(false);
    const o = launchOptions(true, { server: 'http://127.0.0.1:1', username: 'u', password: 'p' });
    expect(o).toMatchObject({ headless: true, chromiumSandbox: true, proxy: { server: 'http://127.0.0.1:1', bypass: '<-loopback>' } });
    expect(o.args).toEqual([...CHROMIUM_ARGS]);
    expect(CHROMIUM_ARGS.join(' ')).not.toMatch(/no-sandbox|disable-web-security|proxy-bypass|disable-setuid/);
    expect(contextOptions({ width: 800, height: 600 }, 'en-GB')).toMatchObject({ serviceWorkers: 'block', acceptDownloads: false, permissions: [], ignoreHTTPSErrors: false, bypassCSP: false });
    expect(CHROMIUM_ARGS).toEqual(
      expect.arrayContaining(['--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--webrtc-ip-handling-policy=disable_non_proxied_udp', '--disable-background-networking']),
    );
  });
  it('explains sandbox failures without turning the sandbox off', () => {
    expect(launchErrorMessage('No usable sandbox! Update your kernel')).toMatch(/keeps the sandbox on/);
    expect(launchErrorMessage("Executable doesn't exist at /x")).toMatch(/playwright-core install chromium-headless-shell/);
    expect(launchErrorMessage('other')).toBeNull();
  });
});
