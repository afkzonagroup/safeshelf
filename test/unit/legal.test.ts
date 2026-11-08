// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Legal data checked against stored copies of the official texts
 * (test/fixtures/legal, downloaded from EUR-Lex on 8 November 2026).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EU_LANGUAGES, LABEL_PHRASES } from '../../src/data/labels.js';
import { ELEMENTS, provisionFor } from '../../src/legal/elements.js';
import { PROVISIONS, type ProvisionId } from '../../src/legal/provisions.js';
import { referencedProvisions } from '../../src/report/types.js';
import { ELEMENT_IDS } from '../../src/types.js';

const fixture = (name: string): string => readFileSync(new URL(`../fixtures/legal/${name}`, import.meta.url), 'utf8');
const squash = (s: string): string => s.replace(/\s+/g, ' ');
const GPSR = squash(fixture('gpsr-en-oj.txt'));
const MSR = squash(fixture('msr-en-consolidated-20260812.txt'));
const ART19 = JSON.parse(fixture('gpsr-art19.json')) as { texts: Record<string, string> };
/** GPSR Art. 3, point (12): the definition of "fulfilment service provider" in every language version. */
const ART3_12 = JSON.parse(fixture('gpsr-art3-12.json')) as { texts: Record<string, string> };

describe('provision catalogue', () => {
  it.each(Object.values(PROVISIONS).map((p) => [p.id, p] as const))('%s quotes the official English text verbatim', (_id, p) => {
    const source = p.id.startsWith('msr-') ? MSR : GPSR;
    expect(source).toContain(squash(p.quote));
  });

  it('links every provision to EUR-Lex with an article anchor', () => {
    for (const p of Object.values(PROVISIONS)) expect(p.url).toMatch(/^https:\/\/eur-lex\.europa\.eu\/legal-content\/EN\/TXT\/\?uri=CELEX:0\d{4}R\d{4}-\d{8}#art_\d+$/);
  });

  it('cites the article each id names', () => {
    const expected: Partial<Record<ProvisionId, string>> = {
      'gpsr-19-a': 'GPSR Art. 19(a)',
      'gpsr-19-d': 'GPSR Art. 19(d)',
      'gpsr-22-9-b': 'GPSR Art. 22(9)(b)',
      'gpsr-16-1': 'GPSR Art. 16(1)',
      'msr-4-1': 'Regulation (EU) 2019/1020 Art. 4(1)',
    };
    for (const [id, citation] of Object.entries(expected)) expect(PROVISIONS[id as ProvisionId].citation).toBe(citation);
    for (const p of Object.values(PROVISIONS)) {
      const art = /Art\. (\d+)/.exec(p.citation)?.[1];
      expect(p.url.endsWith(`#art_${art ?? 'x'}`)).toBe(true);
    }
  });

  it('records the date of application from Art. 52', () => {
    expect(PROVISIONS['gpsr-52'].quote).toBe('It shall apply from 13 December 2024.');
    expect(GPSR).toContain('It shall apply from 13 December 2024.');
  });

  it('Art. 19 still applies to harmonised products: Art. 2(1)(b) excludes Chapter III Section 1 only', () => {
    expect(GPSR).toContain('Chapter III, Section 1, Chapters V and VII and Chapters IX to XI do not apply.');
    expect(GPSR).toMatch(/SECTION 2 Article 19 Obligations of economic operators in the case of distance sales/);
  });
});

describe('elements', () => {
  it('each element cites Art. 19 for shops and Art. 22(9) for marketplaces, with the same point letter', () => {
    for (const id of ELEMENT_IDS) {
      const shop = provisionFor(id, 'shop');
      const market = provisionFor(id, 'marketplace');
      expect(shop).toMatch(/^gpsr-19-[a-d]$/);
      expect(market).toBe(`gpsr-22-9-${shop.slice(-1)}`);
    }
  });

  it('maps elements to the right point of Art. 19', () => {
    expect(ELEMENTS['manufacturer-postal-address'].provision).toBe('gpsr-19-a');
    expect(ELEMENTS['responsible-person-electronic-address'].provision).toBe('gpsr-19-b');
    expect(ELEMENTS['product-picture'].provision).toBe('gpsr-19-c');
    expect(ELEMENTS['product-type'].provision).toBe('gpsr-19-c');
    expect(ELEMENTS['safety-information'].provision).toBe('gpsr-19-d');
  });

  it('marks only the responsible person and warnings as conditional', () => {
    expect(ELEMENT_IDS.filter((id) => ELEMENTS[id].conditional)).toEqual([
      'responsible-person-name',
      'responsible-person-postal-address',
      'responsible-person-electronic-address',
      'safety-information',
    ]);
  });

  it('reports list the provisions they rely on', () => {
    const shop = referencedProvisions('shop').map((p) => p.id);
    expect(shop).toEqual(expect.arrayContaining(['gpsr-19-a', 'gpsr-19-b', 'gpsr-19-c', 'gpsr-19-d', 'gpsr-16-1', 'msr-4-1', 'gpsr-52']));
    expect(shop).not.toContain('gpsr-22-9-a');
    expect(referencedProvisions('marketplace').map((p) => p.id)).toEqual(expect.arrayContaining(['gpsr-22-9-a', 'gpsr-19-a']));
  });
});

describe('label phrases', () => {
  const wordIn = (phrase: string, text: string): boolean => {
    const esc = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
    return new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, 'iu').test(text);
  };

  it('has the official text of Art. 19 in all 24 languages', () => {
    expect(Object.keys(ART19.texts).sort()).toEqual(EU_LANGUAGES.map((l) => l.toUpperCase()).sort());
  });

  it.each(LABEL_PHRASES.filter((p) => p.source === 'official-text' && p.category !== 'fulfilment').map((p) => [p.lang, p.text] as const))(
    '[%s] "%s" appears as a whole word in that language version of Art. 19',
    (lang, text) => {
      expect(wordIn(text, ART19.texts[lang.toUpperCase()] ?? '')).toBe(true);
    },
  );

  it('has the definition of "fulfilment service provider" (Art. 3, point (12)) in all 24 languages', () => {
    expect(Object.keys(ART3_12.texts).sort()).toEqual(EU_LANGUAGES.map((l) => l.toUpperCase()).sort());
    expect(GPSR).toContain('‘fulfilment service provider’ means any natural or legal person offering');
  });

  it.each(EU_LANGUAGES)('[%s] has a fulfilment service provider label taken from the defined term of Art. 3, point (12)', (lang) => {
    const official = LABEL_PHRASES.filter((p) => p.lang === lang && p.category === 'fulfilment' && p.source === 'official-text');
    expect(official.length).toBeGreaterThan(0);
    // Typographic apostrophes in the official text compare equal to the ASCII apostrophe of the label.
    const definition = (ART3_12.texts[lang.toUpperCase()] ?? '').replace(/[’‘]/g, "'");
    for (const p of official) expect(wordIn(p.text, definition), p.text).toBe(true);
  });

  it('covers the manufacturer, responsible person and warnings in every official language', () => {
    for (const lang of EU_LANGUAGES) {
      for (const category of ['manufacturer', 'responsible', 'fulfilment', 'safety'] as const) {
        expect(LABEL_PHRASES.some((p) => p.lang === lang && p.category === category), `${lang} ${category}`).toBe(true);
      }
    }
  });

  it('marks English as original and every other unofficial phrase as translation', () => {
    for (const p of LABEL_PHRASES) {
      if (p.source === 'original') expect(p.lang).toBe('en');
      if (p.lang !== 'en' && p.source !== 'official-text') expect(p.source).toBe('translation');
    }
  });

  it('stores phrases in lower case without surrounding spaces', () => {
    for (const p of LABEL_PHRASES) expect(p.text).toBe(p.text.toLowerCase().trim());
  });
});
