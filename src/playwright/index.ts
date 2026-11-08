// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Playwright test helper: check a product page inside your own Playwright
 * tests, for example after a theme change.
 *
 * The page is yours (your test, your network), so the scanner's SSRF guard
 * does not apply here: this helper fetches nothing itself.
 *
 * @example
 * ```ts
 * import { test, expect } from '@playwright/test';
 * import { safeshelfMatchers } from '@afkzona/safeshelf/playwright';
 * expect.extend(safeshelfMatchers);
 *
 * test('product page shows the GPSR information', async ({ page }) => {
 *   await page.goto('/products/kettle');
 *   await expect(page).toShowGpsrInformation({ manufacturerInEu: 'yes' });
 * });
 * ```
 */

import type { Page } from 'playwright-core';
import { bestWorld, snapshotPage } from '../browser/page-ops.js';
import { evaluateFacts, type EvaluateOptions } from '../detect/evaluate.js';
import { pageFacts, pageProducts } from '../detect/page-facts.js';
import { ELEMENTS, provisionFor } from '../legal/elements.js';
import { PROVISIONS } from '../legal/provisions.js';
import { MISSING_STATUSES } from '../report/types.js';
import type { ElementId, ElementResult, SalesContext } from '../types.js';

/** Options for {@link checkPage}. */
export interface CheckPageOptions extends EvaluateOptions {
  /** Elements that must be found. Default: all. */
  readonly elements?: readonly ElementId[];
  /** Also fail on elements marked for review. Default false. */
  readonly failOnReview?: boolean;
}

/** Result of {@link checkPage}. */
export interface PageCheck {
  readonly url: string;
  readonly productName: string;
  /** True if the page looks like a product page. */
  readonly isProductPage: boolean;
  readonly elements: readonly ElementResult[];
  /** Selected elements that are not found or not visible (and, with `failOnReview`, for review). */
  readonly problems: readonly ElementResult[];
}

/**
 * Check the current state of `page`. Works with pages from `@playwright/test`
 * and `playwright` / `playwright-core`.
 */
export async function checkPage(page: Page, options: CheckPageOptions = {}): Promise<PageCheck> {
  // Chromium: an isolated world; other browsers: the page's own world (your own page).
  const snapshot = await snapshotPage(page, await bestWorld(page));
  const products = pageProducts(snapshot);
  const facts = pageFacts(snapshot, products);
  const elements = evaluateFacts(facts, options);
  const wanted = new Set<ElementId>(options.elements ?? elements.map((e) => e.element));
  const problems = elements.filter((e) => wanted.has(e.element) && (MISSING_STATUSES.has(e.status) || (options.failOnReview === true && e.status === 'review')));
  return { url: page.url(), productName: facts.productName, isProductPage: products.isProductPage, elements, problems };
}

/** Format problems for a test failure message. */
export function formatProblems(problems: readonly ElementResult[], context: SalesContext = 'shop'): string {
  return problems
    .map((r) => {
      const cite = PROVISIONS[provisionFor(r.element, context)].citation;
      return `- ${ELEMENTS[r.element].title} (${cite}): ${r.status}, ${r.confidence} confidence\n  ${r.explanation}`;
    })
    .join('\n');
}

/** Result shape expected by `expect.extend` in Playwright Test and Vitest. */
export interface MatcherResult {
  readonly pass: boolean;
  readonly message: () => string;
  readonly name: string;
}

/**
 * Custom matchers for `expect.extend`. `toShowGpsrInformation` passes when
 * every selected element is found (or not applicable, or for review unless
 * `failOnReview` is set).
 */
export const safeshelfMatchers = {
  async toShowGpsrInformation(this: unknown, page: Page, options: CheckPageOptions = {}): Promise<MatcherResult> {
    const result = await checkPage(page, options);
    const pass = result.problems.length === 0;
    return {
      pass,
      name: 'toShowGpsrInformation',
      message: () =>
        pass
          ? `Expected missing GPSR information on ${result.url}, but Safeshelf found all selected items.`
          : `Safeshelf could not find ${String(result.problems.length)} item(s) on ${result.url}:\n${formatProblems(result.problems, options.context)}`,
    };
  },
};
