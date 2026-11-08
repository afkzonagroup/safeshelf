// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { PageSnapshot, TextBlock } from '../../src/browser/snapshot.js';
import { COUNTRIES } from '../../src/data/countries.js';
import { absenceConfidence, establishment, evaluateFacts, judge, rankCandidates } from '../../src/detect/evaluate.js';
import { EMPTY_PARTY, type Candidate, type Coverage, type ProductFacts } from '../../src/detect/facts.js';
import { containsWords, pageFacts, pageProducts } from '../../src/detect/page-facts.js';
import { parseJsonLd, productsFromJsonLd, productsFromMicrodata, typesOf } from '../../src/detect/structured.js';
import type { ElementId, Evidence, Visibility } from '../../src/types.js';

const ev = (visibility: Visibility, extra: Partial<Evidence> = {}): Evidence => ({ source: 'text', text: 'x', selector: '#x', field: '', visibility, ...extra });
const cand = (strength: Candidate['strength'], visibility: Visibility, value = 'v'): Candidate => ({ value, strength, evidence: ev(visibility) });
const pageCoverage: Coverage = { kind: 'page', limitations: [], mappedElements: new Set() };
const country = (code: string) => {
  const c = COUNTRIES.find((x) => x.code === code);
  if (c === undefined) throw new Error(code);
  return c;
};

const facts = (over: Partial<ProductFacts> = {}): ProductFacts => ({
  productName: 'Thing',
  manufacturer: EMPTY_PARTY,
  responsible: EMPTY_PARTY,
  brands: [],
  sellers: [],
  pictures: [],
  types: [],
  identifiers: [],
  safety: [],
  coverage: pageCoverage,
  ...over,
});
const byId = (f: ProductFacts, options = {}) => Object.fromEntries(evaluateFacts(f, options).map((r) => [r.element, r])) as Record<ElementId, ReturnType<typeof evaluateFacts>[number]>;

describe('judge', () => {
  it('found, with confidence from strength', () => {
    expect(judge('product-picture', [cand('strong', 'visible')], pageCoverage, 'x')).toMatchObject({ status: 'found', confidence: 'high' });
    expect(judge('product-picture', [cand('medium', 'visible')], pageCoverage, 'x')).toMatchObject({ status: 'found', confidence: 'medium' });
  });
  it('a weak match asks for review', () => {
    expect(judge('product-type', [cand('weak', 'visible')], pageCoverage, 'x')).toMatchObject({ status: 'review', confidence: 'low' });
  });
  it('collapsed content is found with lower confidence and a note', () => {
    const r = judge('safety-information', [cand('strong', 'collapsed')], pageCoverage, 'x');
    expect(r).toMatchObject({ status: 'found', confidence: 'medium' });
    expect(r.explanation).toMatch(/collapsed/);
  });
  it('hidden or structured-only content is found-not-visible', () => {
    expect(judge('manufacturer-name', [cand('strong', 'hidden')], pageCoverage, 'x')).toMatchObject({ status: 'found-not-visible', confidence: 'medium' });
    expect(judge('manufacturer-name', [cand('medium', 'hidden')], pageCoverage, 'x')).toMatchObject({ status: 'found-not-visible', confidence: 'low' });
  });
  it('prefers visible evidence over stronger hidden evidence', () => {
    expect(rankCandidates([cand('strong', 'hidden', 'a'), cand('medium', 'visible', 'b')])[0]?.value).toBe('b');
    expect(judge('manufacturer-name', [cand('strong', 'hidden'), cand('medium', 'visible')], pageCoverage, 'x').status).toBe('found');
  });
  it('not found: medium on a fully read page, low with limitations, high for an empty mapped feed column', () => {
    expect(absenceConfidence('product-picture', pageCoverage)).toBe('medium');
    expect(absenceConfidence('product-picture', { ...pageCoverage, limitations: ['1 frame(s) were not read'] })).toBe('low');
    expect(absenceConfidence('product-picture', { kind: 'feed', limitations: [], mappedElements: new Set(['product-picture']) })).toBe('high');
    expect(absenceConfidence('product-type', { kind: 'feed', limitations: [], mappedElements: new Set(['product-picture']) })).toBe('medium');
    const r = judge('product-picture', [], pageCoverage, 'picture');
    expect(r.status).toBe('not-found');
    expect(r.explanation).toMatch(/^Information not found: picture\. It may still be on the page/);
  });
  it('keeps at most three pieces of evidence', () => {
    const many = Array.from({ length: 6 }, () => cand('strong', 'visible'));
    expect(judge('product-picture', many, pageCoverage, 'x').evidence).toHaveLength(3);
  });
});

describe('responsible person (Art. 19(b))', () => {
  const party = (codes: string[]) => ({ ...EMPTY_PARTY, countries: codes.map(country) });
  it('decides establishment from the setting, the feed, then the address country', () => {
    expect(establishment(facts(), 'yes').state).toBe('eu');
    expect(establishment(facts(), 'no').state).toBe('non-eu');
    expect(establishment(facts({ manufacturerInEu: false }), 'auto').state).toBe('non-eu');
    expect(establishment(facts({ manufacturer: party(['DE']) }), 'auto').state).toBe('eu');
    expect(establishment(facts({ manufacturer: party(['CN']) }), 'auto').state).toBe('non-eu');
    expect(establishment(facts({ manufacturer: party(['NO']) }), 'auto').state).toBe('unknown');
    expect(establishment(facts({ manufacturer: party(['DE', 'CN']) }), 'auto').state).toBe('unknown');
    expect(establishment(facts(), 'auto').state).toBe('unknown');
  });
  it('not applicable for an EU manufacturer, not found for a non-EU one, review when unknown', () => {
    expect(byId(facts({ manufacturer: party(['DE']) }))['responsible-person-name']).toMatchObject({ status: 'not-applicable', confidence: 'medium' });
    expect(byId(facts(), { manufacturerInEu: 'yes' })['responsible-person-name']).toMatchObject({ status: 'not-applicable', confidence: 'high' });
    const nonEu = byId(facts({ manufacturer: party(['CN']) }))['responsible-person-postal-address'];
    expect(nonEu.status).toBe('not-found');
    expect(nonEu.explanation).toMatch(/outside the EU \(CN\)/);
    expect(byId(facts())['responsible-person-electronic-address']).toMatchObject({ status: 'review', confidence: 'low' });
  });
  it('reports a responsible person that is shown, whatever the establishment', () => {
    const f = facts({ manufacturer: party(['DE']), responsible: { ...EMPTY_PARTY, names: [cand('strong', 'visible')] } });
    expect(byId(f)['responsible-person-name'].status).toBe('found');
  });
});

describe('manufacturer name', () => {
  it('a brand alone needs review, because it may or may not be the manufacturer’s trade mark', () => {
    const r = byId(facts({ brands: [cand('medium', 'visible', 'Bolo')] }))['manufacturer-name'];
    expect(r).toMatchObject({ status: 'review', confidence: 'medium' });
    expect(r.explanation).toMatch(/registered trade mark/);
  });
  it('a brand only in structured data stays not visible', () => {
    expect(byId(facts({ brands: [cand('medium', 'hidden', 'Bolo')] }))['manufacturer-name'].status).toBe('review');
  });
  it('on a marketplace, collapsed content is explained with both standards', () => {
    const r = byId(facts({ pictures: [cand('strong', 'collapsed')] }), { context: 'marketplace' })['product-picture'];
    expect(r.explanation).toMatch(/Art\. 22\(9\) accepts information "displayed or otherwise made easily accessible"/);
    expect(byId(facts({ pictures: [cand('strong', 'collapsed')] }))['product-picture'].explanation).not.toMatch(/22\(9\)/);
  });
  it('seller details are not taken for the manufacturer', () => {
    const r = byId(facts({ sellers: [cand('medium', 'visible', 'CableMart GmbH')] }), { context: 'marketplace' })['manufacturer-name'];
    expect(r.status).toBe('not-found');
    expect(r.explanation).toMatch(/not necessarily the manufacturer/);
    expect(r.explanation).toMatch(/Art\. 22\(9\)/);
  });
});

describe('identifier and type (Art. 19(c))', () => {
  it('no other identifier but a type: review', () => {
    expect(byId(facts({ types: [cand('strong', 'visible')] }))['product-identifier']).toMatchObject({ status: 'review', confidence: 'low' });
  });
  it('neither: not found', () => {
    expect(byId(facts())['product-identifier'].status).toBe('not-found');
  });
});

describe('warnings (Art. 19(d))', () => {
  it('missing warnings need review unless the products are known to have them', () => {
    expect(byId(facts())['safety-information']).toMatchObject({ status: 'review', confidence: 'low' });
    expect(byId(facts(), { requireSafetyInformation: true })['safety-information'].status).toBe('not-found');
  });
  it('flags warnings labelled in a language the user did not list', () => {
    const safety = [{ value: 'Do not swallow', strength: 'strong' as const, evidence: ev('visible', { labelLanguage: 'en', label: 'warning', labelSource: 'official-text' }) }];
    expect(byId(facts({ safety }), { safetyLanguages: ['lt'] })['safety-information']).toMatchObject({ status: 'review', confidence: 'medium' });
    expect(byId(facts({ safety }), { safetyLanguages: ['lt', 'en'] })['safety-information'].status).toBe('found');
    expect(byId(facts({ safety }))['safety-information'].status).toBe('found');
  });
});

describe('structured data', () => {
  it('reads @graph with @id references, arrays and prefixed types', () => {
    const doc = parseJsonLd(
      JSON.stringify({
        '@context': 'https://schema.org',
        '@graph': [
          { '@type': 'Organization', '@id': '#m', name: 'Maker', email: 'mailto:m@x.example', address: { '@type': 'PostalAddress', streetAddress: 'Str. 1', postalCode: '10115', addressLocality: 'Berlin', addressCountry: { name: 'DE' } } },
          { '@type': ['schema:Product'], name: 'P', gtin: 4006381333931, mpn: 'M1', image: [{ '@type': 'ImageObject', name: 'front', url: 'https://x.example/a.jpg' }], manufacturer: { '@id': '#m' }, additionalProperty: [{ '@type': 'PropertyValue', name: 'Warning', value: 'Hot' }] },
        ],
      }),
    );
    expect(doc).not.toBeNull();
    const [p] = productsFromJsonLd(doc === null ? [] : [doc]);
    expect(p?.manufacturer?.name?.value).toBe('Maker');
    expect(p?.manufacturer?.emails[0]?.value).toBe('m@x.example');
    expect(p?.manufacturer?.addresses[0]?.text).toBe('Str. 1, 10115 Berlin, DE');
    expect(p?.identifiers.map((i) => `${i.kind}:${i.value}`)).toEqual(['gtin:4006381333931', 'mpn:M1']);
    expect(p?.images[0]?.value).toBe('https://x.example/a.jpg');
    expect(p?.properties).toEqual([{ name: 'Warning', value: 'Hot', field: 'Product.additionalProperty' }]);
  });
  it('rejects invalid or oversized JSON and normalises type names', () => {
    expect(parseJsonLd('{nope')).toBeNull();
    expect(parseJsonLd('x'.repeat(600_000))).toBeNull();
    expect(parseJsonLd('<!-- {"a":1} -->')).toEqual({ a: 1 });
    expect(typesOf({ '@type': 'http://schema.org/Product' })).toEqual(['Product']);
  });
  it('survives very deep nesting and huge graphs within caps', () => {
    let deep: unknown = { '@type': 'Product', name: 'deep' };
    for (let i = 0; i < 5000; i += 1) deep = { a: deep };
    expect(productsFromJsonLd([deep as never])).toEqual([]);
    const many = { '@graph': Array.from({ length: 100 }, (_v, i) => ({ '@type': 'Product', name: `p${String(i)}` })) };
    expect(productsFromJsonLd([many as never])).toHaveLength(20);
  });
  it('reads microdata items, including nested organisations', () => {
    const [p] = productsFromMicrodata([
      {
        types: ['https://schema.org/Product'],
        props: [
          { name: 'name', value: 'Kettle', selector: '' },
          { name: 'gtin13', value: '5901234123457', selector: '' },
          { name: 'manufacturer', value: '', selector: '', item: { types: ['https://schema.org/Organization'], props: [{ name: 'name', value: 'Maker', selector: '' }, { name: 'address', value: 'ul. Długa 5, 00-238 Warszawa', selector: '' }] } },
        ],
      },
    ]);
    expect(p?.manufacturer?.name?.value).toBe('Maker');
    expect(p?.manufacturer?.addresses[0]?.text).toBe('ul. Długa 5, 00-238 Warszawa');
  });
});

const block = (text: string, extra: Partial<TextBlock> = {}): TextBlock => ({ selector: `#b${String(text.length)}`, text, tag: 'p', headingLike: false, level: 0, lead: '', visibility: 'visible', links: [], panel: [], ...extra });
const snapshot = (over: Partial<PageSnapshot> = {}): PageSnapshot => ({
  url: 'https://shop.example/products/x',
  title: 'X',
  lang: 'en',
  blocks: [],
  jsonLd: [],
  microdata: [],
  meta: [],
  images: [],
  backgroundImages: 0,
  iframes: 0,
  addToCart: false,
  truncated: false,
  ...over,
});

describe('page facts', () => {
  it('recognises product pages from structured data, Open Graph or URL plus add-to-cart', () => {
    expect(pageProducts(snapshot({ jsonLd: ['{"@type":"Product","name":"A"}'] })).isProductPage).toBe(true);
    expect(pageProducts(snapshot({ jsonLd: ['[{"@type":"Product","name":"A"},{"@type":"Product","name":"B"}]'] })).isProductPage).toBe(false);
    expect(pageProducts(snapshot({ meta: [{ property: 'og:type', content: 'product' }] })).isProductPage).toBe(true);
    expect(pageProducts(snapshot({ addToCart: true })).isProductPage).toBe(true);
    expect(pageProducts(snapshot({ addToCart: true, url: 'https://shop.example/about' })).isProductPage).toBe(false);
    expect(pageProducts(snapshot()).isProductPage).toBe(false);
  });

  it('marks structured data as visible only when the visible text shows it', () => {
    const json = '{"@type":"Product","name":"A","manufacturer":{"name":"Maker Ltd","email":"m@maker.example"}}';
    const hidden = pageFacts(snapshot({ jsonLd: [json] }));
    expect(hidden.manufacturer.names[0]?.evidence.visibility).toBe('hidden');
    const shown = pageFacts(snapshot({ jsonLd: [json], blocks: [block('Contact m@maker.example')] }));
    expect(shown.manufacturer.electronic[0]?.evidence.visibility).toBe('visible');
  });

  it('needs the whole name in the visible text, not a word that contains it', () => {
    const json = '{"@type":"Product","name":"Vase","manufacturer":{"name":"Ora"}}';
    const inside = pageFacts(snapshot({ jsonLd: [json], blocks: [block('Decorative stoneware from our Florentine collection')] }));
    expect(inside.manufacturer.names[0]?.evidence.visibility).toBe('hidden');
    const named = pageFacts(snapshot({ jsonLd: [json], blocks: [block('Made by Ora, Florence')] }));
    expect(named.manufacturer.names[0]?.evidence.visibility).toBe('visible');
    expect(containsWords('item 4006381333931.', '4006381333931')).toBe(true);
    expect(containsWords('x40063813339310', '4006381333931')).toBe(false);
    expect(containsWords('model wk-17 black', 'wk-17')).toBe(true);
  });

  it('puts a picture of the product before a wide banner', () => {
    const f = pageFacts(
      snapshot({
        blocks: [block('Men\'s Wool Runner', { level: 1, headingLike: true, tag: 'h1' })],
        images: [
          { selector: '#wide', src: 'https://shop.example/files/BrandMessage_Lifestyle_16x9.jpg', alt: '', width: 1224, height: 478, inMain: true },
          { selector: '#shot', src: 'https://shop.example/files/WL_RN_Natural_Grey.jpg', alt: "Men's Wool Runner - Natural Grey", width: 734, height: 419, inMain: true },
        ],
      }),
    );
    expect(f.pictures.map((c) => [c.evidence.selector, c.strength])).toEqual([
      ['#shot', 'strong'],
      ['#wide', 'medium'],
    ]);
    expect(rankCandidates(f.pictures)[0]?.evidence.selector).toBe('#shot');
  });

  it('ignores logos and icons as product pictures', () => {
    const f = pageFacts(snapshot({ images: [{ selector: '#logo', src: 'https://shop.example/logo.png', alt: 'Shop logo', width: 300, height: 300, inMain: true }] }));
    expect(f.pictures).toEqual([]);
    const icons = pageFacts(snapshot({ images: [{ selector: '#p', src: 'https://shop.example/payment-icons.png', alt: '', width: 300, height: 300, inMain: true }] }));
    expect(icons.pictures).toEqual([]);
    // Only whole words: "Silicone" contains "icon" but is a product picture.
    const silicone = pageFacts(snapshot({ images: [{ selector: '#m', src: 'https://shop.example/img/mat.png', alt: 'Silicone baking mats', width: 500, height: 500, inMain: true }] }));
    expect(silicone.pictures).toHaveLength(1);
  });

  it('lists what could not be read', () => {
    const f = pageFacts(snapshot({ truncated: true, iframes: 2, backgroundImages: 1, blocks: [block('Manufacturer', { headingLike: true })] }));
    expect(f.coverage.limitations).toEqual([
      'collection limits were reached, so part of the page was not read',
      '2 frame(s) were not read',
      'pictures set as CSS backgrounds are not inspected',
      '1 labelled section(s) had no readable content (they may load on click)',
    ]);
  });

  it('additionalProperty pairs count as labelled data', () => {
    const json = JSON.stringify({ '@type': 'Product', name: 'A', additionalProperty: [{ name: 'Manufacturer', value: 'Maker GmbH, Hauptstraße 5, 10115 Berlin, Germany' }] });
    const f = pageFacts(snapshot({ jsonLd: [json] }));
    expect(f.manufacturer.names[0]?.value).toBe('Maker GmbH');
    expect(f.manufacturer.names[0]?.evidence.visibility).toBe('hidden');
    expect(f.manufacturer.countries.map((c) => c.code)).toEqual(['DE']);
  });
});
