// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Heuristics for postal addresses, email addresses, web addresses and
 * countries in free text. Pure functions, transparent rules:
 *
 * A postal address scores points for a postcode in a known format, a street
 * word with a number, a house-number pattern and a country name. The
 * thresholds are in {@link scoreAddress}. Nothing here checks that an address
 * exists or is correct.
 */

import { COUNTRIES, type Country } from '../data/countries.js';
import { normalizeText } from './text.js';

/** How strong a detected item is. */
export type Strength = 'strong' | 'medium' | 'weak';

/** Postcode patterns. `strong` patterns rarely match anything else. Maintainers' list. */
const POSTCODES: readonly { readonly re: RegExp; readonly strong: boolean; readonly name: string }[] = [
  { name: 'prefixed', strong: true, re: /\b(?:A|B|D|F|I|L|CH|DK|FI|FR|DE|AT|BE|LT|LV|EE|SE|NO|PL|CZ|SK|SI|HR|HU|RO|BG|GR|PT|ES|IT|LU|NL|IE|MT|CY)-\d{4,5}\b/u },
  { name: 'nl', strong: true, re: /\b\d{4}\s?[A-Z]{2}\b/u },
  { name: 'pl', strong: true, re: /\b\d{2}-\d{3}\b/u },
  { name: 'pt', strong: true, re: /\b\d{4}-\d{3}\b/u },
  { name: 'uk', strong: true, re: /\b[A-Z]{1,2}\d[A-Z\d]?\s+\d[A-Z]{2}\b/u },
  { name: 'ie', strong: false, re: /\b[AC-FHKNPRTV-Y]\d{2}\s?[AC-FHKNPRTV-Y0-9]{4}\b/u },
  // Maltese postcodes look like model numbers ("ISO 9001"), so they are not strong.
  { name: 'mt', strong: false, re: /\b[A-Z]{3}\s?\d{4}\b/u },
  { name: 'us-zip4', strong: true, re: /\b\d{5}-\d{4}\b/u },
  { name: 'space5', strong: false, re: /\b\d{3}\s\d{2}\b/u },
  { name: 'five', strong: false, re: /\b\d{5}\b/u },
  { name: 'six', strong: false, re: /\b\d{6}\b/u },
  { name: 'four', strong: false, re: /\b\d{4}\b/u },
];

/**
 * Street words in many languages. A street word next to a number scores high.
 * Maintainers' list; the words are common address vocabulary, not legal text.
 */
const STREET_WORDS =
  '(?:straße|strasse|str\\.|gasse|weg|platz|allee|ring|damm|chaussee|ufer|rue|avenue|av\\.|boulevard|bd\\.?|chemin|place|quai|impasse|calle|c/|avda\\.?|avenida|plaza|paseo|carrer|via|viale|piazza|corso|largo|vicolo|street|st\\.|road|rd\\.?|lane|drive|way|ave\\.?|court|square|park|ul\\.|ulica|aleja|al\\.|os\\.|gatvė|g\\.|prospektas|pr\\.|iela|tänav|tee|maantee|katu|tie|kuja|gata|gatan|vägen|väg|vej|gade|allé|straat|laan|plein|gracht|kade|utca|út|tér|krt\\.|ulice|nám\\.|náměstí|třída|cesta|trg|rua|praça|travessa|largo|estrada|strada|bulevardul|bd\\.|calea|șoseaua|οδός|οδ\\.|λεωφόρος|ул\\.|улица|бул\\.|булевард|triq|sráid|bóthar|road|building|bldg|floor|room|suite|unit|no\\.|district|zone|industrial|號|号|路|街|区|區|市)';

// Street word then number ("Hauptstraße 5", "ul. Długa 5" via the word rule), or number then street ("5 Main Street").
const STREET_NEAR_NUMBER = new RegExp(`(?:${STREET_WORDS}\\s*\\d{1,5}[a-z]?\\b|\\b\\d{1,5}[a-z]?,?\\s+(?:[\\p{L}'-]+\\s){0,3}${STREET_WORDS})`, 'iu');
const WORD_THEN_NUMBER = /[\p{L}]{3,}\.?\s+\d{1,5}[a-z]?(?:\s*[-/]\s*\d{1,4})?(?=[\s,;]|$)/u;
const PO_BOX = /\b(?:p\.?\s?o\.?\s?box|postfach|boîte postale|bp\s\d|apartado|casella postale|skrytka pocztowa|postbus|box\s\d{2,})/iu;

/** True if the text has a street word next to a house number ("Hauptstraße 5", "5 Main Street"). Pure. */
export function hasStreetNumber(text: string): boolean {
  return STREET_NEAR_NUMBER.test(text.slice(0, 500));
}

/** A detected postal address. */
export interface AddressHit {
  readonly strength: Strength;
  /** Points scored, for transparency. */
  readonly score: number;
  /** Signals that scored. */
  readonly signals: readonly string[];
  readonly country?: Country;
}

/**
 * Score a text as a postal address. Points: strong postcode 1.5, other
 * postcode 1, street word with a number 1.5, a word followed by a number 0.5,
 * post-office box 1.5, country name 1. `strong` at 3 or more, `medium` at 2,
 * `weak` at 1. Returns null below 1. Pure.
 *
 * @example
 * ```ts
 * scoreAddress('Hauptstraße 5, 10115 Berlin, Germany')?.strength; // "strong"
 * ```
 */
export function scoreAddress(text: string): AddressHit | null {
  const t = text.slice(0, 2000);
  const signals: string[] = [];
  let score = 0;
  const strongPost = POSTCODES.find((p) => p.strong && p.re.test(t));
  const anyPost = strongPost ?? POSTCODES.find((p) => !p.strong && p.re.test(t));
  if (strongPost !== undefined) {
    score += 1.5;
    signals.push(`postcode (${strongPost.name})`);
  } else if (anyPost !== undefined) {
    score += 1;
    signals.push(`postcode (${anyPost.name})`);
  }
  if (STREET_NEAR_NUMBER.test(t)) {
    score += 1.5;
    signals.push('street and number');
  } else if (PO_BOX.test(t)) {
    score += 1.5;
    signals.push('post-office box');
  } else if (WORD_THEN_NUMBER.test(t)) {
    score += 0.5;
    signals.push('word and number');
  }
  const country = findCountry(t);
  if (country !== null) {
    score += 1;
    signals.push(`country (${country.code})`);
  }
  if (score < 1) return null;
  const strength: Strength = score >= 3 ? 'strong' : score >= 2 ? 'medium' : 'weak';
  return { strength, score, signals, ...(country === null ? {} : { country }) };
}

const COUNTRY_INDEX: readonly { readonly re: RegExp; readonly country: Country }[] = COUNTRIES.flatMap((country) =>
  country.names.map((name) => ({
    country,
    re: new RegExp(`(?<![\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'gu'),
  })),
);

/** "Made in China" and similar: a country of origin, not where a company is established. Maintainers' list. */
const ORIGIN_BEFORE = /(?:made|manufactured|produced|assembled)\s+in|origin:?|hergestellt\s+in|herkunft(?:sland)?:?|ursprungsland:?|fabriqué\s+en|pays\s+d'origine:?|hecho\s+en|fabricado\s+en|país\s+de\s+origen:?|prodotto\s+in|fabbricato\s+in|paese\s+di\s+origine:?|wyprodukowano\s+w|kraj\s+pochodzenia:?|pagaminta|kilmės\s+šalis:?|vervaardigd\s+in|gemaakt\s+in|land\s+van\s+herkomst:?|tillverkad\s+i|valmistettu|vyrobeno\s+v|vyrobené\s+v|készült|fabricat\s+în|произведено\s+в|κατασκευάζεται\s+στην/u;

const ORIGIN_END = new RegExp(`(?:${ORIGIN_BEFORE.source})\\s*$`, 'u');

/** ISO alpha-2 codes accepted only at the end of an address ("..., DE") or as a postcode prefix. */
const TRAILING_CODE = /(?:^|[\s,])([A-Z]{2})\s*$/u;

/**
 * Country named in the text: full names in several languages, or an ISO
 * code at the very end ("…, DE") or as a postcode prefix ("DE-10115"). The
 * last mention wins, because addresses end with the country. A country of
 * origin ("Made in China") is ignored. Pure.
 */
export function findCountry(text: string): Country | null {
  const norm = normalizeText(text);
  let best: { index: number; country: Country } | null = null;
  for (const { re, country } of COUNTRY_INDEX) {
    for (const m of norm.matchAll(re)) {
      const before = norm.slice(Math.max(0, m.index - 30), m.index);
      if (ORIGIN_END.test(before)) continue;
      if (best === null || m.index > best.index) best = { index: m.index, country };
    }
  }
  if (best !== null) return best.country;
  const trailing = TRAILING_CODE.exec(text.trim());
  const prefixed = /\b([A-Z]{2})-\d{4,5}\b/u.exec(text);
  const code = trailing?.[1] ?? prefixed?.[1];
  if (code !== undefined) return COUNTRIES.find((c) => c.code === code) ?? null;
  return null;
}

/** A country from an ISO code or a name, or null. Pure. */
export function countryFromValue(value: string): Country | null {
  const v = value.trim();
  if (/^[A-Za-z]{2}$/.test(v)) return COUNTRIES.find((c) => c.code === v.toUpperCase()) ?? null;
  return findCountry(v);
}

const EMAIL = /[A-Za-z0-9](?:[A-Za-z0-9._%+-]{0,63})@[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?)*\.[A-Za-z]{2,24}\b/gu;
// "info [at] example [dot] com", "info(at)example.com": a bracketed "at" with any dot form.
const OBFUSCATED_BRACKETED =
  /[A-Za-z0-9][A-Za-z0-9._%+-]{0,63}\s*(?:\[\s*at\s*\]|\(\s*at\s*\)|\{\s*at\s*\}|\[@\]|\(@\))\s*[A-Za-z0-9-]{1,63}(?:\s*(?:\[\s*dot\s*\]|\(\s*dot\s*\)|\.)\s*[A-Za-z0-9-]{1,63}){0,5}?\s*(?:\[\s*dot\s*\]|\(\s*dot\s*\)|\.)\s*[A-Za-z]{2,24}\b/iu;
// "info at example dot com": a spelled "at" only together with a spelled "dot", so prose ("care at home. Visit") does not match.
const OBFUSCATED_SPELLED = /[A-Za-z0-9][A-Za-z0-9._%+-]{0,63}\s+at\s+[A-Za-z0-9-]{1,63}(?:\s+dot\s+[A-Za-z0-9-]{1,63}){0,5}?\s+dot\s+[A-Za-z]{2,24}\b/iu;

/** Email addresses in the text (at most 10). Pure. */
export function findEmails(text: string): string[] {
  const out: string[] = [];
  for (const m of text.slice(0, 5000).matchAll(EMAIL)) {
    if (out.length >= 10) break;
    out.push(m[0]);
  }
  return out;
}

/** An obfuscated email address such as "info [at] example [dot] com", or null. Pure. */
export function findObfuscatedEmail(text: string): string | null {
  const t = text.slice(0, 5000);
  const m = OBFUSCATED_BRACKETED.exec(t) ?? OBFUSCATED_SPELLED.exec(t);
  return m === null ? null : m[0];
}

const WEB = /\b(?:https?:\/\/[^\s<>"']{3,200}|www\.[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})+(?:\/[^\s<>"']{0,200})?)/iu;

/** A web address (URL or www. host) in the text, or null. Pure. */
export function findWebAddress(text: string): string | null {
  const m = WEB.exec(text.slice(0, 5000));
  return m === null ? null : m[0].replace(/[.,;)]+$/u, '');
}

/** True if a string looks like an email address and nothing else. Pure. */
export function isEmail(value: string): boolean {
  const v = value.trim();
  const m = findEmails(v);
  return m.length === 1 && m[0] === v;
}
