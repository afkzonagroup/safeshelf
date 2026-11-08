// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Re-validation of data read from a scanned page.
 *
 * The collector runs in the page's own JavaScript world, so a hostile page can
 * replace built-ins and return anything: wrong types, huge strings, huge
 * arrays, deep nesting. Everything is checked here, in Node, before the
 * detectors see it.
 */

import type { CollectArgs } from './page-scripts.js';
import type { BlockLink, BlockVisibility, ImageInfo, MicroItem, MicroProp, PageSnapshot, TextBlock } from './snapshot.js';

const MAX_SELECTOR = 600;

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const bool = (v: unknown): boolean => v === true;
const list = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);

/**
 * True for a selector produced by the collector: plain CSS with no Playwright
 * engine prefix and no chaining. Used before handing a page-supplied selector
 * back to Playwright.
 */
export function isPlainCssSelector(selector: string): boolean {
  return (
    selector.length > 0 &&
    selector.length <= MAX_SELECTOR &&
    !selector.includes('>>') &&
    // A Playwright engine prefix such as "xpath=" or "internal:control=".
    !/^\s*[a-zA-Z_][\w:+*-]*\s*=/.test(selector) &&
    // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
    !/[\u0000-\u001f\u007f]/.test(selector)
  );
}

const selector = (v: unknown): string => {
  const s = str(v, MAX_SELECTOR);
  return isPlainCssSelector(s) ? s : '';
};

/** Only http(s) and mailto links, at most 2048 characters. */
const safeLink = (v: unknown): string => {
  const s = str(v, 2048);
  return /^(?:https?:|mailto:)/i.test(s) ? s : '';
};

const VISIBILITY = new Set<BlockVisibility>(['visible', 'collapsed', 'hidden']);

function links(v: unknown): BlockLink[] {
  return list(v, 5)
    .map((l) => {
      const x = isObj(l) ? l : {};
      return { href: safeLink(x.href), text: str(x.text, 200) };
    })
    .filter((l) => l.href !== '');
}

function microItem(v: unknown, depth: number, budget: { props: number }): MicroItem {
  const x = isObj(v) ? v : {};
  const types = list(x.types, 5).map((t) => str(t, 200)).filter((t) => t !== '');
  const props: MicroProp[] = [];
  for (const p of list(x.props, 500)) {
    if (budget.props <= 0) break;
    budget.props -= 1;
    const y = isObj(p) ? p : {};
    const name = str(y.name, 100);
    if (name === '') continue;
    const nested = depth < 5 && isObj(y.item) ? microItem(y.item, depth + 1, budget) : undefined;
    props.push({ name, value: str(y.value, 2000), selector: selector(y.selector), ...(nested === undefined ? {} : { item: nested }) });
  }
  return { types, props };
}

/** Caps used when validating; matches the collector's arguments. */
export type SanitizeCaps = Pick<CollectArgs, 'maxBlocks' | 'maxBlockChars' | 'maxJsonLd' | 'maxJsonLdChars' | 'maxMicroItems' | 'maxMicroProps' | 'maxImages'>;

/** Validate and cap a snapshot returned by the page. Pure. */
export function sanitizeSnapshot(raw: unknown, caps: SanitizeCaps): PageSnapshot {
  const o = isObj(raw) ? raw : {};
  const blockCount = Math.min(Array.isArray(o.blocks) ? o.blocks.length : 0, caps.maxBlocks);
  const blocks: TextBlock[] = list(o.blocks, caps.maxBlocks).map((b) => {
    const x = isObj(b) ? b : {};
    const level = num(x.level);
    const vis = str(x.visibility, 20) as BlockVisibility;
    return {
      selector: selector(x.selector),
      text: str(x.text, caps.maxBlockChars),
      tag: str(x.tag, 20).toLowerCase(),
      headingLike: bool(x.headingLike),
      level: Number.isInteger(level) && level >= 0 && level <= 6 ? level : 0,
      lead: str(x.lead, 60),
      visibility: VISIBILITY.has(vis) ? vis : 'hidden',
      links: links(x.links),
      panel: list(x.panel, 40).filter((i): i is number => typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < blockCount),
    };
  });
  const jsonLd = list(o.jsonLd, caps.maxJsonLd).filter((j): j is string => typeof j === 'string' && j.length <= caps.maxJsonLdChars);
  const budget = { props: caps.maxMicroProps };
  const microdata = list(o.microdata, caps.maxMicroItems).map((m) => microItem(m, 0, budget));
  const meta = list(o.meta, 100).map((m) => {
    const x = isObj(m) ? m : {};
    return { property: str(x.property, 100).toLowerCase(), content: str(x.content, 2048) };
  });
  const images: ImageInfo[] = list(o.images, caps.maxImages).map((i) => {
    const x = isObj(i) ? i : {};
    return {
      selector: selector(x.selector),
      src: str(x.src, 2048),
      alt: str(x.alt, 200),
      width: Math.min(100_000, Math.max(0, num(x.width))),
      height: Math.min(100_000, Math.max(0, num(x.height))),
      inMain: bool(x.inMain),
    };
  });
  const truncated =
    bool(o.truncated) ||
    (Array.isArray(o.blocks) && o.blocks.length > caps.maxBlocks) ||
    (Array.isArray(o.jsonLd) && o.jsonLd.length > caps.maxJsonLd) ||
    (Array.isArray(o.microdata) && o.microdata.length > caps.maxMicroItems);
  return {
    url: str(o.url, 2048),
    title: str(o.title, 300),
    lang: str(o.lang, 20),
    blocks,
    jsonLd,
    microdata,
    meta,
    images,
    backgroundImages: Math.min(100_000, Math.max(0, Math.floor(num(o.backgroundImages)))),
    iframes: Math.min(100_000, Math.max(0, Math.floor(num(o.iframes)))),
    addToCart: bool(o.addToCart),
    truncated,
  };
}

/** Validate links returned by the page: http(s) strings only, capped. Pure. */
export function sanitizeLinks(raw: unknown, max: number): string[] {
  return list(raw, max).filter((l): l is string => typeof l === 'string' && l.length <= 2048 && /^https?:/i.test(l));
}
