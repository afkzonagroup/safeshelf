// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * CSV outputs: the list of products with information not found, and a
 * fill-in file for feeds that can be imported back into the shop. Every cell
 * is quoted and neutralised against formula injection. Pure functions.
 */

import { toCsv } from '../feeds/csv.js';
import type { FeedFormat, FieldRole } from '../feeds/mapping.js';
import { ELEMENTS } from '../legal/elements.js';
import { ELEMENT_IDS, type ElementId } from '../types.js';
import type { ProductResult, SafeshelfReport } from './types.js';

function sourceCells(p: ProductResult): [string, string, string] {
  if (p.source.kind === 'page') return [p.source.url, '', ''];
  return [p.source.key, p.source.keyColumn, String(p.source.position)];
}

/**
 * Products with at least one element not found, not visible or for review,
 * one row each, with the status of every element. Formula-injection safe.
 *
 * @example
 * ```ts
 * await writeFile('missing.csv', missingCsv(report));
 * ```
 */
export function missingCsv(report: Pick<SafeshelfReport, 'products'>): string {
  const header = ['Product id', 'Source', 'Key column', 'Row', 'Product name', 'Not found or not visible', 'To review', ...ELEMENT_IDS.map((id) => ELEMENTS[id].title)];
  const rows = report.products
    .filter((p) => p.missing.length > 0 || p.review.length > 0)
    .map((p) => {
      const status = new Map(p.elements.map((e) => [e.element, `${e.status} (${e.confidence})`]));
      return [
        p.id,
        ...sourceCells(p),
        p.name,
        p.missing.map((id) => ELEMENTS[id].title).join('; '),
        p.review.map((id) => ELEMENTS[id].title).join('; '),
        ...ELEMENT_IDS.map((id) => status.get(id) ?? ''),
      ];
    });
  return toCsv([header, ...rows]);
}

/** Role whose column fixes an element, in order of preference. */
const FIX_ROLES: Readonly<Record<ElementId, readonly FieldRole[]>> = {
  'manufacturer-name': ['manufacturerName', 'manufacturerText'],
  'manufacturer-postal-address': ['manufacturerAddress', 'manufacturerText'],
  'manufacturer-electronic-address': ['manufacturerEmail', 'manufacturerText'],
  'responsible-person-name': ['responsibleName', 'responsibleText'],
  'responsible-person-postal-address': ['responsibleAddress', 'responsibleText'],
  'responsible-person-electronic-address': ['responsibleEmail', 'responsibleText'],
  'product-picture': ['image'],
  'product-type': ['type'],
  'product-identifier': ['gtin', 'mpn', 'identifier', 'sku'],
  'safety-information': ['safety'],
};

/** Suggested column names when the file has none for an element. */
const SUGGESTED: Readonly<Record<'woocommerce' | 'shopify' | 'other', Readonly<Record<ElementId, string>>>> = {
  woocommerce: {
    'manufacturer-name': 'Meta: gpsr_manufacturer_name',
    'manufacturer-postal-address': 'Meta: gpsr_manufacturer_address',
    'manufacturer-electronic-address': 'Meta: gpsr_manufacturer_email',
    'responsible-person-name': 'Meta: gpsr_responsible_person_name',
    'responsible-person-postal-address': 'Meta: gpsr_responsible_person_address',
    'responsible-person-electronic-address': 'Meta: gpsr_responsible_person_email',
    'product-picture': 'Images',
    'product-type': 'Meta: gpsr_type',
    'product-identifier': 'GTIN, UPC, EAN, or ISBN',
    'safety-information': 'Meta: gpsr_warnings',
  },
  shopify: {
    'manufacturer-name': 'Manufacturer name (product.metafields.custom.manufacturer_name)',
    'manufacturer-postal-address': 'Manufacturer address (product.metafields.custom.manufacturer_address)',
    'manufacturer-electronic-address': 'Manufacturer email (product.metafields.custom.manufacturer_email)',
    'responsible-person-name': 'Responsible person name (product.metafields.custom.responsible_person_name)',
    'responsible-person-postal-address': 'Responsible person address (product.metafields.custom.responsible_person_address)',
    'responsible-person-electronic-address': 'Responsible person email (product.metafields.custom.responsible_person_email)',
    'product-picture': 'Product image URL',
    'product-type': 'Type designation (product.metafields.custom.type_designation)',
    'product-identifier': 'Barcodes',
    'safety-information': 'Safety warnings (product.metafields.custom.safety_warnings)',
  },
  other: {
    'manufacturer-name': 'manufacturer_name',
    'manufacturer-postal-address': 'manufacturer_address',
    'manufacturer-electronic-address': 'manufacturer_email',
    'responsible-person-name': 'responsible_person_name',
    'responsible-person-postal-address': 'responsible_person_address',
    'responsible-person-electronic-address': 'responsible_person_email',
    'product-picture': 'image_link',
    'product-type': 'type_designation',
    'product-identifier': 'gtin',
    'safety-information': 'safety_warnings',
  },
};

/** Key columns the shop's importer matches on. */
function keyHeader(format: FeedFormat, keyColumn: string): string {
  if (format === 'woocommerce') return keyColumn.toLowerCase() === 'sku' ? 'SKU' : 'ID';
  if (format === 'shopify') return keyColumn;
  return keyColumn;
}

/**
 * A fill-in file for a feed: one row per product with information not found,
 * the key column the shop's importer matches on, one empty column per missing
 * element (the file's own column when it has one, otherwise a suggested name),
 * and two "Safeshelf:" information columns. For WooCommerce, the importer
 * matches rows by ID or SKU and maps "Meta: key" columns to product meta; for
 * Shopify, rows are matched by "URL handle" and the title column is kept
 * because the importer needs it. Columns your theme does not display will not
 * change the product page: map them to the fields your shop shows.
 *
 * @throws Error for a scan report (pages have no import format).
 */
export function fixesCsv(report: Pick<SafeshelfReport, 'kind' | 'products' | 'input'>): string {
  if (report.kind !== 'feed' || report.input.format === undefined) throw new Error('A fill-in file can only be made from a feed report');
  const format = report.input.format;
  const columns = report.input.columns ?? {};
  const suggested = SUGGESTED[format === 'woocommerce' || format === 'shopify' ? format : 'other'];
  const needed = report.products.filter((p) => p.missing.length > 0);
  const targetFor = (id: ElementId): string => {
    for (const role of FIX_ROLES[id]) {
      const col = columns[role]?.[0];
      if (col !== undefined) return col;
    }
    return suggested[id];
  };
  const targets: string[] = [];
  for (const id of ELEMENT_IDS) {
    if (!needed.some((p) => p.missing.includes(id))) continue;
    const t = targetFor(id);
    if (!targets.includes(t)) targets.push(t);
  }
  const first = needed[0];
  const keyColumn = first !== undefined && first.source.kind === 'feed' ? first.source.keyColumn : 'id';
  const withTitle = format === 'shopify';
  const header = [keyHeader(format, keyColumn), ...(withTitle ? ['Title'] : []), ...targets, 'Safeshelf: product name', 'Safeshelf: missing'];
  const rows = needed.map((p) => {
    const key = p.source.kind === 'feed' ? p.source.key : '';
    return [key, ...(withTitle ? [p.name] : []), ...targets.map(() => ''), p.name, p.missing.map((id) => `${ELEMENTS[id].title} (${targetFor(id)})`).join('; ')];
  });
  return toCsv([header, ...rows]);
}
