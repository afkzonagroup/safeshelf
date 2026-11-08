// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { COLLECT_ARGS } from '../../src/browser/page-ops.js';
import { isPlainCssSelector, sanitizeLinks, sanitizeSnapshot } from '../../src/browser/sanitize.js';

describe('sanitizeSnapshot (data from a hostile page)', () => {
  it('turns garbage into an empty, well-typed snapshot', () => {
    for (const raw of [null, 5, 'x', [], { blocks: 'x', jsonLd: {}, images: null }]) {
      const s = sanitizeSnapshot(raw, COLLECT_ARGS);
      expect(s.blocks).toEqual([]);
      expect(s.jsonLd).toEqual([]);
      expect(s.images).toEqual([]);
      expect(s.truncated).toBe(false);
    }
  });

  it('caps counts and string lengths and marks truncation', () => {
    const raw = {
      blocks: Array.from({ length: COLLECT_ARGS.maxBlocks + 10 }, () => ({ text: 'x'.repeat(10_000), selector: 'p', visibility: 'visible', links: [] })),
      jsonLd: ['{}', 'y'.repeat(COLLECT_ARGS.maxJsonLdChars + 1)],
      title: 't'.repeat(1000),
    };
    const s = sanitizeSnapshot(raw, COLLECT_ARGS);
    expect(s.blocks).toHaveLength(COLLECT_ARGS.maxBlocks);
    expect(s.blocks[0]?.text).toHaveLength(COLLECT_ARGS.maxBlockChars);
    expect(s.jsonLd).toEqual(['{}']);
    expect(s.title).toHaveLength(300);
    expect(s.truncated).toBe(true);
  });

  it('refuses wrong types, engine selectors, bad links and out-of-range panel indices', () => {
    const s = sanitizeSnapshot(
      {
        blocks: [
          { text: 5, selector: 'xpath=//a', headingLike: 'yes', level: 99, visibility: 'shown', links: [{ href: 'javascript:alert(1)' }, { href: 'mailto:a@b.example', text: 'mail' }], panel: [0, 1, -1, 1.5, 'x', 99] },
          { text: 'b', selector: 'div >> text=x', panel: [] },
        ],
        microdata: [{ types: ['https://schema.org/Product'], props: [{ name: 'name', value: 'A', selector: 'internal:control=x' }, { name: '', value: 'x' }, { name: 'm', item: { props: [{ name: 'n', value: 'deep' }] } }] }],
        images: [{ selector: '#i', src: 'x', width: -5, height: 1e12, inMain: 1 }],
        backgroundImages: 'many',
        iframes: Infinity,
      },
      COLLECT_ARGS,
    );
    const b = s.blocks[0];
    expect(b).toMatchObject({ text: '', selector: '', headingLike: false, level: 0, visibility: 'hidden' });
    expect(b?.links).toEqual([{ href: 'mailto:a@b.example', text: 'mail' }]);
    expect(b?.panel).toEqual([0, 1]);
    expect(s.blocks[1]?.selector).toBe('');
    expect(s.microdata[0]?.props.map((p) => p.name)).toEqual(['name', 'm']);
    expect(s.microdata[0]?.props[0]?.selector).toBe('');
    expect(s.microdata[0]?.props[1]?.item?.props[0]?.value).toBe('deep');
    expect(s.images[0]).toMatchObject({ width: 0, height: 100_000, inMain: false });
    expect(s.backgroundImages).toBe(0);
    expect(s.iframes).toBe(0);
  });

  it('caps microdata properties across nested items', () => {
    // Shared references: a small object graph that expands to 400^8 properties if walked naively.
    let item: unknown = { types: [], props: [] };
    for (let d = 0; d < 8; d += 1) item = { types: [], props: Array.from({ length: 400 }, () => ({ name: 'p', value: 'v', item })) };
    const s = sanitizeSnapshot({ microdata: [item] }, COLLECT_ARGS);
    let count = 0;
    const walk = (items: readonly { props: readonly { item?: unknown }[] }[]): void => {
      for (const i of items) {
        count += i.props.length;
        walk(i.props.map((p) => p.item).filter((x): x is { props: readonly { item?: unknown }[] } => x !== undefined));
      }
    };
    walk(s.microdata);
    expect(count).toBeLessThanOrEqual(COLLECT_ARGS.maxMicroProps);
  });
});

describe('selectors and links', () => {
  it.each(['xpath=//a', ' css=a', 'internal:control=enter-frame', 'a >> b', 'a\nb', 'x'.repeat(601), ''])('refuses %j', (s) => {
    expect(isPlainCssSelector(s)).toBe(false);
  });
  it.each(['#id', 'main > p:nth-of-type(2)', 'a[href="x=1"]'])('accepts %j', (s) => {
    expect(isPlainCssSelector(s)).toBe(true);
  });
  it('keeps only http(s) links', () => {
    expect(sanitizeLinks(['https://a.example', 'javascript:x', 5, 'http://b.example', 'x'.repeat(3000)], 10)).toEqual(['https://a.example', 'http://b.example']);
  });
});
