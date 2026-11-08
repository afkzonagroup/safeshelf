// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/** The Playwright helper on real pages in Playwright's bundled Chromium (in-process). */
import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkPage, formatProblems, safeshelfMatchers } from '../../src/playwright/index.js';
import { startFixtures, type Fixtures } from '../helpers/server.js';

let fx: Fixtures;
let browser: Browser;
beforeAll(async () => {
  fx = await startFixtures();
  browser = await chromium.launch({ headless: true, chromiumSandbox: true });
});
afterAll(async () => {
  await browser.close();
  await fx.close();
});

const local = (p: string): string => `http://127.0.0.1:${String(fx.port)}${p}`;

describe('Playwright helper', () => {
  it('checks the current page and lists problems', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(local('/products/no-info.html'));
      const r = await checkPage(page);
      expect(r.isProductPage).toBe(true);
      expect(r.productName).toBe('Plain product');
      expect(r.problems.map((p) => p.element)).toEqual(['manufacturer-name', 'manufacturer-postal-address', 'manufacturer-electronic-address', 'product-picture', 'product-identifier']);
      expect(formatProblems(r.problems)).toMatch(/^- Manufacturer name \(GPSR Art\. 19\(a\)\): not-found, medium confidence/);
      expect(formatProblems(r.problems, 'marketplace')).toMatch(/GPSR Art\. 22\(9\)\(a\)/);
      const reviewToo = await checkPage(page, { elements: ['product-type'], failOnReview: true });
      expect(reviewToo.problems.map((p) => p.status)).toEqual(['review']);
    } finally {
      await page.close();
    }
  });

  it('the matcher passes on a complete page and fails with a readable message otherwise', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(local('/products/toy-lt.html'));
      const ok = await safeshelfMatchers.toShowGpsrInformation.call({}, page);
      expect(ok.pass).toBe(true);
      expect(ok.message()).toMatch(/found all selected items/);
      await page.goto(local('/products/mug-fr.html'));
      const bad = await safeshelfMatchers.toShowGpsrInformation.call({}, page, { elements: ['manufacturer-postal-address'] });
      expect(bad.pass).toBe(false);
      expect(bad.message()).toMatch(/could not find 1 item\(s\)/);
    } finally {
      await page.close();
    }
  });
});
