// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import type { Page } from 'playwright-core';
import { CART_SOURCE } from '../data/cart.js';
import { safeWriteFile } from '../util/files.js';
import { collectPage, type CollectArgs } from './page-scripts.js';
import { isPlainCssSelector, sanitizeLinks, sanitizeSnapshot } from './sanitize.js';
import type { PageSnapshot } from './snapshot.js';

/** Longest time any in-page evaluation may take. A page that blocks its main thread fails instead of hanging the scan. */
export const EVALUATE_TIMEOUT_MS = 15_000;

/**
 * Run an in-page evaluation with a deadline. On timeout the page is closed,
 * which also ends the pending evaluation.
 */
export async function withDeadline<T>(page: Page, work: Promise<T>, ms: number = EVALUATE_TIMEOUT_MS): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      void page.close().catch(() => undefined);
      reject(new Error(`Page evaluation exceeded ${String(ms)} ms`));
    }, ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** Caps for the in-page collector. */
export const COLLECT_ARGS: CollectArgs = Object.freeze({
  maxElements: 30_000,
  maxBlocks: 4000,
  maxBlockChars: 2000,
  maxJsonLd: 30,
  maxJsonLdChars: 500_000,
  maxMicroItems: 50,
  maxMicroProps: 3000,
  maxImages: 12,
  cartSource: CART_SOURCE,
});

/** Where in-page code runs. */
export type EvaluationWorld = 'isolated' | 'main';

/**
 * Run a self-contained function in the page and return its JSON result.
 *
 * With `isolated` (the scanner), the function runs in a separate JavaScript
 * world created through the Chrome DevTools Protocol, like a browser
 * extension's content script: it sees the page's DOM, but the page's scripts
 * cannot replace the built-ins it uses (Array.from, String.prototype.slice,
 * getComputedStyle, ...), so its size caps hold. `main` uses Playwright's
 * `page.evaluate` in the page's own world; the Playwright helper falls back to
 * it in browsers without DevTools Protocol access. Either way the result is
 * re-validated in Node.
 */
export async function evaluateInPage<A>(page: Page, fn: (arg: A) => unknown, arg: A, world: EvaluationWorld): Promise<unknown> {
  if (world === 'main') return await withDeadline(page, page.evaluate(fn as (a: unknown) => unknown, arg as unknown));
  const cdp = await page.context().newCDPSession(page);
  try {
    const work = (async () => {
      const tree = await cdp.send('Page.getFrameTree');
      const { executionContextId } = await cdp.send('Page.createIsolatedWorld', { frameId: tree.frameTree.frame.id, worldName: 'safeshelf-collector', grantUniveralAccess: false });
      const result = await cdp.send('Runtime.evaluate', {
        expression: `(${fn.toString()})(${JSON.stringify(arg)})`,
        contextId: executionContextId,
        returnByValue: true,
        awaitPromise: false,
      });
      if (result.exceptionDetails !== undefined) throw new Error(`In-page collection failed: ${(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text).split('\n')[0] ?? ''}`);
      return result.result.value as unknown;
    })();
    return await withDeadline(page, work);
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}

/** The world for a page: isolated where the DevTools Protocol is available (Chromium), else main. */
export async function bestWorld(page: Page): Promise<EvaluationWorld> {
  try {
    const cdp = await page.context().newCDPSession(page);
    await cdp.detach().catch(() => undefined);
    return 'isolated';
  } catch {
    return 'main';
  }
}

/** Collect a snapshot of the current page. The result is re-validated because the page can tamper with what it returns. */
export async function snapshotPage(page: Page, world: EvaluationWorld = 'isolated'): Promise<PageSnapshot> {
  return sanitizeSnapshot(await evaluateInPage(page, collectPage, COLLECT_ARGS, world), COLLECT_ARGS);
}

/** In-page link collector. Self-contained; see `evaluateInPage`. */
export function collectAnchors(limit: number): string[] {
  const out: string[] = [];
  for (const a of Array.from(document.querySelectorAll('a[href]'))) {
    if (out.length >= limit) break;
    const href = (a as HTMLAnchorElement).href;
    if (href.startsWith('http:') || href.startsWith('https:')) out.push(href);
  }
  return out;
}

/** Same-origin http(s) links on the page (capped). */
export async function collectLinks(page: Page, max = 1000, world: EvaluationWorld = 'isolated'): Promise<string[]> {
  return sanitizeLinks(await evaluateInPage(page, collectAnchors, max, world), max);
}

/** Screenshot limits. */
export const SCREENSHOT_LIMITS = Object.freeze({ maxWidth: 1200, maxHeight: 800, padding: 6, quality: 70 });

/**
 * Save a cropped JPEG screenshot of an element. Returns false when the element
 * is not visible or has no box. The file name is generated by the caller and
 * validated again when written.
 */
export async function screenshotElement(page: Page, selector: string, dir: string, fileName: string): Promise<boolean> {
  // Evidence selectors come from the page; only plain CSS selectors are used.
  if (!isPlainCssSelector(selector)) return false;
  const locator = page.locator(selector).first();
  if ((await page.locator(selector).count().catch(() => 0)) === 0) return false;
  if (!(await locator.isVisible().catch(() => false))) return false;
  await locator.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => undefined);
  const box = await locator.boundingBox({ timeout: 2000 }).catch(() => null);
  if (box === null || box.width < 1 || box.height < 1) return false;
  const vp = page.viewportSize() ?? { width: 1280, height: 800 };
  const L = SCREENSHOT_LIMITS;
  const x = Math.max(0, box.x - L.padding);
  const y = Math.max(0, box.y - L.padding);
  const width = Math.min(box.x + box.width + L.padding, vp.width) - x;
  const height = Math.min(box.y + box.height + L.padding, vp.height) - y;
  if (width < 1 || height < 1) return false;
  const clip = { x, y, width: Math.min(width, L.maxWidth), height: Math.min(height, L.maxHeight) };
  const buffer = await page.screenshot({ clip, type: 'jpeg', quality: L.quality, animations: 'disabled', timeout: 5000 }).catch(() => null);
  if (buffer === null) return false;
  await safeWriteFile(dir, fileName, buffer);
  return true;
}
