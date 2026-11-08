// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Build {@link ProductFacts} from a page snapshot: structured data, labelled
 * text sections, images and meta tags. Pure.
 */

import type { PageSnapshot } from '../browser/snapshot.js';
import type { Evidence, EvidenceSource, Visibility } from '../types.js';
import { scoreAddress, type Strength } from './address.js';
import { partyBuilder, type ProductFacts } from './facts.js';
import { addSections, identifierCandidate, type FactsBuilder } from './interpret.js';
import { findSections, type TextUnit } from './sections.js';
import { parseJsonLd, productsFromJsonLd, productsFromMicrodata, type StructuredAddress, type StructuredProduct } from './structured.js';
import { clip, normalizeText } from './text.js';

/** A structured product item and the page's verdict on it. */
export interface PageProducts {
  readonly products: readonly StructuredProduct[];
  /** True if the page looks like a single product's page. */
  readonly isProductPage: boolean;
  /** Why the page was or was not treated as a product page. */
  readonly reason: string;
}

const PRODUCT_URL = /\/(?:products?|produkt|produkte|produit|producto|prodotto|artikel|item|items|p|dp|gp\/product|shop\/[^/]+)\/[^/?#]+/i;

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

/** Structured products on the page and whether it is a product page. Pure. */
export function pageProducts(snapshot: PageSnapshot): PageProducts {
  const docs = snapshot.jsonLd.map((t) => parseJsonLd(t)).filter((d) => d !== null);
  const products = [...productsFromJsonLd(docs), ...productsFromMicrodata(snapshot.microdata)];
  const names = new Set(products.map((p) => normalizeText(p.name)).filter((n) => n !== ''));
  if (products.length > 0 && names.size <= 1) return { products, isProductPage: true, reason: 'schema.org Product data for one product' };
  if (names.size > 1) return { products, isProductPage: false, reason: `schema.org data for ${String(names.size)} different products (a listing page)` };
  const ogType = snapshot.meta.find((m) => m.property === 'og:type')?.content.toLowerCase() ?? '';
  if (ogType === 'product' || ogType === 'product.item' || ogType === 'og:product') return { products, isProductPage: true, reason: 'Open Graph type "product"' };
  if (snapshot.addToCart && PRODUCT_URL.test(pathOf(snapshot.url))) return { products, isProductPage: true, reason: 'product-like URL and an add-to-cart control' };
  return { products, isProductPage: false, reason: 'no product data, product meta tag or add-to-cart control found' };
}

/** Pick the main product: the one named in the first heading, else the one with most data. */
function mainProduct(products: readonly StructuredProduct[], heading: string): StructuredProduct | undefined {
  const h = normalizeText(heading);
  const named = products.find((p) => p.name !== '' && h !== '' && (h.includes(normalizeText(p.name)) || normalizeText(p.name).includes(h)));
  if (named !== undefined) return named;
  const score = (p: StructuredProduct): number => p.identifiers.length + p.images.length + p.brands.length + (p.manufacturer === null ? 0 : 3) + p.properties.length;
  return [...products].sort((a, b) => score(b) - score(a))[0];
}

interface VisibleIndex {
  /** Visible or collapsed unit whose text contains the value, if any. */
  find(value: string): { visibility: Visibility; selector: string } | null;
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * True if `needle` occurs in `hay` as a whole word sequence, not inside a
 * longer word: "ora" is in "ora vase", not in "decorative". Pure.
 */
export function containsWords(hay: string, needle: string): boolean {
  if (needle === '') return false;
  for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + 1)) {
    const before = at === 0 ? '' : hay.charAt(at - 1);
    const after = hay.charAt(at + needle.length);
    const startOk = before === '' || !WORD_CHAR.test(before) || !WORD_CHAR.test(needle.charAt(0));
    const endOk = after === '' || !WORD_CHAR.test(after) || !WORD_CHAR.test(needle.charAt(needle.length - 1));
    if (startOk && endOk) return true;
  }
  return false;
}

function visibleIndex(units: readonly TextUnit[]): VisibleIndex {
  const shown = units.filter((u) => u.visibility === 'visible' || u.visibility === 'collapsed').map((u) => ({ u, n: normalizeText(u.text) }));
  return {
    find(value: string) {
      const v = normalizeText(value);
      if (v.length < 3) return null;
      const hit = shown.find((s) => s.u.visibility === 'visible' && containsWords(s.n, v)) ?? shown.find((s) => containsWords(s.n, v));
      return hit === undefined ? null : { visibility: hit.u.visibility === 'visible' ? 'visible' : 'collapsed', selector: hit.u.selector };
    },
  };
}

function structuredEvidence(source: EvidenceSource, field: string, text: string, index: VisibleIndex, corroborate: string = text): Evidence {
  const seen = index.find(corroborate);
  return {
    source,
    text: clip(text, 300),
    selector: seen?.selector ?? '',
    field,
    visibility: seen?.visibility ?? 'hidden',
  };
}

function addressStrength(a: StructuredAddress): Strength | null {
  if (a.street !== '' && (a.postalCode !== '' || a.locality !== '')) return 'strong';
  if ((a.postalCode !== '' || a.locality !== '') && a.country !== '') return 'medium';
  const hit = scoreAddress(a.text);
  if (hit !== null) return hit.strength;
  return a.text === '' ? null : 'weak';
}

/** Words that mark an image as decoration, as whole words only ("Silicone" is not an icon). */
const LOGO = /(?<![a-z])(?:logo|icon|sprite|badge|payment|flag|avatar|banner|placeholder|spinner|loader)s?(?![a-z])/i;

function fileKey(src: string): string {
  try {
    const u = new URL(src);
    const last = u.pathname.split('/').pop() ?? '';
    return last.replace(/(?:[_-]\d{2,4}x\d{0,4}|@\dx)(?=\.\w+$)/, '').toLowerCase();
  } catch {
    return '';
  }
}

function addStructured(b: FactsBuilder, p: StructuredProduct, index: VisibleIndex, visibleImageKeys: ReadonlySet<string>): void {
  const src = p.source;
  const m = p.manufacturer;
  if (m !== null) {
    if (m.name !== null) {
      const ev = structuredEvidence(src, m.name.field, m.name.value, index);
      b.manufacturer.names.push({
        value: m.name.value,
        strength: ev.visibility === 'hidden' ? 'strong' : 'medium',
        evidence: ev,
        ...(ev.visibility === 'hidden' ? {} : { note: 'The name from the structured data also appears in the visible text, but not under a manufacturer label.' }),
      });
    }
    for (const a of m.addresses) {
      const strength = addressStrength(a);
      if (strength === null) continue;
      const corroborate = a.street !== '' ? a.street : a.postalCode !== '' ? a.postalCode : a.text;
      b.manufacturer.postal.push({ value: a.text, strength, evidence: structuredEvidence(src, a.field, a.text, index, corroborate) });
      const hit = scoreAddress(a.text);
      if (hit?.country !== undefined) b.manufacturer.countries.push(hit.country);
    }
    for (const e of m.emails) b.manufacturer.electronic.push({ value: e.value, strength: 'strong', evidence: structuredEvidence(src, e.field, e.value, index) });
    for (const u of m.urls) {
      b.manufacturer.electronic.push({
        value: u.value,
        strength: 'medium',
        evidence: structuredEvidence(src, u.field, u.value, index),
        note: 'A web address; the Regulation does not define "electronic address", so check that it lets people contact the manufacturer.',
      });
    }
  }
  for (const brand of p.brands) b.brands.push({ value: brand.value, strength: 'medium', evidence: structuredEvidence(src, brand.field, brand.value, index) });
  if (p.seller?.name !== null && p.seller?.name !== undefined) {
    b.sellers.push({ value: p.seller.name.value, strength: 'medium', evidence: structuredEvidence(src, p.seller.name.field, p.seller.name.value, index) });
  }
  for (const img of p.images) {
    const shown = visibleImageKeys.has(fileKey(img.value));
    b.pictures.push({
      value: img.value,
      strength: 'strong',
      evidence: { source: src, text: clip(img.value, 300), selector: '', field: img.field, visibility: shown ? 'visible' : 'hidden' },
    });
  }
  for (const model of p.models) b.types.push({ value: model.value, strength: 'strong', evidence: structuredEvidence(src, model.field, model.value, index) });
  for (const id of p.identifiers) {
    const c = identifierCandidate(id.value, id.kind, structuredEvidence(src, id.field, id.value, index), true);
    if (c !== null) b.identifiers.push(c);
    if (id.kind === 'mpn' && c !== null) b.types.push({ ...c, strength: 'medium', note: 'A manufacturer part number; it often designates the type.' });
  }
}

/**
 * Build facts for the main product on a page. Pure.
 *
 * @example
 * ```ts
 * const facts = pageFacts(snapshot);
 * const results = evaluateFacts(facts);
 * ```
 */
export function pageFacts(snapshot: PageSnapshot, products: PageProducts = pageProducts(snapshot)): ProductFacts {
  const units: TextUnit[] = snapshot.blocks.map((blk) => ({ ...blk }));
  const index = visibleIndex(units);
  const b: FactsBuilder = {
    manufacturer: partyBuilder(),
    responsible: partyBuilder(),
    brands: [],
    sellers: [],
    pictures: [],
    types: [],
    identifiers: [],
    safety: [],
  };

  // Rendered pictures. Wide banners and narrow strips are weaker evidence than a product shot,
  // and a picture whose alt text or file name shares a word with the product name comes first.
  const heading = snapshot.blocks.find((u) => u.level === 1)?.text ?? '';
  const main = mainProduct(products.products, heading);
  const nameWords = new Set(
    normalizeText(main?.name !== undefined && main.name !== '' ? main.name : heading)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 4),
  );
  const namesProduct = (img: { readonly alt: string; readonly src: string }): boolean =>
    normalizeText(`${img.alt} ${fileKey(img.src)}`)
      .split(/[^\p{L}\p{N}]+/u)
      .some((w) => nameWords.has(w));
  const images = [...snapshot.images].sort((x, y) => Number(namesProduct(y)) - Number(namesProduct(x)));
  const visibleImageKeys = new Set<string>();
  for (const img of images) {
    if (LOGO.test(`${img.src} ${img.alt} ${img.selector}`)) continue;
    visibleImageKeys.add(fileKey(img.src));
    const ratio = img.height > 0 ? img.width / img.height : 0;
    const strong = img.inMain && img.width >= 200 && img.height >= 200 && ratio <= 2.2 && ratio >= 0.45;
    b.pictures.push({
      value: img.src,
      strength: strong ? 'strong' : 'medium',
      evidence: { source: 'image', text: clip(`${img.alt === '' ? 'image' : img.alt} (${String(img.width)}x${String(img.height)}) ${img.src}`, 300), selector: img.selector, field: '', visibility: 'visible' },
    });
  }

  if (main !== undefined) {
    addStructured(b, main, index, visibleImageKeys);
    // additionalProperty pairs behave like labelled rows, but are not visible.
    const propUnits: TextUnit[] = main.properties.map((p) => ({
      selector: '',
      text: `${p.name}: ${p.value}`,
      tag: 'property',
      headingLike: false,
      level: 0,
      lead: '',
      visibility: index.find(p.value) === null ? 'hidden' : 'visible',
      links: [],
      source: main.source,
      field: p.field,
    }));
    addSections(b, findSections(propUnits));
  }
  const sections = findSections(units);
  addSections(b, sections);

  // Meta tags.
  for (const m of snapshot.meta) {
    if (m.property === 'og:image' && m.content !== '') {
      const shown = visibleImageKeys.has(fileKey(m.content));
      b.pictures.push({ value: m.content, strength: 'medium', evidence: { source: 'meta', text: clip(m.content, 300), selector: '', field: 'og:image', visibility: shown ? 'visible' : 'hidden' } });
    }
    if (m.property === 'product:brand' && m.content !== '') b.brands.push({ value: m.content, strength: 'medium', evidence: structuredEvidence('meta', m.property, m.content, index) });
    if (m.property === 'product:retailer_item_id' && m.content !== '') {
      const c = identifierCandidate(m.content, 'sku', structuredEvidence('meta', m.property, m.content, index), false);
      if (c !== null) b.identifiers.push(c);
    }
  }

  // The product name may state the type; a weak candidate that asks for review.
  const productName = main?.name !== undefined && main.name !== '' ? main.name : heading !== '' ? heading : snapshot.title;
  if (productName !== '' && b.types.length === 0) {
    const seen = index.find(productName);
    b.types.push({
      value: productName,
      strength: 'weak',
      evidence: { source: 'text', text: clip(productName, 300), selector: seen?.selector ?? '', field: '', visibility: seen?.visibility ?? 'hidden' },
      note: 'Only the product name was found; check whether it states the type.',
    });
  }

  const limitations: string[] = [];
  if (snapshot.truncated) limitations.push('collection limits were reached, so part of the page was not read');
  if (snapshot.iframes > 0) limitations.push(`${String(snapshot.iframes)} frame(s) were not read`);
  if (snapshot.backgroundImages > 0 && b.pictures.length === 0) limitations.push('pictures set as CSS backgrounds are not inspected');
  const emptyTabs = sections.filter((s) => s.content.length === 0 && s.labelUnit.headingLike && s.category !== 'seller');
  if (emptyTabs.length > 0) limitations.push(`${String(emptyTabs.length)} labelled section(s) had no readable content (they may load on click)`);

  return {
    productName: clip(productName, 300),
    manufacturer: b.manufacturer,
    responsible: b.responsible,
    brands: b.brands,
    sellers: b.sellers,
    pictures: b.pictures,
    types: b.types,
    identifiers: b.identifiers,
    safety: b.safety,
    coverage: { kind: 'page', limitations, mappedElements: new Set() },
  };
}
