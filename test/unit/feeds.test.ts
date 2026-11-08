// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkFeed, readFeedFile } from '../../src/feeds/check.js';
import { CsvError, DEFAULT_CSV_LIMITS, csvField, detectDelimiter, neutralizeFormula, parseCsv, toCsv } from '../../src/feeds/csv.js';
import { decodeHtmlEntities, htmlToUnits } from '../../src/feeds/html-text.js';
import { MappingError, classifyHeader, parseMapping, validateMapping } from '../../src/feeds/mapping.js';
import { FeedFormatError, googleDetailText, readGoogleXml, readTableFeed } from '../../src/feeds/readers.js';
import { XmlError, decodeEntities, parseXml, textOf } from '../../src/feeds/xml.js';
import { fixesCsv, missingCsv } from '../../src/report/csv.js';
import type { ElementId, Status } from '../../src/types.js';

const fixture = (name: string): string => readFileSync(new URL(`../fixtures/feeds/${name}`, import.meta.url), 'utf8');
type Row = Partial<Record<ElementId, Status>>;
const statuses = (report: ReturnType<typeof checkFeed>): Record<string, Row> =>
  Object.fromEntries(report.products.map((p) => [p.source.kind === 'feed' ? p.source.key : p.id, Object.fromEntries(p.elements.map((e) => [e.element, e.status]))]));

describe('CSV', () => {
  it('parses quotes, doubled quotes, embedded newlines, CRLF and a BOM', () => {
    const t = parseCsv('\ufeffa,b,c\r\n1,"x, ""y""",3\r\n2,"line1\nline2",\r\n\r\n');
    expect(t.header).toEqual(['a', 'b', 'c']);
    expect(t.rows).toEqual([
      ['1', 'x, "y"', '3'],
      ['2', 'line1\nline2', ''],
    ]);
    expect(t.lines).toEqual([2, 3]);
  });
  it('detects tab, semicolon and comma delimiters', () => {
    expect(detectDelimiter('a\tb\tc\n')).toBe('\t');
    expect(detectDelimiter('a;b;"c,d"\n')).toBe(';');
    expect(detectDelimiter('a,b\n')).toBe(',');
  });
  it.each([
    ['a,b\n"unterminated', /Unterminated quoted field/],
    ['a,b\nx"y,1', /Quote inside an unquoted field/],
    ['a,b\n"x"y,1', /Text after a closing quote/],
  ])('rejects malformed input %#', (text, message) => {
    expect(() => parseCsv(text, ',')).toThrow(message);
  });
  it('enforces row, column and cell limits', () => {
    expect(() => parseCsv('a\n1\n2\n3\n', ',', { maxRows: 2, maxColumns: 10, maxCellChars: 100, maxCells: 1000 })).toThrow(CsvError);
    expect(() => parseCsv('a,b,c\n', ',', { maxRows: 10, maxColumns: 2, maxCellChars: 100, maxCells: 1000 })).toThrow(/columns/);
    expect(() => parseCsv(`a\n${'x'.repeat(200)}\n`, ',', { maxRows: 10, maxColumns: 10, maxCellChars: 100, maxCells: 1000 })).toThrow(/longer/);
    // Rows of empty cells: a 100 MiB file of commas would otherwise hold about 100 million cells in memory.
    expect(() => parseCsv(`id${','.repeat(9)}\n${`${','.repeat(9)}\n`.repeat(20)}`, ',', { maxRows: 100, maxColumns: 10, maxCellChars: 100, maxCells: 100 })).toThrow(/More than 100 cells/);
    expect(DEFAULT_CSV_LIMITS.maxCells).toBe(30_000_000);
    expect(() => parseCsv('a', '"')).toThrow(/delimiter/);
  });
  it.each([
    ['=HYPERLINK("http://evil.example","x")', `'=HYPERLINK("http://evil.example","x")`],
    ['+cmd|" /C calc"!A0', `'+cmd|" /C calc"!A0`],
    ['-2+3', `'-2+3`],
    ['@SUM(A1)', `'@SUM(A1)`],
    ['\t=1', `'\t=1`],
    ['\r=1', `'\r=1`],
    ['|x', `'|x`],
    ['%x', `'%x`],
    ['-5', '-5'],
    ['+3.2', '+3.2'],
    ['ACME', 'ACME'],
  ])('neutralises formula %#', (input, output) => {
    expect(neutralizeFormula(input)).toBe(output);
  });
  it('quotes every field and doubles quotes', () => {
    expect(csvField('a"b')).toBe('"a""b"');
    expect(toCsv([['a', '=1'], ['b', 'c']])).toBe(`"a","'=1"\r\n"b","c"\r\n`);
  });
});

describe('XML', () => {
  it('parses elements, attributes, CDATA, comments and entities', () => {
    const root = parseXml('<?xml version="1.0"?><!-- c --><r a="1 &amp; 2"><x>a &lt; b &#65;&#x42;</x><y><![CDATA[<p>&amp;</p>]]></y><z/></r>');
    expect(root.attrs.a).toBe('1 & 2');
    expect(textOf(root.children[0] ?? root)).toBe('a < b AB');
    expect(root.children[1]?.text).toBe('<p>&amp;</p>');
    expect(root.children).toHaveLength(3);
  });
  it.each([
    ['<!DOCTYPE r [<!ENTITY a "aaaaaaaaaa">]><r>&a;</r>', /Document type declarations/],
    ['<!DOCTYPE r SYSTEM "file:///etc/passwd"><r/>', /Document type declarations/],
    ['<r>&ext;</r>', /Unknown entity/],
    ['<r>&#0;</r>', /Bad character reference/],
    ['<r>&#x1B;</r>', /Bad character reference/],
    ['<r>&#xD800;</r>', /Bad character reference/],
    ['<r><a></r>', /Unexpected end tag/],
    ['<r>', /Unclosed element/],
    ['<r/><s/>', /More than one root/],
    ['text', /Text outside the root|No root/],
    ['<r a=1/>', /Unquoted attribute/],
    ['<r a="<"/>', /"<" in attribute value/],
    ['<r><!-- open', /Unterminated comment/],
  ])('rejects %s', (xml, message) => {
    expect(() => parseXml(xml)).toThrow(message);
  });
  it('caps depth, node count and text size', () => {
    expect(() => parseXml(`${'<a>'.repeat(100)}${'</a>'.repeat(100)}`)).toThrow(/Nesting deeper/);
    expect(() => parseXml(`<r>${'<a/>'.repeat(20)}</r>`, { maxDepth: 64, maxNodes: 10, maxTextChars: 100 })).toThrow(/More than 10 elements/);
    expect(() => parseXml(`<r>${'x'.repeat(200)}</r>`, { maxDepth: 64, maxNodes: 100, maxTextChars: 100 })).toThrow(/too long/);
    expect(() => decodeEntities('&#99999999;')).toThrow(XmlError);
  });
});

describe('HTML descriptions', () => {
  it('splits blocks, keeps headings and joins table rows and term pairs', () => {
    const units = htmlToUnits('<h3>Warnings</h3><p>Hot &amp; sharp.</p><table><tr><th>Manufacturer</th><td>ACME</td></tr></table><dl><dt>Model</dt><dd>K1</dd></dl><p><strong>Importer</strong></p>line a<br>line b', 'Description');
    expect(units.map((u) => u.text)).toEqual(['Warnings', 'Hot & sharp.', 'Manufacturer: ACME', 'Model: K1', 'Importer', 'line a', 'line b']);
    expect(units[0]?.headingLike).toBe(true);
    expect(units[4]?.headingLike).toBe(true);
    expect(units.every((u) => u.visibility === 'n/a' && u.source === 'feed' && u.field === 'Description')).toBe(true);
  });
  it('drops scripts, styles and comments and never decodes unknown entities into markup', () => {
    const units = htmlToUnits('<script>alert(1)</script><style>p{}</style><!-- x --><p>a &unknown; &#60;b&#62;</p>', 'D');
    expect(units.map((u) => u.text)).toEqual(['a &unknown; <b>']);
    expect(decodeHtmlEntities('&#0;&#x110000;&nbsp;')).toBe(' ');
  });
  it('treats plain text line breaks as units', () => {
    expect(htmlToUnits('Manufacturer: ACME\nHauptstraße 5', 'D').map((u) => u.text)).toEqual(['Manufacturer: ACME', 'Hauptstraße 5']);
  });
});

describe('column mapping', () => {
  it('validates roles, keys and delimiters', () => {
    expect(validateMapping({ key: 'SKU', delimiter: ';', columns: { manufacturerName: 'Maker', image: ['Img 1', 'Img 2'] } })).toEqual({
      key: 'SKU',
      delimiter: ';',
      columns: { manufacturerName: ['Maker'], image: ['Img 1', 'Img 2'] },
    });
  });
  it.each([
    [[], /JSON object/],
    [{ colums: {} }, /Unknown mapping key/],
    [{ columns: { maker: 'x' } }, /Unknown role/],
    [{ columns: { image: [] } }, /1 to 20/],
    [{ columns: { image: '' } }, /non-empty/],
    [{ columns: { image: 'a\u0007' } }, /control characters/],
    [{ delimiter: '|' }, /delimiter/],
    [{ key: 5 }, /key must be/],
  ])('rejects %j', (value, message) => {
    expect(() => validateMapping(value)).toThrow(message);
  });
  it('parses JSON with a size limit', () => {
    expect(() => parseMapping('{')).toThrow(MappingError);
    expect(() => parseMapping(`{"key":"${'x'.repeat(70_000)}"}`)).toThrow(/64 KiB/);
  });
  it('classifies extra columns by keywords', () => {
    expect(classifyHeader('Manufacturer (product.metafields.custom.manufacturer)')).toBe('manufacturerText');
    expect(classifyHeader('product.metafields.gpsr.manufacturer_email')).toBe('manufacturerEmail');
    expect(classifyHeader('Hersteller Adresse')).toBe('manufacturerAddress');
    expect(classifyHeader('manufacturer_name')).toBe('manufacturerName');
    expect(classifyHeader('Manufacturer country')).toBe('manufacturerCountry');
    expect(classifyHeader('EU responsible person')).toBe('responsibleText');
    expect(classifyHeader('importer_email')).toBe('responsibleEmail');
    expect(classifyHeader('Meta: gpsr_fulfilment_service_provider')).toBe('responsibleText');
    expect(classifyHeader('fulfillment_provider_address')).toBe('responsibleAddress');
    expect(classifyHeader('fulfilment_status')).toBeNull();
    expect(classifyHeader('Safety warnings')).toBe('safety');
    expect(classifyHeader('Manufacturer part number')).toBe('mpn');
    expect(classifyHeader('EAN')).toBe('gtin');
    expect(classifyHeader('Model')).toBe('type');
    expect(classifyHeader('Colour')).toBeNull();
    expect(classifyHeader('Manufacturer warranty')).toBeNull();
    expect(classifyHeader('product.metafields.custom.manufacturer_url')).toBeNull();
    expect(classifyHeader('Hersteller-Garantie')).toBeNull();
  });
});

describe('readers', () => {
  it('groups Shopify rows by URL handle and reads metafields', () => {
    const read = readTableFeed(fixture('shopify.csv'), 'shopify');
    expect(read.records.map((r) => r.key)).toEqual(['trail-backpack-30', 'charger-20w', 'gift-card']);
    expect(read.notes).toEqual(['1 row(s) for draft, private or archived products were skipped.']);
    const pack = read.records[0]?.fields ?? [];
    expect(pack.filter((f) => f.role === 'image').map((f) => f.value)).toEqual(['https://cdn.example/files/pack-green.jpg', 'https://cdn.example/files/pack-blue.jpg']);
    expect(pack.filter((f) => f.role === 'sku').map((f) => f.value)).toEqual(['PK-30-GRN', 'PK-30-BLU']);
    expect(read.roleColumns.manufacturerText).toEqual(['Manufacturer (product.metafields.custom.manufacturer)']);
    expect(read.roleColumns.responsibleText).toEqual(['Responsible person (product.metafields.custom.eu_responsible_person)']);
  });
  it('reads legacy Shopify columns', () => {
    const read = readTableFeed(fixture('shopify-legacy.csv'), 'shopify');
    expect(read.records[0]?.key).toBe('canvas-tote');
    expect(read.records[0]?.fields.map((f) => f.role)).toEqual(expect.arrayContaining(['title', 'description', 'brand', 'sku', 'gtin', 'image']));
  });
  it('merges WooCommerce variations into their parent and splits image lists', () => {
    const read = readTableFeed(fixture('woocommerce.csv'), 'woocommerce');
    expect(read.records.map((r) => r.key)).toEqual(['101', '102', '103', '105', '106']);
    expect(read.notes).toContain('1 variation row(s) were read as part of their parent product.');
    expect(read.notes).toContain('2 row(s) for draft, private or archived products were skipped.');
    const car = read.records.find((r) => r.key === '103');
    expect(car?.fields.filter((f) => f.role === 'gtin').map((f) => f.value)).toEqual(['5901234123457']);
    expect(read.records[0]?.fields.filter((f) => f.role === 'image')).toHaveLength(2);
    expect(read.records[0]?.fields.find((f) => f.role === 'labelled')?.value).toBe('Model: K-200');
  });
  it('reads Google XML items with product_detail and Atom entries', () => {
    const read = readGoogleXml(fixture('google.xml'));
    expect(read.records.map((r) => r.key)).toEqual(['SKU-1', 'SKU-2']);
    expect(read.records[0]?.fields.find((f) => f.role === 'labelled')?.value).toMatch(/^Manufacturer: Nurtura SAS/);
    const atom = readGoogleXml('<feed xmlns="http://www.w3.org/2005/Atom" xmlns:g="http://base.google.com/ns/1.0"><entry><g:id>1</g:id><title>T</title><link href="https://x.example/p"/></entry></feed>');
    expect(atom.records[0]?.fields.find((f) => f.role === 'url')?.value).toBe('https://x.example/p');
    expect(() => readGoogleXml('<html/>')).toThrow(FeedFormatError);
  });
  it('splits Google TSV product_detail "section:attribute:value"', () => {
    expect(googleDetailText('Safety:Manufacturer:ACME, Street 1')).toBe('Manufacturer: ACME, Street 1');
    expect(googleDetailText('plain')).toBe('plain');
  });
  it('requires a key column and reports mapped columns that are missing', () => {
    expect(() => readTableFeed('a,b\n1,2\n', 'generic')).toThrow(/No key column/);
    expect(() => readTableFeed('a,b\n1,2\n', 'generic', { key: 'zz', columns: {} })).toThrow(/Key column "zz"/);
    const read = readTableFeed('id,b\n1,2\n,3\n', 'generic', { columns: { image: ['missing col'] } });
    expect(read.notes).toEqual(['Mapped column "missing col" is not in the file.', '1 row(s) without a value in "id" were skipped (line 3).']);
  });

  it('summarises skipped rows and items in one note, however many there are', () => {
    const csv = readTableFeed(`id,b\n1,2\n${',x\n'.repeat(5000)}`, 'generic');
    expect(csv.notes).toHaveLength(1);
    expect(csv.notes[0]).toMatch(/^5000 row\(s\) without a value in "id" were skipped \(line 3, 4, .*, 22, and 4980 more\)\.$/);
    const xml = readGoogleXml(`<rss><channel>${'<item><title>x</title></item>'.repeat(30)}<item><id>1</id></item></channel></rss>`);
    expect(xml.records).toHaveLength(1);
    expect(xml.notes).toEqual(['30 item(s) without <id> were skipped (item 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, and 10 more).']);
  });
});

describe('feed checks', () => {
  it('WooCommerce export', () => {
    const s = statuses(checkFeed(fixture('woocommerce.csv'), { format: 'woocommerce' }));
    expect(s['101']).toMatchObject({ 'manufacturer-name': 'found', 'manufacturer-postal-address': 'found', 'manufacturer-electronic-address': 'found', 'responsible-person-name': 'not-applicable', 'product-type': 'found', 'product-identifier': 'found', 'safety-information': 'found' });
    expect(s['102']).toMatchObject({ 'manufacturer-name': 'review', 'manufacturer-postal-address': 'not-found', 'responsible-person-name': 'review', 'product-type': 'review' });
    expect(s['103']).toMatchObject({ 'manufacturer-name': 'found', 'responsible-person-name': 'not-found', 'responsible-person-postal-address': 'not-found', 'safety-information': 'found' });
    expect(s['105']).toMatchObject({ 'manufacturer-name': 'found', 'responsible-person-name': 'found', 'responsible-person-postal-address': 'found', 'responsible-person-electronic-address': 'found' });
    expect(s['106']).toMatchObject({ 'manufacturer-name': 'not-found', 'product-picture': 'not-found' });
  });
  it('Shopify export (current and legacy)', () => {
    const s = statuses(checkFeed(fixture('shopify.csv'), { format: 'shopify' }));
    expect(s['trail-backpack-30']).toMatchObject({ 'manufacturer-name': 'found', 'manufacturer-postal-address': 'found', 'responsible-person-name': 'not-applicable', 'product-identifier': 'found' });
    expect(s['charger-20w']).toMatchObject({ 'manufacturer-electronic-address': 'not-found', 'responsible-person-name': 'not-found', 'product-picture': 'not-found', 'safety-information': 'found' });
    expect(s['gift-card']).toMatchObject({ 'manufacturer-name': 'review', 'product-identifier': 'not-found' });
    expect(statuses(checkFeed(fixture('shopify-legacy.csv'), { format: 'shopify' }))['canvas-tote']).toMatchObject({ 'manufacturer-name': 'found', 'manufacturer-postal-address': 'found', 'manufacturer-electronic-address': 'found' });
  });
  it('Google XML and TSV', () => {
    const x = statuses(checkFeed(fixture('google.xml'), { format: 'google-xml' }));
    expect(x['SKU-1']).toMatchObject({ 'manufacturer-name': 'found', 'manufacturer-postal-address': 'found', 'product-identifier': 'found', 'product-picture': 'found' });
    expect(x['SKU-2']).toMatchObject({ 'manufacturer-name': 'review', 'product-picture': 'not-found', 'product-identifier': 'not-found' });
    const t = statuses(checkFeed(fixture('google.tsv'), { format: 'google-tsv' }));
    expect(t.A1).toMatchObject({ 'manufacturer-name': 'found', 'manufacturer-postal-address': 'found', 'safety-information': 'found' });
    expect(t.A2).toMatchObject({ 'manufacturer-name': 'review', 'product-picture': 'not-found' });
  });
  it('generic CSV with a mapping, including the explicit EU establishment column', () => {
    const report = checkFeed(fixture('generic.csv'), { format: 'generic', mapping: parseMapping(fixture('generic-mapping.json')) });
    const s = statuses(report);
    expect(s['G-1']).toMatchObject({ 'manufacturer-name': 'found', 'responsible-person-name': 'not-applicable', 'product-type': 'found', 'safety-information': 'found' });
    expect(s['G-2']).toMatchObject({ 'responsible-person-name': 'not-found', 'product-identifier': 'review' });
    const g2 = report.products[1]?.elements.find((e) => e.element === 'responsible-person-name');
    expect(g2?.confidence).toBe('high');
    expect(g2?.explanation).toMatch(/The feed states that the manufacturer is not established in the EU/);
  });
  it('limits the number of products and reports feeds without nothing to fetch', () => {
    const report = checkFeed(fixture('woocommerce.csv'), { format: 'woocommerce', maxProducts: 2 });
    expect(report.products).toHaveLength(2);
    expect(report.notes.some((n) => n.includes('only the first 2'))).toBe(true);
    expect(report.blockedRequests).toEqual([]);
    expect(report.kind).toBe('feed');
  });
});

describe('feed files', () => {
  it('reads only regular files up to the size limit', async () => {
    const file = fileURLToPath(new URL('../fixtures/feeds/woocommerce.csv', import.meta.url));
    await expect(readFeedFile(file)).resolves.toContain('ID');
    await expect(readFeedFile(file, 10)).rejects.toThrow(/larger than 10 bytes/);
    await expect(readFeedFile(path.dirname(file))).rejects.toThrow(/not a regular file/);
    if (process.platform !== 'win32') await expect(readFeedFile('/dev/zero')).rejects.toThrow(/not a regular file/);
  });
});

describe('CSV outputs', () => {
  const report = checkFeed(fixture('woocommerce.csv'), { format: 'woocommerce', fileName: '/secret/dir/export.csv' });
  it('keeps only the file name of the input', () => {
    expect(report.input.file).toBe('export.csv');
  });
  it('missing.csv lists products with information not found, formula-safe', () => {
    const csv = missingCsv(report);
    const table = parseCsv(csv, ',');
    expect(table.header.slice(0, 7)).toEqual(['Product id', 'Source', 'Key column', 'Row', 'Product name', 'Not found or not visible', 'To review']);
    expect(table.header).toHaveLength(17);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil.example"",""Click"")"`);
    expect(csv).not.toMatch(/(^|,)"=/m);
    // 101 has everything; 105 has the type to review.
    expect(table.rows.map((r) => r[1])).toEqual(['102', '103', '105', '106']);
  });
  it('fixes.csv uses the file’s own columns and the WooCommerce key', () => {
    const csv = fixesCsv(report);
    const table = parseCsv(csv, ',');
    expect(table.header[0]).toBe('ID');
    expect(table.header).toContain('Meta: gpsr_manufacturer');
    expect(table.header).toContain('Meta: gpsr_responsible_person');
    expect(table.header).toContain('Images');
    expect(table.header.slice(-2)).toEqual(['Safeshelf: product name', 'Safeshelf: missing']);
    expect(table.rows.map((r) => r[0])).toEqual(['102', '103', '106']);
  });
  it('fixes.csv suggests columns when the file has none, and refuses scan reports', () => {
    const google = checkFeed(fixture('google.xml'), { format: 'google-xml' });
    const table = parseCsv(fixesCsv(google), ',');
    expect(table.header).toEqual(['id', 'manufacturer_address', 'manufacturer_email', 'image_link', 'gtin', 'Safeshelf: product name', 'Safeshelf: missing']);
    expect(() => fixesCsv({ ...google, kind: 'scan' })).toThrow(/feed report/);
    const shopify = parseCsv(fixesCsv(checkFeed(fixture('shopify.csv'), { format: 'shopify' })), ',');
    expect(shopify.header.slice(0, 2)).toEqual(['URL handle', 'Title']);
  });
});
