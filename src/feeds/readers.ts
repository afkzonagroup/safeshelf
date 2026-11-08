// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Readers for product exports. Each turns a file into format-independent
 * {@link FeedRecord}s. Pure functions.
 *
 * Column names follow the publicly documented formats:
 * - Shopify product CSV: https://help.shopify.com/en/manual/products/import-export/using-csv
 *   (current names such as "URL handle", "Product image URL", "Barcodes", and
 *   metafield columns "Name (product.metafields.namespace.key)"; older exports
 *   used "Handle", "Body (HTML)", "Variant SKU", "Variant Barcode", "Image Src").
 * - WooCommerce product CSV: https://github.com/woocommerce/woocommerce/wiki/Product-CSV-Import-Schema
 *   and https://woocommerce.com/document/product-csv-importer-exporter/
 *   ("ID", "Type", "SKU", "GTIN, UPC, EAN, or ISBN", "Name", "Images",
 *   "Attribute 1 name", "Attribute 1 value(s)", "Meta: key" columns).
 * - Google Merchant Center product data: https://support.google.com/merchants/answer/7052112
 *   (attributes id, title, description, link, image_link,
 *   additional_image_link, brand, gtin, mpn, product_detail with
 *   section_name / attribute_name / attribute_value).
 */

import { parseCsv, type Table } from './csv.js';
import { classifyHeader, type ColumnMapping, type FeedFormat, type FieldRole } from './mapping.js';
import { childrenNamed, localName, parseXml, textOf, type XmlElement } from './xml.js';

/** One value of a record with its role and column. */
export interface FeedField {
  readonly role: FieldRole;
  readonly column: string;
  readonly value: string;
}

/** One product from a feed. */
export interface FeedRecord {
  /** Product key (handle, ID, id or the mapped key column). */
  readonly key: string;
  readonly keyColumn: string;
  /** 1-based line of the first row (CSV) or position of the item (XML). */
  readonly position: number;
  readonly fields: readonly FeedField[];
}

/** Records plus notes about the file. */
export interface FeedRead {
  readonly records: readonly FeedRecord[];
  /** Roles that have at least one column in this file. */
  readonly mappedRoles: ReadonlySet<FieldRole>;
  /** Column per role, for the fixes file. */
  readonly roleColumns: Readonly<Partial<Record<FieldRole, readonly string[]>>>;
  readonly notes: readonly string[];
}

/** Thrown when a file does not look like the format it was read as. */
export class FeedFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeedFormatError';
  }
}

type RoleTable = Map<string, FieldRole>;

const lower = (s: string): string => s.trim().toLowerCase();

function standardRoles(format: FeedFormat): Record<string, FieldRole> {
  switch (format) {
    case 'shopify':
      return {
        title: 'title',
        description: 'description',
        'body (html)': 'description',
        vendor: 'brand',
        sku: 'sku',
        'variant sku': 'sku',
        barcodes: 'gtin',
        barcode: 'gtin',
        'variant barcode': 'gtin',
        'product image url': 'image',
        'image src': 'image',
        'variant image url': 'image',
        'variant image': 'image',
        'google shopping / mpn': 'mpn',
      };
    case 'woocommerce':
      return {
        name: 'title',
        description: 'description',
        'short description': 'description',
        sku: 'sku',
        'gtin, upc, ean, or isbn': 'gtin',
        images: 'image',
        brands: 'brand',
        'external url': 'url',
      };
    case 'google-tsv':
    case 'google-xml':
      return {
        title: 'title',
        description: 'description',
        link: 'url',
        image_link: 'image',
        additional_image_link: 'image',
        brand: 'brand',
        gtin: 'gtin',
        mpn: 'mpn',
        product_detail: 'labelled',
        product_highlight: 'description',
      };
    case 'generic':
      return {};
  }
}

const KEY_COLUMNS: Readonly<Record<FeedFormat, readonly string[]>> = {
  shopify: ['url handle', 'handle'],
  woocommerce: ['id', 'sku'],
  'google-tsv': ['id'],
  'google-xml': ['id'],
  generic: ['id', 'sku', 'handle', 'product id'],
};

/** Build the column-to-role table for a header. */
function roleTable(header: readonly string[], format: FeedFormat, mapping: ColumnMapping | undefined): { roles: RoleTable; notes: string[] } {
  const roles: RoleTable = new Map();
  const notes: string[] = [];
  const std = standardRoles(format);
  const mapped = new Set<string>();
  for (const [role, cols] of Object.entries(mapping?.columns ?? {}) as [FieldRole, readonly string[]][]) {
    for (const c of cols) {
      const actual = header.find((h) => lower(h) === lower(c));
      if (actual === undefined) notes.push(`Mapped column "${c}" is not in the file.`);
      else {
        roles.set(actual, role);
        mapped.add(actual);
      }
    }
  }
  for (const h of header) {
    if (mapped.has(h)) continue;
    const l = lower(h);
    const s = Object.hasOwn(std, l) ? std[l] : undefined;
    if (s !== undefined) {
      roles.set(h, s);
      continue;
    }
    if (format === 'shopify' && l.includes('metafields.')) {
      // "Manufacturer (product.metafields.custom.manufacturer)" or "product.metafields.custom.manufacturer"
      const role = classifyHeader(h);
      if (role !== null) roles.set(h, role);
      continue;
    }
    if (format === 'woocommerce' && /^meta:/i.test(h)) {
      const role = classifyHeader(h.replace(/^meta:\s*/i, ''));
      if (role !== null) roles.set(h, role);
      continue;
    }
    if (format === 'generic' || format === 'google-tsv') {
      const role = classifyHeader(h);
      if (role !== null) roles.set(h, role);
    }
  }
  return { roles, notes };
}

function keyColumn(header: readonly string[], format: FeedFormat, mapping: ColumnMapping | undefined): string {
  if (mapping?.key !== undefined) {
    const k = header.find((h) => lower(h) === lower(mapping.key ?? ''));
    if (k === undefined) throw new FeedFormatError(`Key column "${mapping.key}" is not in the file`);
    return k;
  }
  for (const candidate of KEY_COLUMNS[format]) {
    const k = header.find((h) => lower(h) === candidate);
    if (k !== undefined) return k;
  }
  throw new FeedFormatError(`No key column found (expected one of: ${KEY_COLUMNS[format].join(', ')}). Set "key" in a mapping file.`);
}

function splitImages(value: string, format: FeedFormat): string[] {
  if (format === 'woocommerce') return value.split(',').map((v) => v.trim()).filter((v) => v !== '');
  return [value.trim()].filter((v) => v !== '');
}

/** Positions listed in a note, at most. A hostile file must not turn every bad row into a note. */
const MAX_LISTED = 20;

/** One note for many skipped rows or items, listing the first positions. Pure. */
export function skippedNote(positions: readonly number[], what: string, unit: 'line' | 'item'): string {
  const shown = positions.slice(0, MAX_LISTED).map(String).join(', ');
  const more = positions.length > MAX_LISTED ? `, and ${String(positions.length - MAX_LISTED)} more` : '';
  return `${String(positions.length)} ${what} (${unit} ${shown}${more}).`;
}

/** Read a CSV/TSV table into records. */
function tableRecords(table: Table, format: FeedFormat, mapping: ColumnMapping | undefined): FeedRead {
  const key = keyColumn(table.header, format, mapping);
  const keyIndex = table.header.indexOf(key);
  const { roles, notes } = roleTable(table.header, format, mapping);
  const typeIndex = format === 'woocommerce' ? table.header.findIndex((h) => lower(h) === 'type') : -1;
  // Products that are not offered: WooCommerce "Published" -1 (draft) or 0 (private); Shopify "Status" draft or archived.
  const statusIndex = table.header.findIndex((h) => (format === 'woocommerce' && lower(h) === 'published') || (format === 'shopify' && lower(h) === 'status'));
  let unpublished = 0;
  const parentIndex = format === 'woocommerce' ? table.header.findIndex((h) => lower(h) === 'parent') : -1;
  const attrPairs: { name: number; value: number }[] = [];
  if (format === 'woocommerce') {
    table.header.forEach((h, i) => {
      const m = /^attribute (\d{1,3}) name$/i.exec(h.trim());
      if (m === null) return;
      const v = table.header.findIndex((x) => lower(x) === `attribute ${m[1] ?? ''} value(s)`);
      if (v !== -1) attrPairs.push({ name: i, value: v });
    });
  }
  const byKey = new Map<string, { key: string; position: number; fields: FeedField[] }>();
  const order: string[] = [];
  let variations = 0;
  const pending: { parent: string; fields: FeedField[] }[] = [];
  const noKey: number[] = [];
  table.rows.forEach((row, r) => {
    const rawKey = (row[keyIndex] ?? '').trim();
    const fields: FeedField[] = [];
    row.forEach((cell, c) => {
      const header = table.header[c];
      if (header === undefined) return;
      const role = roles.get(header);
      const value = cell.trim();
      if (role === undefined || value === '') return;
      if (role === 'image') for (const img of splitImages(value, format)) fields.push({ role, column: header, value: img });
      else if (role === 'labelled' && format === 'google-tsv') fields.push({ role, column: header, value: googleDetailText(value) });
      else fields.push({ role, column: header, value });
    });
    for (const p of attrPairs) {
      const name = (row[p.name] ?? '').trim();
      const value = (row[p.value] ?? '').trim();
      if (name !== '' && value !== '') fields.push({ role: 'labelled', column: table.header[p.value] ?? '', value: `${name}: ${value}` });
    }
    const types = typeIndex === -1 ? [] : lower(row[typeIndex] ?? '').split(/\s*,\s*/);
    const status = statusIndex === -1 ? '' : lower(row[statusIndex] ?? '');
    if (status === '-1' || status === '0' || status === 'draft' || status === 'archived') {
      unpublished += 1;
      return;
    }
    if (types.includes('variation')) {
      variations += 1;
      const parent = (row[parentIndex] ?? '').trim().replace(/^id:/i, '');
      if (parent !== '') pending.push({ parent, fields: fields.filter((f) => f.role === 'sku' || f.role === 'gtin' || f.role === 'mpn' || f.role === 'image') });
      return;
    }
    if (rawKey === '') {
      noKey.push(table.lines[r] ?? 0);
      return;
    }
    const existing = byKey.get(rawKey);
    if (existing === undefined) {
      byKey.set(rawKey, { key: rawKey, position: table.lines[r] ?? r + 2, fields });
      order.push(rawKey);
    } else {
      // Shopify: extra rows for variants and images of the same handle.
      existing.fields.push(...fields);
    }
  });
  if (variations > 0) {
    // WooCommerce variations: their identifiers and images belong to the parent (by ID or SKU).
    const skuIndex = new Map<string, string>();
    for (const rec of byKey.values()) for (const f of rec.fields) if (f.role === 'sku') skuIndex.set(f.value, rec.key);
    for (const p of pending) {
      const target = byKey.get(p.parent) ?? byKey.get(skuIndex.get(p.parent) ?? '');
      if (target !== undefined) target.fields.push(...p.fields);
    }
    notes.push(`${String(variations)} variation row(s) were read as part of their parent product.`);
  }
  if (noKey.length > 0) notes.push(skippedNote(noKey, `row(s) without a value in "${key}" were skipped`, 'line'));
  if (unpublished > 0) notes.push(`${String(unpublished)} row(s) for draft, private or archived products were skipped.`);
  const mappedRoles = new Set(roles.values());
  const roleColumns: Partial<Record<FieldRole, string[]>> = {};
  for (const [col, role] of roles) (roleColumns[role] ??= []).push(col);
  return {
    records: order.map((k) => {
      const rec = byKey.get(k);
      return { key: k, keyColumn: key, position: rec?.position ?? 0, fields: rec?.fields ?? [] };
    }),
    mappedRoles,
    roleColumns,
    notes,
  };
}

/** Read a Shopify, WooCommerce, Google TSV or generic CSV export. */
export function readTableFeed(text: string, format: Exclude<FeedFormat, 'google-xml'>, mapping?: ColumnMapping): FeedRead {
  const delimiter = mapping?.delimiter ?? (format === 'google-tsv' ? '\t' : format === 'generic' ? undefined : ',');
  const table = parseCsv(text, delimiter);
  if (table.header.length === 0) throw new FeedFormatError('The file has no header row');
  return tableRecords(table, format, mapping);
}

const GOOGLE_PRODUCT_DETAIL = /^([^:]{1,100}):([^:]{1,100}):(.+)$/su;

/** Text of a Google product_detail element: "attribute: value". */
function productDetail(el: XmlElement): string {
  const name = childrenNamed(el, 'attribute_name')[0];
  const value = childrenNamed(el, 'attribute_value')[0];
  if (name !== undefined && value !== undefined) return `${textOf(name)}: ${textOf(value)}`;
  return textOf(el);
}

/** Read a Google Merchant Center XML feed (RSS 2.0 items or Atom entries). */
export function readGoogleXml(text: string, mapping?: ColumnMapping): FeedRead {
  const root = parseXml(text);
  const rootName = localName(root.name);
  let items: XmlElement[];
  if (rootName === 'rss') items = childrenNamed(root, 'channel').flatMap((c) => childrenNamed(c, 'item'));
  else if (rootName === 'feed') items = childrenNamed(root, 'entry');
  else throw new FeedFormatError(`Expected an RSS <rss> or Atom <feed> document, found <${root.name.slice(0, 40)}>`);
  const notes: string[] = [];
  const std = standardRoles('google-xml');
  const custom = new Map<string, FieldRole>();
  for (const [role, cols] of Object.entries(mapping?.columns ?? {}) as [FieldRole, readonly string[]][]) for (const c of cols) custom.set(lower(c).replace(/^g:/, ''), role);
  const mappedRoles = new Set<FieldRole>();
  const roleColumns: Partial<Record<FieldRole, string[]>> = {};
  const keyName = mapping?.key === undefined ? 'id' : lower(mapping.key).replace(/^g:/, '');
  const records: FeedRecord[] = [];
  const noKey: number[] = [];
  items.forEach((item, index) => {
    const fields: FeedField[] = [];
    let key = '';
    for (const child of item.children) {
      const name = localName(child.name).toLowerCase();
      // Atom links carry the URL in an attribute.
      const value = name === 'link' && child.attrs.href !== undefined ? child.attrs.href : name === 'product_detail' ? productDetail(child) : textOf(child);
      if (name === keyName) key = value.trim();
      const role = custom.get(name) ?? (Object.hasOwn(std, name) ? std[name] : undefined) ?? classifyHeader(name);
      if (role === null) continue;
      mappedRoles.add(role);
      const list = (roleColumns[role] ??= []);
      if (!list.includes(name)) list.push(name);
      if (value.trim() !== '') fields.push({ role, column: name, value: value.trim() });
    }
    if (key === '') {
      noKey.push(index + 1);
      return;
    }
    records.push({ key, keyColumn: keyName, position: index + 1, fields });
  });
  if (noKey.length > 0) notes.push(skippedNote(noKey, `item(s) without <${keyName}> were skipped`, 'item'));
  return { records, mappedRoles, roleColumns, notes };
}

/** Split Google TSV product_detail values ("section:attribute:value") into labelled text. Pure. */
export function googleDetailText(value: string): string {
  const m = GOOGLE_PRODUCT_DETAIL.exec(value.trim());
  return m === null ? value : `${(m[2] ?? '').trim()}: ${(m[3] ?? '').trim()}`;
}
