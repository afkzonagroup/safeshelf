// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Detection quality on a corpus of product pages written like real shops
 * (Shopify, WooCommerce and marketplace markup; ten languages; information in
 * tabs, accordions, images, dialogs that load on click, and missing), with a
 * hand-labelled ground truth in test/fixtures/shop/corpus/truth.json. The
 * pages are scanned through the full scanner (Chromium, guard proxy).
 * Pages c01 to c20 were written first and the detection was fixed against
 * them; pages h21 to h25 were written afterwards as a held-out check; c26 (a
 * mega menu larger than the collection caps) was added for a later fix, and
 * c27 and c28 for the fulfilment service provider (Regulation (EU) 2019/1020
 * Art. 4(2)(d)): one with contact details, and the word only in delivery text.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scan } from '../../src/scan.js';
import type { SafeshelfReport } from '../../src/report/types.js';
import type { ElementId, Status } from '../../src/types.js';
import { startFixtures, type Fixtures } from '../helpers/server.js';

const CORPUS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/shop/corpus');
type Truth = 'present' | 'hidden' | 'absent' | 'unreadable' | 'n/a';
const KEYS: Readonly<Record<string, ElementId>> = {
  mn: 'manufacturer-name',
  mpa: 'manufacturer-postal-address',
  mea: 'manufacturer-electronic-address',
  rpn: 'responsible-person-name',
  rppa: 'responsible-person-postal-address',
  rpea: 'responsible-person-electronic-address',
  pic: 'product-picture',
  type: 'product-type',
  id: 'product-identifier',
  safety: 'safety-information',
};
const data = JSON.parse(readFileSync(path.join(CORPUS, 'truth.json'), 'utf8')) as {
  pages: Record<string, Record<string, Truth>>;
  known: Record<string, Record<string, { status: Status; why: string }>>;
};
const truth = data.pages;
const pages = readdirSync(CORPUS).filter((f) => f.endsWith('.html')).sort();

let fx: Fixtures;
let dir: string;
let report: SafeshelfReport;
beforeAll(async () => {
  fx = await startFixtures();
  dir = await mkdtemp(path.join(os.tmpdir(), 'safeshelf-corpus-'));
  report = await scan({ urls: pages.map((p) => `${fx.base}/corpus/${p}`), resolver: fx.resolver, allowAddresses: fx.allowAddresses, maxPages: 100, maxProducts: 100 });
}, 180_000);
afterAll(async () => {
  await fx.close();
  await rm(dir, { recursive: true, force: true });
});

/** Status for one page and element. */
function statusOf(page: string, element: ElementId): Status {
  const p = report.products.find((x) => x.source.kind === 'page' && x.source.url.endsWith(`/corpus/${page}`));
  const r = p?.elements.find((e) => e.element === element);
  if (r === undefined) throw new Error(`no result for ${page} ${element}`);
  return r.status;
}

/** Whether a status is the right answer for a ground-truth label. `review` is right where a person must decide. */
function correct(t: Truth, s: Status): boolean {
  switch (t) {
    case 'present':
      return s === 'found';
    case 'hidden':
      return s === 'found-not-visible';
    case 'absent':
      return s === 'not-found' || s === 'review';
    case 'unreadable':
      return s === 'not-found' || s === 'review';
    case 'n/a':
      return s === 'not-applicable';
  }
}

describe('detection corpus', () => {
  it('has a ground truth for every page and at least 15 pages', () => {
    expect(pages.length).toBeGreaterThanOrEqual(15);
    expect(Object.keys(truth).sort()).toEqual(pages);
    expect(report.products).toHaveLength(pages.length);
  });

  it.each(pages)('%s: every item matches the ground truth', (page) => {
    const wrong: string[] = [];
    for (const [key, element] of Object.entries(KEYS)) {
      const t = truth[page]?.[key];
      if (t === undefined) throw new Error(`no truth for ${page} ${key}`);
      const s = statusOf(page, element);
      const known = data.known[page]?.[key];
      if (known !== undefined) {
        if (s !== known.status) wrong.push(`${key}: known answer ${known.status}, got ${s}`);
      } else if (!correct(t, s)) wrong.push(`${key}: truth ${t}, got ${s}`);
    }
    expect(wrong).toEqual([]);
  });

  it('names the fulfilment service provider as the responsible person, and not the delivery text', () => {
    const rp = (page: string) => report.products.find((x) => x.source.kind === 'page' && x.source.url.endsWith(`/corpus/${page}`))?.elements.find((e) => e.element === 'responsible-person-name');
    const found = rp('c27-de-fulfilment-provider.html');
    expect(found?.status).toBe('found');
    expect(found?.confidence).toBe('high');
    expect(found?.evidence[0]?.text).toBe('LogiHub Europe GmbH');
    expect(found?.explanation).toMatch(/Art\. 4\(2\)\(d\)/);
    const delivery = rp('c28-en-fulfilment-delivery-only.html');
    expect(delivery?.status).toBe('not-found');
    expect(delivery?.evidence).toEqual([]);
  });

  it('per-item precision and recall of "found" (printed with SAFESHELF_CORPUS_REPORT=1)', () => {
    const rows: string[] = [];
    for (const [key, element] of Object.entries(KEYS)) {
      let tp = 0;
      let fp = 0;
      let fn = 0;
      let review = 0;
      for (const page of pages) {
        const t = truth[page]?.[key] ?? 'absent';
        const s = statusOf(page, element);
        const detected = s === 'found' || s === 'found-not-visible';
        const there = t === 'present' || t === 'hidden' || t === 'unreadable';
        if (s === 'review') review += 1;
        if (detected && there) tp += 1;
        else if (detected) fp += 1;
        else if (there) fn += 1;
      }
      const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
      const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
      rows.push(`${key}\ttp=${String(tp)}\tfp=${String(fp)}\tfn=${String(fn)}\treview=${String(review)}\tprecision=${precision.toFixed(2)}\trecall=${recall.toFixed(2)}`);
    }
    if (process.env.SAFESHELF_CORPUS_REPORT === '1') process.stdout.write(`${rows.join('\n')}\n`);
    expect(rows).toHaveLength(10);
  });
});
