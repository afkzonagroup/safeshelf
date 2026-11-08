// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The page scanner: crawls a shop (same origin, optionally seeded from its
 * sitemaps) or checks a list of product URLs, finds product pages, and
 * evaluates each against GPSR Art. 19. All network traffic passes the SSRF
 * guard.
 */

import type { BrowserContext, Page } from 'playwright-core';
import { BrowserSession } from './browser/session.js';
import { collectLinks, screenshotElement, snapshotPage } from './browser/page-ops.js';
import { collectSitemapUrls } from './crawl/sitemap.js';
import { evaluateFacts, type EvaluateOptions } from './detect/evaluate.js';
import { pageFacts, pageProducts } from './detect/page-facts.js';
import { ByteBudget, type FetchLimits } from './net/fetcher.js';
import type { NetContext } from './net/get.js';
import { checkUrlSyntax, resolveAndCheck, systemResolver, type NetworkPolicy, type Resolver } from './net/guard.js';
import { fetchRobots } from './net/robots-fetch.js';
import { ALLOW_ALL, type RobotsRules } from './net/robots.js';
import {
  DISCLAIMER,
  REPORT_SCHEMA_VERSION,
  TOOL_VERSION,
  productResult,
  referencedProvisions,
  summarize,
  type PageResult,
  type ProductResult,
  type SafeshelfReport,
  type ScanLimits,
} from './report/types.js';
import type { ElementResult, Evidence } from './types.js';
import { ensureDir, ensureSubdir } from './util/files.js';

/** Options for {@link scan}. Give `url` to crawl a shop, or `urls` to check a list of product pages. */
export interface ScanOptions extends EvaluateOptions {
  /** Start URL of a shop (http or https). The crawl stays on this origin. */
  readonly url?: string;
  /** Product page URLs to check instead of crawling (at most 2000). */
  readonly urls?: readonly string[];
  /** With `url`: also read the shop's sitemaps to find product pages. Default false. */
  readonly sitemap?: boolean;
  /** Pages to load, including non-product pages. Default 50, 1 to 2000. */
  readonly maxPages?: number;
  /** Product pages to check. Default 50, 1 to 2000. */
  readonly maxProducts?: number;
  /** Whole-scan time budget in ms. Default 600 000, 5 000 to 3 600 000. */
  readonly maxDurationMs?: number;
  /** Time limit for one navigation or request in ms. Default 30 000. */
  readonly navigationTimeoutMs?: number;
  /** Maximum size of one response in bytes. Default 10 MiB. */
  readonly maxResponseBytes?: number;
  /** Maximum bytes transferred by the whole scan, both directions. Default 500 MiB. */
  readonly maxTotalBytes?: number;
  /** Maximum redirects for a navigation. Default 5. */
  readonly maxRedirects?: number;
  /** Respect robots.txt. Default true. */
  readonly respectRobotsTxt?: boolean;
  /** Exact IPs in blocked ranges that may still be scanned (your own staging server). Never cloud metadata addresses. */
  readonly allowAddresses?: readonly string[];
  /** Directory for evidence screenshots. When omitted, no screenshots are taken. */
  readonly outputDir?: string;
  /** Run Chromium with its OS sandbox. Default true. */
  readonly chromiumSandbox?: boolean;
  /** Viewport. Default 1280 x 900. */
  readonly viewport?: { readonly width: number; readonly height: number };
  /** Browser locale. Default en-GB. */
  readonly locale?: string;
  /** DNS resolver override (tests, split-horizon DNS). */
  readonly resolver?: Resolver;
  /** Progress callback (one line per event). */
  readonly onProgress?: (message: string) => void;
}

const clampInt = (value: number | undefined, fallback: number, min: number, max: number): number => {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
};

/** Normalised limits. Pure. */
export function normaliseLimits(options: ScanOptions): ScanLimits {
  return {
    maxPages: clampInt(options.maxPages, 50, 1, 2000),
    maxProducts: clampInt(options.maxProducts, 50, 1, 2000),
    maxDurationMs: clampInt(options.maxDurationMs, 600_000, 5_000, 3_600_000),
    navigationTimeoutMs: clampInt(options.navigationTimeoutMs, 30_000, 1_000, 120_000),
    maxResponseBytes: clampInt(options.maxResponseBytes, 10 * 1024 * 1024, 64 * 1024, 100 * 1024 * 1024),
    maxTotalBytes: clampInt(options.maxTotalBytes, 500 * 1024 * 1024, 1024 * 1024, 4 * 1024 * 1024 * 1024),
    maxRedirects: clampInt(options.maxRedirects, 5, 0, 20),
    respectRobotsTxt: options.respectRobotsTxt ?? true,
  };
}

const ASSET_EXTENSION = /\.(?:png|jpe?g|gif|webp|avif|svg|ico|pdf|zip|gz|tgz|rar|7z|mp[34]|webm|mov|avi|wav|ogg|woff2?|ttf|otf|eot|css|js|mjs|json|xml|rss|txt|csv|xlsx?|docx?|pptx?|dmg|exe|apk)$/i;
const NOT_PRODUCT_PATH = /\/(?:cart|checkout|account|login|logout|register|wishlist|search|basket|kasse|warenkorb|panier|my-account|wp-admin|wp-login|admin)(?:\/|$)|[?&](?:add-to-cart|add_to_wishlist|orderby|filter_|sort)=/i;
/** URL paths that often hold product pages (Shopify /products/, WooCommerce /product/, ...). */
export const PRODUCT_PATH = /\/(?:products?|produkt|produkte|produit|produits|producto|productos|prodotto|prodotti|artikel|item|items|p|dp)\/[^/?#]+/i;

/** Canonical form for crawl de-duplication: no hash. Pure. */
export function crawlKey(url: URL): string {
  const u = new URL(url.href);
  u.hash = '';
  return u.href;
}

/** A link worth crawling from `origin`, or null. Pure. */
export function isCrawlable(link: string, origin: string): URL | null {
  let u: URL;
  try {
    u = new URL(link);
  } catch {
    return null;
  }
  if (u.origin !== origin || u.username !== '' || u.password !== '') return null;
  if (ASSET_EXTENSION.test(u.pathname) || NOT_PRODUCT_PATH.test(`${u.pathname}${u.search}`)) return null;
  if (u.href.length > 2048) return null;
  return u;
}

/** Caps that keep a hostile site from flooding the report. */
export const SCAN_CAPS = Object.freeze({ screenshots: 500, seen: 20_000 });

interface State {
  readonly limits: ScanLimits;
  readonly deadline: number;
  readonly outputDir: string | undefined;
  readonly products: ProductResult[];
  readonly pages: PageResult[];
  readonly notes: string[];
  readonly progress: (m: string) => void;
  readonly evaluate: EvaluateOptions;
  screenshots: number;
}

const timeLeft = (s: State): number => s.deadline - Date.now();

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => undefined);
}

function redirectCount(response: Awaited<ReturnType<Page['goto']>>): number {
  let hops = 0;
  for (let r = response?.request().redirectedFrom() ?? null; r !== null; r = r.redirectedFrom()) hops += 1;
  return hops;
}

async function navigate(page: Page, url: string, state: State): Promise<{ error: string | null; httpStatus?: number; notHtml?: boolean }> {
  try {
    const response = await page.goto(url, { waitUntil: 'load', timeout: Math.max(1000, Math.min(state.limits.navigationTimeoutMs, timeLeft(state))) });
    if (response === null) return { error: 'No response' };
    if (redirectCount(response) > state.limits.maxRedirects) return { error: 'Too many redirects', httpStatus: response.status() };
    if (response.status() >= 400) return { error: `HTTP ${String(response.status())}`, httpStatus: response.status() };
    const type = (await response.headerValue('content-type')) ?? '';
    if (!/text\/html|application\/xhtml\+xml/i.test(type)) return { error: null, httpStatus: response.status(), notHtml: true };
    await settle(page);
    return { error: null, httpStatus: response.status() };
  } catch (error) {
    const message = error instanceof Error ? (error.message.split('\n')[0] ?? 'Navigation failed') : 'Navigation failed';
    return { error: message.slice(0, 200) };
  }
}

/** Take cropped screenshots of visible evidence and return results with screenshot paths. */
async function withScreenshots(page: Page, elements: readonly ElementResult[], state: State): Promise<ElementResult[]> {
  const dir = state.outputDir;
  if (dir === undefined) return [...elements];
  const taken = new Map<string, string>();
  const out: ElementResult[] = [];
  for (const r of elements) {
    const evidence: Evidence[] = [];
    for (const e of r.evidence) {
      if (e.selector === '' || e.visibility !== 'visible' || state.screenshots >= SCAN_CAPS.screenshots || timeLeft(state) < 3000) {
        evidence.push(e);
        continue;
      }
      let rel = taken.get(e.selector);
      if (rel === undefined) {
        state.screenshots += 1;
        const name = `E${String(state.screenshots).padStart(4, '0')}.jpg`;
        const ok = await screenshotElement(page, e.selector, dir, name).catch(() => false);
        if (ok) {
          rel = `screenshots/${name}`;
          taken.set(e.selector, rel);
        }
      }
      evidence.push(rel === undefined ? e : { ...e, screenshot: rel });
    }
    out.push({ ...r, evidence });
  }
  return out;
}

/** Load and check one page. Returns same-origin links for the crawl. */
async function checkPage(context: BrowserContext, url: string, state: State, forceProduct: boolean, wantLinks: boolean): Promise<string[]> {
  const page = await context.newPage();
  try {
    state.progress(`page ${String(state.pages.length + 1)}: ${url}`);
    const nav = await navigate(page, url, state);
    const http = nav.httpStatus === undefined ? {} : { httpStatus: nav.httpStatus };
    if (nav.error !== null) {
      state.pages.push({ url, status: 'error', error: nav.error, ...http });
      return [];
    }
    if (nav.notHtml === true) {
      state.pages.push({ url, status: 'not-html', ...http });
      return [];
    }
    const snapshot = await snapshotPage(page);
    const products = pageProducts(snapshot);
    const links = wantLinks ? await collectLinks(page).catch(() => [] as string[]) : [];
    if (!products.isProductPage && !forceProduct) {
      state.pages.push({ url, status: 'not-product', reason: products.reason, ...http });
      return links;
    }
    const facts = pageFacts(snapshot, products);
    const elements = await withScreenshots(page, evaluateFacts(facts, state.evaluate), state);
    const notes: string[] = [];
    if (!products.isProductPage) notes.push(`Checked because the URL was listed, although ${products.reason}.`);
    if (snapshot.truncated) notes.push('Collection limits were reached on this page; some content was not read.');
    const id = `P${String(state.products.length + 1).padStart(4, '0')}`;
    state.products.push(productResult(id, { kind: 'page', url: snapshot.url === '' ? url : snapshot.url }, facts.productName, elements, notes));
    state.pages.push({ url, status: 'product', reason: products.reason, ...http });
    return links;
  } catch (pageError) {
    // A page that navigates away or crashes during analysis must not stop the scan.
    const message = pageError instanceof Error ? (pageError.message.split('\n')[0] ?? '') : 'Analysis failed';
    state.pages.push({ url, status: 'error', error: `Analysis failed: ${message.slice(0, 160)}` });
    return [];
  } finally {
    await page.close().catch(() => undefined);
    // Pages the scanned page opened (pop-ups, including noopener ones) do not outlive it.
    for (const other of context.pages()) await other.close().catch(() => undefined);
  }
}

function robotsAllows(robots: RobotsRules, url: string): boolean {
  try {
    const u = new URL(url);
    return robots.isAllowed(`${u.pathname}${u.search}`);
  } catch {
    return false;
  }
}

async function crawl(session: BrowserSession, start: URL, seeds: readonly string[], robots: RobotsRules, state: State): Promise<void> {
  const origin = start.origin;
  const productQueue: URL[] = [];
  const otherQueue: URL[] = [];
  const seen = new Set<string>();
  const enqueue = (link: string): void => {
    const u = isCrawlable(link, origin);
    if (u === null) return;
    const key = crawlKey(u);
    if (seen.has(key) || seen.size >= SCAN_CAPS.seen) return;
    seen.add(key);
    (PRODUCT_PATH.test(u.pathname) ? productQueue : otherQueue).push(new URL(key));
  };
  seen.add(crawlKey(start));
  otherQueue.push(start);
  for (const s of seeds) enqueue(s);
  const context = await session.newContext();
  try {
    while (state.pages.length < state.limits.maxPages && state.products.length < state.limits.maxProducts) {
      if (timeLeft(state) < 3000) {
        state.notes.push('Time budget reached; the scan stopped early.');
        break;
      }
      const url = productQueue.shift() ?? otherQueue.shift();
      if (url === undefined) break;
      if (!robotsAllows(robots, url.href)) {
        state.pages.push({ url: url.href, status: 'skipped-robots' });
        continue;
      }
      const links = await checkPage(context, url.href, state, false, true);
      for (const l of links) enqueue(l);
    }
  } finally {
    await context.close().catch(() => undefined);
  }
}

async function checkList(session: BrowserSession, urls: readonly string[], ctx: NetContext, state: State): Promise<void> {
  const robotsByOrigin = new Map<string, RobotsRules>();
  const context = await session.newContext();
  try {
    for (const url of urls) {
      if (state.pages.length >= state.limits.maxPages || state.products.length >= state.limits.maxProducts) break;
      if (timeLeft(state) < 3000) {
        state.notes.push('Time budget reached; the scan stopped early.');
        break;
      }
      const origin = new URL(url).origin;
      let robots = robotsByOrigin.get(origin);
      if (robots === undefined) {
        robots = state.limits.respectRobotsTxt ? await fetchRobots(origin, ctx) : ALLOW_ALL;
        if (robotsByOrigin.size < 100) robotsByOrigin.set(origin, robots);
      }
      if (!robotsAllows(robots, url)) {
        state.pages.push({ url, status: 'skipped-robots' });
        continue;
      }
      await checkPage(context, url, state, true, false);
    }
  } finally {
    await context.close().catch(() => undefined);
  }
}

/**
 * A clear message for a Chromium launch failure, or null to keep the original.
 * The sandbox case comes first: it must never be "solved" silently by turning
 * the sandbox off. Pure.
 */
export function launchErrorMessage(message: string): string | null {
  if (/no usable sandbox|sandbox_host_linux|setuid sandbox|namespace|zygote/i.test(message)) {
    return (
      'Chromium could not start its OS sandbox. Safeshelf keeps the sandbox on because it renders untrusted pages. ' +
      'On Linux, allow unprivileged user namespaces (Ubuntu 23.10 and later restrict them through AppArmor), ' +
      'or run Safeshelf inside a container and pass --no-sandbox (or SAFESHELF_NO_SANDBOX=1) so the container is the boundary.'
    );
  }
  if (/Executable doesn't exist|browserType\.launch/i.test(message)) {
    return 'Could not start Chromium. Install it with: npx playwright-core install chromium-headless-shell';
  }
  return null;
}

async function startSession(options: Parameters<typeof BrowserSession.start>[0]): Promise<BrowserSession> {
  try {
    return await BrowserSession.start(options);
  } catch (error) {
    const friendly = launchErrorMessage(error instanceof Error ? error.message : '');
    if (friendly !== null) throw new Error(friendly, { cause: error });
    throw error;
  }
}

/** The sandbox stays on unless the caller turns it off explicitly. Pure. */
export function sandboxSetting(options: Pick<ScanOptions, 'chromiumSandbox'>): boolean {
  return options.chromiumSandbox !== false;
}

/** Largest URL list accepted. */
export const MAX_URL_LIST = 2000;

/**
 * Scan product pages and return a report.
 *
 * @example
 * ```ts
 * import { scan } from '@afkzona/safeshelf';
 * const report = await scan({ url: 'https://shop.example', sitemap: true, maxProducts: 20, outputDir: './safeshelf-report' });
 * console.log(report.summary.productsWithMissing);
 * ```
 */
export async function scan(options: ScanOptions): Promise<SafeshelfReport> {
  const startedAt = new Date().toISOString();
  const limits = normaliseLimits(options);
  if ((options.url === undefined) === (options.urls === undefined)) throw new Error('Give either url (crawl a shop) or urls (a list of product pages)');
  const list = options.urls === undefined ? [] : [...new Set(options.urls.map((u) => checkUrlSyntax(u).href))];
  if (list.length > MAX_URL_LIST) throw new Error(`At most ${String(MAX_URL_LIST)} URLs can be checked in one scan`);
  if (options.urls !== undefined && list.length === 0) throw new Error('The URL list is empty');
  const start = options.url === undefined ? null : checkUrlSyntax(options.url);
  const policy: NetworkPolicy = { allowAddresses: [...(options.allowAddresses ?? [])], resolver: options.resolver ?? systemResolver };
  const fetchLimits: FetchLimits = { maxResponseBytes: limits.maxResponseBytes, requestTimeoutMs: limits.navigationTimeoutMs };
  const budget = new ByteBudget(limits.maxTotalBytes);
  const ctx: NetContext = { policy, limits: fetchLimits, budget, maxRedirects: limits.maxRedirects };
  // Refuse a blocked start URL before launching anything.
  if (start !== null) await resolveAndCheck(start, policy);
  else {
    const first = list[0];
    if (first !== undefined) await resolveAndCheck(first, policy);
  }
  let outputDir: string | undefined;
  if (options.outputDir !== undefined) outputDir = await ensureSubdir(await ensureDir(options.outputDir), 'screenshots');
  const state: State = {
    limits,
    deadline: Date.now() + limits.maxDurationMs,
    outputDir,
    products: [],
    pages: [],
    notes: [],
    progress: options.onProgress ?? (() => undefined),
    evaluate: {
      context: options.context ?? 'shop',
      manufacturerInEu: options.manufacturerInEu ?? 'auto',
      safetyLanguages: options.safetyLanguages ?? [],
      requireSafetyInformation: options.requireSafetyInformation ?? false,
    },
    screenshots: 0,
  };

  let robots: RobotsRules = ALLOW_ALL;
  let seeds: string[] = [];
  if (start !== null) {
    if (limits.respectRobotsTxt || options.sitemap === true) {
      const fetched = await fetchRobots(start.origin, ctx);
      if (limits.respectRobotsTxt) robots = fetched;
      if (options.sitemap === true) {
        state.progress('reading sitemaps');
        const found = await collectSitemapUrls(start.origin, fetched.sitemaps, ctx);
        seeds = found.urls;
        state.notes.push(...found.notes, `Sitemaps listed ${String(found.urls.length)} URL(s) on this site.`);
      }
    }
  }

  const session = await startSession({
    policy,
    limits: fetchLimits,
    budget,
    maxRedirects: limits.maxRedirects,
    viewport: options.viewport ?? { width: 1280, height: 900 },
    locale: options.locale ?? 'en-GB',
    chromiumSandbox: sandboxSetting(options),
  });
  try {
    if (start !== null) await crawl(session, start, seeds, robots, state);
    else await checkList(session, list, ctx, state);
  } finally {
    await session.close();
  }
  const blocked = session.blocked;
  if (blocked.length > 0) state.notes.push(`${String(blocked.length)} request(s) were refused by the network guard (see blockedRequests).`);
  if (start !== null && state.products.length === 0) state.notes.push('No product pages were found. Try --sitemap, a higher --max-pages, or a list of product URLs.');
  if (state.products.length >= limits.maxProducts) state.notes.push(`The product limit of ${String(limits.maxProducts)} was reached.`);

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    tool: { name: 'safeshelf', version: TOOL_VERSION },
    kind: 'scan',
    startedAt,
    finishedAt: new Date().toISOString(),
    input: start === null ? { urlCount: list.length } : { startUrl: start.href },
    options: {
      context: state.evaluate.context ?? 'shop',
      manufacturerInEu: state.evaluate.manufacturerInEu ?? 'auto',
      safetyLanguages: [...(state.evaluate.safetyLanguages ?? [])],
      requireSafetyInformation: state.evaluate.requireSafetyInformation ?? false,
    },
    products: state.products,
    pages: state.pages,
    summary: summarize(state.products),
    provisions: referencedProvisions(state.evaluate.context ?? 'shop'),
    blockedRequests: blocked,
    limits,
    notes: state.notes,
    disclaimer: DISCLAIMER,
  };
}
