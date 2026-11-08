// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { countryFromValue, findCountry, findEmails, findObfuscatedEmail, findWebAddress, isEmail, scoreAddress } from '../../src/detect/address.js';
import { identifierKindOf, isPlausibleIdentifier, isValidGtin, looksLikeGtin } from '../../src/detect/identifiers.js';
import { partyBuilder } from '../../src/detect/facts.js';
import { addPartyText, addSections, cutBeforeAddress, decodeMailto, extractPartyName, identifierCandidate, isContactLink, isShopNotice, looksLikePartyDetails, onlyDocumentLinks, type FactsBuilder } from '../../src/detect/interpret.js';
import { bestVisibility, findSections, labelOf, type TextUnit } from '../../src/detect/sections.js';
import { clip, isPlaceholder, matchLabel, normalizeText } from '../../src/detect/text.js';
import type { Evidence } from '../../src/types.js';

const unit = (text: string, extra: Partial<TextUnit> = {}): TextUnit => ({
  selector: '',
  text,
  tag: 'p',
  headingLike: false,
  level: 0,
  lead: '',
  visibility: 'visible',
  links: [],
  ...extra,
});

describe('normalizeText and helpers', () => {
  it('normalises case, quotes, dashes and spaces', () => {
    expect(normalizeText('  HERSTELLER’S  Name – x ')).toBe("hersteller's name - x");
  });
  it('clips long text with an ellipsis', () => {
    expect(clip('abcdef', 4)).toBe('abc…');
    expect(clip('abc', 4)).toBe('abc');
  });
  it.each(['n/a', 'N/A', '-', '—', '?', 'unknown', 'See packaging', 'siehe Verpackung', 'k. A.', 'TBD', '', '...', '000'])('"%s" is a placeholder', (v) => {
    expect(isPlaceholder(v)).toBe(true);
  });
  it.each(['ACME GmbH', 'N.A. Products Ltd', 'Unknown Pleasures Records'])('"%s" is not a placeholder', (v) => {
    expect(isPlaceholder(v)).toBe(false);
  });
});

describe('matchLabel', () => {
  const m = (text: string, headingLike = false) => matchLabel(text, { headingLike });
  it.each([
    ['Manufacturer: ACME Ltd', 'manufacturer', 'en', 'ACME Ltd'],
    ['Hersteller: Kochwerk GmbH', 'manufacturer', 'de', 'Kochwerk GmbH'],
    ['Fabricant : Bolo SAS', 'manufacturer', 'fr', 'Bolo SAS'],
    ['Gamintojas – UAB Gaminys', 'manufacturer', 'lt', 'UAB Gaminys'],
    ['Producent: Grzałka Sp. z o.o.', 'manufacturer', 'pl', 'Grzałka Sp. z o.o.'],
    ['EU Responsible Person: Lumo Europe B.V.', 'responsible', 'en', 'Lumo Europe B.V.'],
    ['Verantwortliche Person in der EU: X GmbH', 'responsible', 'de', 'X GmbH'],
    ['Importer: Imp Ltd', 'importer', 'en', 'Imp Ltd'],
    ['Warnings: Keep away from fire', 'safety', 'en', 'Keep away from fire'],
    ['Warnhinweise: Nicht verschlucken', 'safety', 'de', 'Nicht verschlucken'],
    ['Model number: K-200', 'type', 'en', 'K-200'],
    ['EAN: 4006381333931', 'identifier', 'en', '4006381333931'],
    ['Manufacturer part number: MP-1', 'identifier', 'en', 'MP-1'],
    ['Sold by: Shop GmbH', 'seller', 'en', 'Shop GmbH'],
    ['Manufacturer (name and address): ACME', 'manufacturer', 'en', 'ACME'],
    ['• Manufacturer: ACME', 'manufacturer', 'en', 'ACME'],
    ['EAN-koodi: 6430123456783', 'identifier', 'en', '6430123456783'],
    ['EAN-Code: 4006381333931', 'identifier', 'en', '4006381333931'],
    ['ean13: 5905555123455', 'identifier', 'en', '5905555123455'],
  ])('"%s" is a %s label (%s)', (text, category, lang, value) => {
    const r = m(text);
    expect(r?.phrase.category).toBe(category);
    expect(r?.phrase.lang).toBe(lang);
    expect(r?.value).toBe(value);
  });

  it('accepts short heading-like labels without a separator', () => {
    expect(m('Manufacturer information', true)?.phrase.category).toBe('manufacturer');
    expect(m('Herstellerinformationen', true)?.value).toBe('');
    expect(m('Manufacturer', false)?.value).toBe('');
    expect(m('Manufacturer:', false)?.value).toBe('');
  });

  it.each([
    'The manufacturer recommends charging at room temperature.',
    'Manufacturer warranty: 2 years',
    "Manufacturer's guarantee: 5 years",
    'Hersteller-Garantie: 2 Jahre',
    'Type-C cable for fast charging',
    'Typically ships in 2 days',
    'Type-C: 1 port',
    'Warningly bright colours',
    'Manufacturer website: https://acme.example',
    'Manufacturer recommended price: 20 EUR',
    'Responsabile del trattamento: Casa Caffè S.r.l., Via Roma 10, 20121 Milano',
    'Responsible person for data protection: Jane Doe, privacy@shop.example',
    'Verantwoordelijke voor de verwerking: Shop B.V.',
    'Responsable du traitement : Boutique SAS',
  ])('"%s" is not a party, type or safety label', (text) => {
    const r = m(text);
    expect(r === null || r.phrase.category === 'identifier').toBe(true);
  });

  it('does not read long running text as a heading', () => {
    expect(m('Manufacturer of fine furniture since 1890 with workshops in three countries and a showroom', true)).toBeNull();
  });
});

describe('sections', () => {
  it('collects the inline value and continuation lines up to the next label', () => {
    const s = findSections([unit('Manufacturer: ACME GmbH'), unit('Hauptstraße 5, 10115 Berlin'), unit('info@acme.example'), unit('Warnings: Hot surface')]);
    expect(s.map((x) => x.category)).toEqual(['manufacturer', 'safety']);
    expect(s[0]?.body).toBe('ACME GmbH\nHauptstraße 5, 10115 Berlin\ninfo@acme.example');
  });

  it('a heading label takes content until the next heading of the same level', () => {
    const s = findSections([
      unit('Herstellerinformationen', { headingLike: true, level: 2, tag: 'h2' }),
      unit('Kochwerk GmbH'),
      unit('Industriestraße 12'),
      unit('Details', { headingLike: true, level: 3, tag: 'h3' }),
      unit('more'),
      unit('Versand', { headingLike: true, level: 2, tag: 'h2' }),
      unit('Lieferung in 2 Tagen'),
    ]);
    expect(s[0]?.body).toBe('Kochwerk GmbH\nIndustriestraße 12\nDetails\nmore');
  });

  it('an inline label stops at the next heading-like unit', () => {
    const s = findSections([unit('Manufacturer: ACME'), unit('Description', { headingLike: true }), unit('Nice product')]);
    expect(s[0]?.body).toBe('ACME');
  });

  it('a tab takes its panel, and a panel of labelled parts is left to those parts', () => {
    const units = [
      unit('Product safety', { headingLike: true, panel: [2, 3] }),
      unit('Description', { headingLike: true, panel: [4] }),
      unit('Manufacturer: Lumo Ltd', { visibility: 'collapsed' }),
      unit('Warning: Hot', { visibility: 'collapsed' }),
      unit('A lamp.', { visibility: 'collapsed' }),
    ];
    const s = findSections(units);
    expect(s.find((x) => x.match.phrase.text === 'product safety')?.body).toBe('');
    expect(s.find((x) => x.category === 'manufacturer')?.visibility).toBe('collapsed');
  });

  it('a heading-like tab takes plain panel text', () => {
    const s = findSections([unit('Safety information', { headingLike: true, panel: [1] }), unit('Do not swallow.', { visibility: 'collapsed' })]);
    expect(s[0]?.body).toBe('Do not swallow.');
    expect(s[0]?.visibility).toBe('collapsed');
  });

  it('splits a block of "label: value" lines into one section per label (<br>-separated product details)', () => {
    const s = findSections([unit('Modèle : Classic 24\nCode-barres : 3760123450010\nRéférence : CSN-24-INOX')]);
    expect(s.map((x) => [x.category, x.body])).toEqual([
      ['type', 'Classic 24'],
      ['identifier', '3760123450010'],
      ['identifier', 'CSN-24-INOX'],
    ]);
  });

  it('keeps the address lines of an inline party label with the label', () => {
    const s = findSections([unit('Hersteller: Kaffeewelt GmbH\nBahnhofstraße 7\n20095 Hamburg\nDeutschland\nTel. +49 40 123456\nE-Mail: info@kaffeewelt.example')]);
    expect(s).toHaveLength(1);
    expect(s[0]?.body.split('\n')).toEqual(['Kaffeewelt GmbH', 'Bahnhofstraße 7', '20095 Hamburg', 'Deutschland', 'Tel. +49 40 123456', 'E-Mail: info@kaffeewelt.example']);
  });

  it('reads a label alone on the first line of a block', () => {
    const s = findSections([unit('Manufacturer\nACME Ltd\n1 Main Street, Leeds LS1 4AP')]);
    expect(s[0]?.category).toBe('manufacturer');
    expect(s[0]?.body).toBe('ACME Ltd\n1 Main Street, Leeds LS1 4AP');
  });

  it('maps tab panels to the split units', () => {
    const s = findSections([unit('Details', { headingLike: true, panel: [1] }), unit('Model: K1\nEAN: 4006381333931', { visibility: 'collapsed' }), unit('Model: other')]);
    expect(s.filter((x) => x.category === 'type').map((x) => x.body)).toEqual(['K1', 'other']);
    expect(s.filter((x) => x.category === 'identifier').map((x) => x.body)).toEqual(['4006381333931']);
  });

  it('reads a "Type" label without a model number as a possible category, and model labels as the type', () => {
    const types = (text: string) => {
      const b: FactsBuilder = { manufacturer: partyBuilder(), responsible: partyBuilder(), brands: [], sellers: [], pictures: [], types: [], identifiers: [], safety: [] };
      addSections(b, findSections([unit(text)]));
      return b.types.map((c) => c.strength);
    };
    expect(types('Type: Phone case')).toEqual(['weak']);
    expect(types('Typ: KD-S-2025')).toEqual(['strong']);
    expect(types('Modell: Linnea')).toEqual(['strong']);
    expect(types('Item model number: BS-PB10')).toEqual(['strong']);
  });

  it('reads an ASIN as an identifier of medium strength, like a SKU', () => {
    const b: FactsBuilder = { manufacturer: partyBuilder(), responsible: partyBuilder(), brands: [], sellers: [], pictures: [], types: [], identifiers: [], safety: [] };
    addSections(b, findSections([unit('ASIN: B0C1Z4XQ7K')]));
    expect(b.identifiers.map((c) => [c.value, c.kind, c.strength])).toEqual([['B0C1Z4XQ7K', 'sku', 'medium']]);
  });

  it('asks for review when the warnings section is only a link to a PDF', () => {
    const pdf = { href: 'https://shop.example/media/safety.pdf', text: 'Safety instructions (PDF, 2 MB)' };
    const run = (units: TextUnit[]) => {
      const b: FactsBuilder = { manufacturer: partyBuilder(), responsible: partyBuilder(), brands: [], sellers: [], pictures: [], types: [], identifiers: [], safety: [] };
      addSections(b, findSections(units));
      return b.safety.map((c) => c.strength);
    };
    expect(run([unit('Safety information', { headingLike: true, panel: [1] }), unit('Safety instructions (PDF, 2 MB)', { links: [pdf], visibility: 'collapsed' })])).toEqual(['weak']);
    expect(run([unit('Warnings: Do not immerse in water. See also the manual (PDF).', { links: [{ href: 'https://shop.example/m.pdf', text: 'the manual (PDF)' }] })])).toEqual(['strong']);
    expect(onlyDocumentLinks('Download: manual', [{ href: 'https://shop.example/manual.pdf', text: 'manual' }])).toBe(true);
  });

  it('reads a fulfilment service provider as the responsible person, citing Art. 4(2)(d)', () => {
    const run = (units: TextUnit[]) => {
      const b: FactsBuilder = { manufacturer: partyBuilder(), responsible: partyBuilder(), brands: [], sellers: [], pictures: [], types: [], identifiers: [], safety: [] };
      addSections(b, findSections(units));
      return b.responsible;
    };
    const rp = run([unit('Fulfilment service provider: LogiHub Europe GmbH, Lagerstraße 12, 04435 Schkeuditz, Germany, gpsr@logihub.example')]);
    expect(rp.names.map((c) => [c.value, c.strength])).toEqual([['LogiHub Europe GmbH', 'strong']]);
    expect(rp.names[0]?.note).toMatch(/Regulation \(EU\) 2019\/1020 Art\. 4\(2\)\(d\)/);
    expect(rp.postal[0]?.strength).toBe('strong');
    expect(rp.electronic.map((c) => c.value)).toEqual(['gpsr@logihub.example']);
    // Official wording in other languages, as a heading with the details below.
    expect(run([unit('Fulfilment-Dienstleister', { headingLike: true, level: 3 }), unit('LogiHub Europe GmbH\nLagerstraße 12\n04435 Schkeuditz\nDeutschland')]).names[0]?.value).toBe('LogiHub Europe GmbH');
    expect(run([unit('Dostawca usług realizacji zamówień: Magazyn Sp. z o.o., ul. Składowa 8, 61-897 Poznań, Polska')]).names[0]?.value).toBe('Magazyn Sp. z o.o.');
  });

  it('does not read delivery text with a logistics word as the responsible person', () => {
    const run = (units: TextUnit[]) => {
      const b: FactsBuilder = { manufacturer: partyBuilder(), responsible: partyBuilder(), brands: [], sellers: [], pictures: [], types: [], identifiers: [], safety: [] };
      addSections(b, findSections(units));
      return [b.responsible.names.length, b.responsible.postal.length, b.responsible.electronic.length, b.responsible.sections.length];
    };
    for (const text of [
      'Fulfilment service provider: dispatch within 24 hours from our warehouse',
      'Fulfillment service provider: DHL',
      'Logisztikai szolgáltató: GLS, kézbesítés 2-3 munkanap',
      'Prestador de servicios logísticos: entrega en 48 horas',
      'Orders are packed by our fulfilment service provider and shipped in 2 days.',
      'Fulfilment: ships from our EU warehouse within 1-2 business days.',
    ]) {
      expect(run([unit(text)]), text).toEqual([0, 0, 0, 0]);
    }
    expect(looksLikePartyDetails('LogiHub Europe GmbH, Lagerstraße 12, 04435 Schkeuditz, Germany')).toBe(true);
    expect(looksLikePartyDetails('Versandzentrum GmbH, Lagerstraße 12, 04435 Schkeuditz, info@vz.example')).toBe(true);
  });

  it('does not take shop notices under a warning word for safety information', () => {
    const safety = (text: string) => {
      const b: FactsBuilder = { manufacturer: partyBuilder(), responsible: partyBuilder(), brands: [], sellers: [], pictures: [], types: [], identifiers: [], safety: [] };
      addSections(b, findSections([unit(text)]));
      return b.safety.length;
    };
    for (const notice of [
      'Warning: only 3 left in stock!',
      'Attenzione: spedizione gratuita per ordini superiori a 49 €.',
      'Achtung: Versandkostenfrei ab 50 €',
      'Attention : livraison gratuite dès 60 €',
      'Uwaga: darmowa dostawa od 99 zł',
      'Warning: this site uses cookies.',
    ]) expect(safety(notice)).toBe(0);
    for (const warning of ['Warning: Keep away from fire.', 'Achtung: Nicht für Kinder unter 3 Jahren geeignet.', 'Warning: remove the shipping bolts before use.']) expect(safety(warning)).toBe(1);
    expect(isShopNotice('Disconnect from the mains before changing the bulb. Max 40 W.')).toBe(false);
  });

  it('reads a leading label element ("<span>Merk</span> Velo")', () => {
    const l = labelOf(unit('Merk Velo', { lead: 'Merk' }));
    expect(l?.phrase.category).toBe('brand');
    expect(l?.value).toBe('Velo');
  });

  it('picks the most visible visibility', () => {
    expect(bestVisibility(['hidden', 'collapsed'])).toBe('collapsed');
    expect(bestVisibility(['hidden', 'visible'])).toBe('visible');
    expect(bestVisibility([])).toBe('hidden');
  });
});

describe('postal addresses', () => {
  it.each([
    ['Hauptstraße 5, 10115 Berlin, Germany', 'strong', 'DE'],
    ['12 rue de la Paix, 75002 Paris, France', 'strong', 'FR'],
    ['ul. Długa 5, 00-238 Warszawa, Polska', 'strong', 'PL'],
    ['Keizersgracht 12, 1015 CS Amsterdam, Netherlands', 'strong', 'NL'],
    ['Gedimino pr. 1, LT-01103 Vilnius, Lietuva', 'strong', 'LT'],
    ['Storgatan 1, 111 51 Stockholm, Sweden', 'strong', 'SE'],
    ['88 Keji Road, Nanshan District, Shenzhen 518057, China', 'strong', 'CN'],
    ['500 Market Street, San Francisco, CA 94105, USA', 'strong', 'US'],
    ['Rua Augusta 10, 1100-053 Lisboa, Portugal', 'strong', 'PT'],
    ['1 Sound Lane, Dublin D02 X285, Ireland', 'strong', 'IE'],
    ['Postfach 1234, 80001 München', 'medium', undefined],
    ['4 Harbour Road, Kowloon, Hong Kong', 'medium', 'HK'],
  ])('%s', (text, strength, country) => {
    const hit = scoreAddress(text);
    expect(hit?.strength).toBe(strength);
    expect(hit?.country?.code).toBe(country);
  });

  it.each(['ACME GmbH', 'Since 1998', 'Price 49.90 EUR', 'Call 0800 123 456', 'info@acme.example', 'certified ISO 9001', 'Germany'])(
    '"%s" is not a medium or strong address',
    (text) => {
      const hit = scoreAddress(text);
      expect(hit === null || hit.strength === 'weak').toBe(true);
    },
  );

  it('ignores a country of origin and takes the last country named', () => {
    expect(findCountry('ACME GmbH, Berlin, Germany. Made in China')?.code).toBe('DE');
    expect(findCountry('Hergestellt in China. Vertrieb: X GmbH, 10115 Berlin, Deutschland')?.code).toBe('DE');
    expect(findCountry('Unit 5, 12 Rd, Shenzhen, China')?.code).toBe('CN');
    expect(findCountry('Industriestraße 12, 70565 Stuttgart, DE')?.code).toBe('DE');
    expect(findCountry('nothing here')).toBeNull();
  });

  it('knows the usual countries of origin in several languages', () => {
    expect(findCountry('Organize Sanayi Bölgesi 3. Cadde No: 12, 16140 Bursa, Turcja')?.code).toBe('TR');
    expect(findCountry('Futian, Shenzhen 518000, Chiny')?.code).toBe('CN');
    expect(findCountry('Shenzhen, Kinija')?.code).toBe('CN');
    expect(findCountry('Londýn, Spojené království')?.code).toBe('GB');
    expect(scoreAddress('Organize Sanayi Bölgesi 3. Cadde No: 12, 16140 Bursa, Turcja')?.strength).toBe('medium');
  });

  it('reads country codes and names from feed values', () => {
    expect(countryFromValue('de')?.region).toBe('eu');
    expect(countryFromValue('NO')?.region).toBe('eea');
    expect(countryFromValue('China')?.region).toBe('other');
    expect(countryFromValue('XX')).toBeNull();
  });
});

describe('electronic addresses', () => {
  it('finds plain, disguised and web addresses', () => {
    expect(findEmails('Write to info@acme.example or sales@acme.example.')).toEqual(['info@acme.example', 'sales@acme.example']);
    expect(findObfuscatedEmail('info [at] acme [dot] example')).toBe('info [at] acme [dot] example');
    expect(findObfuscatedEmail('info(at)acme.example')).toBe('info(at)acme.example');
    expect(findObfuscatedEmail('info at acme dot example')).toBe('info at acme dot example');
    expect(findObfuscatedEmail('Made with care at home. Visit us at our shop.')).toBeNull();
    expect(findWebAddress('See https://acme.example/contact.')).toBe('https://acme.example/contact');
    expect(findWebAddress('www.acme.example')).toBe('www.acme.example');
    expect(isEmail('a@b.example')).toBe(true);
    expect(isEmail('mail a@b.example')).toBe(false);
  });
  it('takes a web link as the electronic address only when it is a contact link or a visible web address', () => {
    const party = (links: { href: string; text: string }[]) => {
      const p = partyBuilder();
      addPartyText(p, 'Kochwerk GmbH\nIndustriestraße 12, 70565 Stuttgart', (text) => ({ source: 'text', text, selector: '', field: '', visibility: 'visible' }), { labelled: true, links });
      return p.electronic.map((c) => c.value);
    };
    expect(party([{ href: 'https://shop.example/brands/kochwerk', text: 'Kochwerk GmbH' }])).toEqual([]);
    expect(party([{ href: 'https://kochwerk.example/kontakt', text: 'Kontaktformular' }])).toEqual(['https://kochwerk.example/kontakt']);
    expect(party([{ href: 'https://www.kochwerk.example/', text: 'www.kochwerk.example' }])).toEqual(['https://www.kochwerk.example/']);
    expect(isContactLink({ href: 'https://acme.example/support', text: 'ACME' })).toBe(true);
    expect(isContactLink({ href: 'https://shop.example/p/info', text: 'Product information' })).toBe(false);
    expect(isContactLink({ href: 'https://acme.example/form', text: 'Write to us' })).toBe(true);
  });

  it('decodes mailto links and refuses junk', () => {
    expect(decodeMailto('mailto:info%40acme.example?subject=x')).toBe('info@acme.example');
    expect(decodeMailto('mailto:%E0%A4%A')).toBe('');
    expect(decodeMailto('mailto:javascript:alert(1)')).toBe('');
  });
});

describe('party names', () => {
  it.each([
    ['ACME GmbH, Hauptstraße 5, 10115 Berlin', 'ACME GmbH'],
    ['Shenzhen Toyworks Co., Ltd., 88 Keji Road, Shenzhen 518057, China', 'Shenzhen Toyworks Co., Ltd.'],
    ['Name: Kochwerk GmbH\nIndustriestraße 12', 'Kochwerk GmbH'],
    ['Lumo Europe B.V., Keizersgracht 12, 1015 CS Amsterdam', 'Lumo Europe B.V.'],
    ['Grzałka Sp. z o.o., ul. Długa 5, 00-238 Warszawa', 'Grzałka Sp. z o.o.'],
    ['Velo Helmets BV', 'Velo Helmets BV'],
  ])('%s', (body, name) => {
    expect(extractPartyName(body)).toBe(name);
  });
  it.each(['n/a', 'info@acme.example', 'https://acme.example', 'Hauptstraße 5, 10115 Berlin', '', '12345'])('"%s" has no name', (body) => {
    expect(extractPartyName(body)).toBeNull();
  });
  it('cuts the name before an address set off by a spaced dash, but not inside a hyphenated name', () => {
    expect(extractPartyName('Cuisinor SAS – 14 rue des Forges, 69007 Lyon, France – contact@cuisinor.example')).toBe('Cuisinor SAS');
    expect(extractPartyName('Hewlett-Packard GmbH - Schickardstraße 32, 71034 Böblingen')).toBe('Hewlett-Packard GmbH');
    expect(cutBeforeAddress('Smith - Jones Ltd')).toBe('Smith - Jones Ltd');
  });

  it('does not split inside a legal form', () => {
    expect(cutBeforeAddress('Toyworks Co., Ltd., 1 Road 5, 518057 Shenzhen')).toBe('Toyworks Co., Ltd.');
    expect(cutBeforeAddress('Ascot Ltd, Ascot Road 5, SL5 7JX Ascot, United Kingdom')).toBe('Ascot Ltd');
  });
});

describe('long and hostile input', () => {
  it('handles very long party text quickly', () => {
    const party = { names: [], postal: [], electronic: [], countries: [], sections: [] };
    const ev = (text: string): Evidence => ({ source: 'feed', text, selector: '', field: '', visibility: 'n/a' });
    const started = Date.now();
    addPartyText(party, `ACME GmbH, ${'a'.repeat(500_000)}`, ev, { labelled: true });
    addPartyText(party, `${'a.'.repeat(200_000)}@`, ev, { labelled: true });
    addPartyText(party, `x ${'at '.repeat(100_000)}dot`, ev, { labelled: true });
    expect(Date.now() - started).toBeLessThan(2000);
  });
  it('matches labels and addresses in long text quickly', () => {
    const started = Date.now();
    matchLabel(`Manufacturer ${'x '.repeat(10_000)}`, { headingLike: true });
    scoreAddress('Street 1 '.repeat(10_000));
    findEmails(`${'a'.repeat(100_000)}@`);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('identifiers', () => {
  it.each(['4006381333931', '5901234123457', '9780201379624', '012345678905', '96385074', '10614141000415'])('%s is a valid GTIN', (v) => {
    expect(isValidGtin(v)).toBe(true);
  });
  it.each(['4006381333932', '00000000', '123', '12345678901', 'ABCDEFGHIJKLM', '4006 3813 3393 1x'])('%s is not a valid GTIN', (v) => {
    expect(isValidGtin(v)).toBe(false);
  });
  it('recognises plausible identifiers', () => {
    expect(isPlausibleIdentifier('KET-200')).toBe(true);
    expect(isPlausibleIdentifier('none listed')).toBe(false);
    expect(isPlausibleIdentifier('a')).toBe(false);
    expect(looksLikeGtin('4006 3813 33931')).toBe(true);
  });
  it('maps property names to kinds', () => {
    expect(identifierKindOf('gtin13')).toBe('gtin');
    expect(identifierKindOf('Barcode')).toBe('gtin');
    expect(identifierKindOf('mpn')).toBe('mpn');
    expect(identifierKindOf('sku')).toBe('sku');
    expect(identifierKindOf('productID')).toBe('other');
  });
  it('downgrades a GTIN with a wrong check digit', () => {
    const ev: Evidence = { source: 'text', text: '', selector: '', field: '', visibility: 'visible' };
    expect(identifierCandidate('4006381333931', 'gtin', ev, true)?.strength).toBe('strong');
    const bad = identifierCandidate('4006381333932', 'gtin', ev, true);
    expect(bad?.strength).toBe('medium');
    expect(bad?.note).toMatch(/check digit/);
    expect(identifierCandidate('none', 'sku', ev, true)).toBeNull();
    expect(identifierCandidate('5901234123457', 'other', ev, true)?.kind).toBe('gtin');
    const sku = identifierCandidate('KET-200', 'sku', ev, true);
    expect(sku?.strength).toBe('medium');
    expect(sku?.note).toMatch(/shop's own article number/);
  });
});
