// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * schema.org structured data: JSON-LD and microdata, reduced to the product
 * properties Safeshelf uses. Pure functions with size and depth caps; the
 * input comes from untrusted pages.
 */

import type { MicroItem } from '../browser/snapshot.js';
import { identifierKindOf, type IdentifierKind } from './identifiers.js';
import { squash } from './text.js';

/** A value with the structured-data path it came from. */
export interface FieldValue {
  readonly value: string;
  /** Path such as `Product.manufacturer.name`. */
  readonly field: string;
}

/** A postal address from structured data. */
export interface StructuredAddress {
  readonly street: string;
  readonly locality: string;
  readonly postalCode: string;
  readonly region: string;
  readonly country: string;
  /** All parts joined, or the text of a plain-string address. */
  readonly text: string;
  readonly field: string;
}

/** A party (manufacturer or seller) from structured data. */
export interface StructuredParty {
  readonly name: FieldValue | null;
  readonly addresses: readonly StructuredAddress[];
  readonly emails: readonly FieldValue[];
  readonly urls: readonly FieldValue[];
}

/** Product facts from one structured-data item. */
export interface StructuredProduct {
  readonly source: 'json-ld' | 'microdata';
  readonly name: string;
  readonly identifiers: readonly (FieldValue & { readonly kind: IdentifierKind })[];
  readonly models: readonly FieldValue[];
  readonly images: readonly FieldValue[];
  readonly brands: readonly FieldValue[];
  readonly manufacturer: StructuredParty | null;
  readonly seller: StructuredParty | null;
  /** `additionalProperty` name/value pairs. */
  readonly properties: readonly { readonly name: string; readonly value: string; readonly field: string }[];
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObj = { [key: string]: Json };

const MAX_NODES = 20_000;
const MAX_DEPTH = 12;
const MAX_PRODUCTS = 20;

const isObj = (v: Json | undefined): v is JsonObj => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Parse a JSON-LD script. Returns null for invalid JSON. Very deep nesting or
 * size is rejected rather than parsed.
 */
export function parseJsonLd(text: string, maxChars = 500_000): Json | null {
  if (text.length > maxChars) return null;
  // Some sites wrap JSON-LD in HTML comments or CDATA markers.
  const cleaned = text.replace(/^\s*(?:<!--|\/\/<!\[CDATA\[)/, '').replace(/(?:-->|\/\/\]\]>)\s*$/, '');
  try {
    return JSON.parse(cleaned) as Json;
  } catch {
    return null;
  }
}

/** schema.org type names of a node ("Product", "schema:Product", "http://schema.org/Product" all give "Product"). */
export function typesOf(node: JsonObj): string[] {
  const raw = node['@type'] ?? node.type;
  const values = Array.isArray(raw) ? raw : [raw];
  return values
    .filter((v): v is string => typeof v === 'string')
    .slice(0, 10)
    .map((t) => t.replace(/^(?:https?:\/\/(?:www\.)?schema\.org\/|schema:)/i, ''));
}

const PRODUCT_TYPES = new Set(['Product', 'ProductGroup', 'IndividualProduct', 'ProductModel', 'SomeProducts', 'Vehicle', 'Car', 'Book']);

const TEXT_KEYS = ['@value', 'name', 'url', 'contentUrl', '@id'];
const URL_KEYS = ['contentUrl', 'url', '@id', '@value'];

/** Plain text values of a property (strings, numbers, `name` or `@value` of objects). */
function texts(v: Json | undefined, ids: ReadonlyMap<string, JsonObj>, max = 10, keys: readonly string[] = TEXT_KEYS): string[] {
  const out: string[] = [];
  const push = (x: Json | undefined): void => {
    if (out.length >= max || x === undefined || x === null) return;
    if (typeof x === 'string') out.push(squash(x).slice(0, 2000));
    else if (typeof x === 'number' && Number.isFinite(x)) out.push(String(x));
    else if (Array.isArray(x)) x.slice(0, max).forEach(push);
    else if (isObj(x)) {
      const node = resolve(x, ids);
      const key = keys.find((k) => node[k] !== undefined);
      const inner = key === undefined ? undefined : node[key];
      if (typeof inner === 'string' || typeof inner === 'number') push(inner);
      else if (Array.isArray(inner)) inner.slice(0, max).forEach(push);
    }
  };
  push(v);
  return out.filter((s) => s !== '');
}

function resolve(node: JsonObj, ids: ReadonlyMap<string, JsonObj>): JsonObj {
  const id = node['@id'];
  if (typeof id === 'string' && Object.keys(node).length === 1) return ids.get(id) ?? node;
  return node;
}

function objects(v: Json | undefined, ids: ReadonlyMap<string, JsonObj>, max = 5): JsonObj[] {
  const values = Array.isArray(v) ? v.slice(0, max) : [v];
  return values.filter(isObj).map((o) => resolve(o, ids));
}

function addressOf(v: Json | undefined, field: string, ids: ReadonlyMap<string, JsonObj>): StructuredAddress[] {
  const out: StructuredAddress[] = [];
  const values = Array.isArray(v) ? v.slice(0, 3) : [v];
  for (const a of values) {
    if (typeof a === 'string' && a.trim() !== '') {
      const text = squash(a).slice(0, 500);
      out.push({ street: '', locality: '', postalCode: '', region: '', country: '', text, field });
    } else if (isObj(a)) {
      const node = resolve(a, ids);
      const get = (k: string): string => texts(node[k], ids, 1)[0] ?? '';
      const country = get('addressCountry');
      const parts = { street: get('streetAddress'), locality: get('addressLocality'), postalCode: get('postalCode'), region: get('addressRegion'), country };
      const text = [parts.street, `${parts.postalCode} ${parts.locality}`.trim(), parts.region, parts.country].filter((s) => s !== '').join(', ').slice(0, 500);
      if (text !== '') out.push({ ...parts, text, field });
    }
  }
  return out;
}

function partyOf(v: Json | undefined, field: string, ids: ReadonlyMap<string, JsonObj>): StructuredParty | null {
  if (typeof v === 'string' && v.trim() !== '') {
    return { name: { value: squash(v).slice(0, 300), field }, addresses: [], emails: [], urls: [] };
  }
  const node = objects(v, ids, 1)[0];
  if (node === undefined) return null;
  const name = texts(node.name ?? node.legalName, ids, 1)[0];
  const emails: FieldValue[] = texts(node.email, ids, 3).map((e) => ({ value: e.replace(/^mailto:/i, ''), field: `${field}.email` }));
  const urls: FieldValue[] = texts(node.url, ids, 2).map((u) => ({ value: u, field: `${field}.url` }));
  for (const cp of objects(node.contactPoint, ids, 3)) {
    emails.push(...texts(cp.email, ids, 2).map((e) => ({ value: e.replace(/^mailto:/i, ''), field: `${field}.contactPoint.email` })));
    urls.push(...texts(cp.url, ids, 1).map((u) => ({ value: u, field: `${field}.contactPoint.url` })));
  }
  const addresses = [...addressOf(node.address, `${field}.address`, ids), ...objects(node.location, ids, 2).flatMap((l) => addressOf(l.address, `${field}.location.address`, ids))];
  return { name: name === undefined ? null : { value: name.slice(0, 300), field: `${field}.name` }, addresses, emails, urls };
}

const IDENTIFIER_PROPS = ['gtin', 'gtin8', 'gtin12', 'gtin13', 'gtin14', 'mpn', 'sku', 'productID', 'isbn'] as const;

function productOf(node: JsonObj, source: 'json-ld' | 'microdata', ids: ReadonlyMap<string, JsonObj>): StructuredProduct {
  const type = typesOf(node)[0] ?? 'Product';
  const identifiers: (FieldValue & { kind: IdentifierKind })[] = [];
  const addIds = (n: JsonObj, prefix: string): void => {
    for (const p of IDENTIFIER_PROPS) {
      for (const value of texts(n[p], ids, 3)) {
        if (identifiers.length < 50) identifiers.push({ value: value.replace(/^(?:gtin|ean|isbn|mpn|sku):\s*/i, '').slice(0, 100), field: `${prefix}.${p}`, kind: identifierKindOf(p) });
      }
    }
  };
  addIds(node, type);
  // Variants of a ProductGroup and offers can carry identifiers too.
  for (const v of objects(node.hasVariant, ids, 20)) addIds(v, `${type}.hasVariant`);
  for (const o of objects(node.offers, ids, 10)) {
    addIds(o, `${type}.offers`);
    for (const inner of objects(o.offers, ids, 10)) addIds(inner, `${type}.offers.offers`);
  }
  const models: FieldValue[] = texts(node.model, ids, 3).map((value) => ({ value: value.slice(0, 200), field: `${type}.model` }));
  const images: FieldValue[] = texts(node.image, ids, 10, URL_KEYS).map((value) => ({ value: value.slice(0, 2048), field: `${type}.image` }));
  const brands: FieldValue[] = texts(node.brand, ids, 3).map((value) => ({ value: value.slice(0, 300), field: `${type}.brand` }));
  const offers = objects(node.offers, ids, 3);
  const sellerSource = offers.map((o) => o.seller).find((s) => s !== undefined);
  const properties = objects(node.additionalProperty, ids, 50)
    .map((p) => ({ name: texts(p.name, ids, 1)[0] ?? '', value: texts(p.value, ids, 1)[0] ?? '', field: `${type}.additionalProperty` }))
    .filter((p) => p.name !== '' && p.value !== '');
  return {
    source,
    name: (texts(node.name, ids, 1)[0] ?? '').slice(0, 300),
    identifiers,
    models,
    images,
    brands,
    manufacturer: partyOf(node.manufacturer, `${type}.manufacturer`, ids),
    seller: partyOf(sellerSource, `${type}.offers.seller`, ids),
    properties,
  };
}

/**
 * Find product items in parsed JSON-LD documents (including `@graph` and
 * nested items such as `mainEntity`). Walks at most 20 000 nodes, 12 levels
 * deep, and returns at most 20 products. Pure.
 */
export function productsFromJsonLd(docs: readonly Json[]): StructuredProduct[] {
  const ids = new Map<string, JsonObj>();
  const found: JsonObj[] = [];
  let nodes = 0;
  const walk = (v: Json, depth: number): void => {
    if (nodes >= MAX_NODES || depth > MAX_DEPTH) return;
    nodes += 1;
    if (Array.isArray(v)) {
      for (const x of v.slice(0, 1000)) walk(x, depth + 1);
      return;
    }
    if (!isObj(v)) return;
    const id = v['@id'];
    if (typeof id === 'string' && Object.keys(v).length > 1 && ids.size < 5000 && !ids.has(id)) ids.set(id, v);
    if (typesOf(v).some((t) => PRODUCT_TYPES.has(t))) {
      if (found.length < MAX_PRODUCTS) found.push(v);
      // Variants are read from the group; do not report them as separate products.
      return;
    }
    for (const [key, child] of Object.entries(v).slice(0, 200)) {
      if (key === '@context') continue;
      walk(child, depth + 1);
    }
  };
  for (const d of docs) walk(d, 0);
  return found.map((n) => productOf(n, 'json-ld', ids));
}

/** Convert a microdata item to the JSON-LD object shape. */
function microToJson(item: MicroItem, depth: number): JsonObj {
  const out: JsonObj = { '@type': item.types.map((t) => t.replace(/^https?:\/\/(?:www\.)?schema\.org\//i, '')) };
  for (const p of item.props) {
    const value: Json = p.item !== undefined && depth < 5 ? microToJson(p.item, depth + 1) : p.value;
    const existing = out[p.name];
    if (existing === undefined) out[p.name] = value;
    else if (Array.isArray(existing)) {
      if (existing.length < 50) existing.push(value);
    } else out[p.name] = [existing, value];
  }
  return out;
}

/** Product items from microdata. Pure. */
export function productsFromMicrodata(items: readonly MicroItem[]): StructuredProduct[] {
  const found: JsonObj[] = [];
  const visit = (item: MicroItem, depth: number): void => {
    if (found.length >= MAX_PRODUCTS || depth > 5) return;
    const json = microToJson(item, 0);
    if (typesOf(json).some((t) => PRODUCT_TYPES.has(t))) {
      found.push(json);
      return;
    }
    for (const p of item.props) if (p.item !== undefined) visit(p.item, depth + 1);
  };
  for (const i of items) visit(i, 0);
  const none = new Map<string, JsonObj>();
  return found.map((n) => productOf(n, 'microdata', none));
}
