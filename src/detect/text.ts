// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Text normalisation and label matching. Pure functions.
 */

import { LABEL_PHRASES, NOT_A_PARTY_FOLLOWERS, type LabelCategory, type LabelPhrase } from '../data/labels.js';

/**
 * Normalise text for matching: Unicode NFKC, lower case, typographic quotes
 * and dashes to ASCII, whitespace collapsed.
 *
 * @example
 * ```ts
 * normalizeText('  HERSTELLER’S  Name '); // "hersteller's name"
 * ```
 */
export function normalizeText(input: string): string {
  return input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’‛′`´]/g, "'")
    .replace(/[“”„«»]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Collapse whitespace without changing case (for evidence and values). */
export function squash(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

/** Collapse whitespace inside each line, drop empty lines and keep the line breaks. */
export function squashLines(input: string): string {
  return input
    .split(/\r\n|[\n\r\u2028\u2029]/u)
    .map((l) => squash(l))
    .filter((l) => l !== '')
    .join('\n');
}

/** Truncate for evidence output. */
export function clip(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Categories that name a party (a person or company with an address). */
export const PARTY_CATEGORIES: ReadonlySet<LabelCategory> = new Set(['manufacturer', 'responsible', 'importer', 'representative', 'fulfilment']);

interface Compiled {
  readonly phrase: LabelPhrase;
  readonly re: RegExp;
}

// A colon-like character, or a dash with a space before it (so "Type-C" is not a label).
const SEPARATOR = '(?:\\s*[:：|=]|\\s+[-–—](?=\\s|$))';
/** Up to three short words or a bracketed note between the label and its separator. */
const SEP_RE = new RegExp(`^((?:\\s*\\([^)]{0,60}\\))?(?:\\s+[\\p{L}\\p{N}'.,/&-]{1,20}){0,3}?\\s*(?:\\([^)]{0,60}\\))?)${SEPARATOR}\\s*`, 'u');
/**
 * For identifier labels the first word may also be joined with a hyphen
 * ("EAN-Code:", "EAN-koodi:", "EAN-13:"). Not for other labels, so that
 * "Type-C: 1 port" is not a type.
 */
const SEP_RE_ID = new RegExp(`^((?:(?:\\s+|-)[\\p{L}\\p{N}'.,/&-]{1,20})?(?:\\s+[\\p{L}\\p{N}'.,/&-]{1,20}){0,2}?\\s*(?:\\([^)]{0,60}\\))?)${SEPARATOR}\\s*`, 'u');
const NOT_PARTY = new RegExp(`^${NOT_A_PARTY_FOLLOWERS}`, 'iu');

const SOURCE_RANK: Readonly<Record<LabelPhrase['source'], number>> = { 'official-text': 0, original: 1, translation: 2 };

function compile(phrases: readonly LabelPhrase[]): Compiled[] {
  return [...phrases]
    // Longest first; on equal length, a phrase from the official text before an unofficial one.
    .sort((a, b) => normalizeText(b.text).length - normalizeText(a.text).length || SOURCE_RANK[a.source] - SOURCE_RANK[b.source])
    .map((phrase) => {
      const body = escapeRegex(normalizeText(phrase.text)).replace(/ /g, '\\s+').replace(/-/g, '[-\\s]?');
      return { phrase, re: new RegExp(`^${body}(?![\\p{L}\\p{N}])`, 'u') };
    });
}

/** Compiled phrases grouped by their first character, so a text is tried only against phrases that can match. */
function bucket(compiled: readonly Compiled[]): ReadonlyMap<string, readonly Compiled[]> {
  const map = new Map<string, Compiled[]>();
  for (const c of compiled) {
    const first = normalizeText(c.phrase.text).charAt(0);
    const list = map.get(first) ?? [];
    list.push(c);
    map.set(first, list);
  }
  return map;
}

const DEFAULT_BUCKETS = bucket(compile(LABEL_PHRASES));

/** Result of a label match. */
export interface LabelMatch {
  readonly phrase: LabelPhrase;
  /** Text after the label and its separator (may be empty). Original case. */
  readonly value: string;
}

/** How a block is shaped, which decides how strict label matching is. */
export interface LabelContext {
  /** Heading, term (`dt`), header cell (`th`), `summary`, tab or a stand-alone label element. */
  readonly headingLike: boolean;
}

/**
 * Match a label at the start of a block of text. A phrase counts when:
 * - the block is heading-like and at most 80 characters long, or
 * - the phrase is followed (after at most three short words or a bracketed
 *   note) by a separator such as ":" or "-", or
 * - the phrase (with an optional colon) is the whole block.
 *
 * Party labels followed by words such as "warranty" or "part number" do not
 * count. Longer phrases are tried first. Pure.
 *
 * @example
 * ```ts
 * matchLabel('Hersteller: ACME GmbH', { headingLike: false })?.value; // "ACME GmbH"
 * matchLabel('The manufacturer recommends ...', { headingLike: false }); // null
 * ```
 */
export function matchLabel(text: string, context: LabelContext, phrases?: readonly LabelPhrase[]): LabelMatch | null {
  if (text.length === 0 || text.length > 4000) return null;
  const buckets = phrases === undefined ? DEFAULT_BUCKETS : bucket(compile(phrases));
  // Match on a lower-cased copy of the same length, so the value can be cut from the original and keep its case.
  // Line breaks are kept: the value of "Manufacturer: ACME GmbH<br>Main Street 5" keeps its lines.
  const original = squashLines(text.normalize('NFKC')).replace(/^[\s*•·▪►›>#\d.)(\-–—]{0,6}/u, '');
  const lowered = original.toLowerCase();
  const norm = lowered.length === original.length ? lowered.replace(/[‘’‛′`´]/g, "'").replace(/[“”„«»]/g, '"').replace(/[‐-―−]/g, '-') : normalizeText(original);
  const source = lowered.length === original.length ? original : norm;
  for (const { phrase, re } of buckets.get(norm.charAt(0)) ?? []) {
    const m = re.exec(norm);
    if (m === null) continue;
    const after = norm.slice(m[0].length);
    if (PARTY_CATEGORIES.has(phrase.category) && NOT_PARTY.test(after)) continue;
    // The separator must be on the label's own line.
    const lineEnd = after.indexOf('\n');
    const firstLine = lineEnd === -1 ? after : after.slice(0, lineEnd);
    const sep = (phrase.category === 'identifier' ? SEP_RE_ID : SEP_RE).exec(firstLine);
    let valueStart: number | null = null;
    if (sep !== null) {
      valueStart = m[0].length + sep[0].length;
    } else if (/^\s*[.:]?\s*$/u.test(firstLine)) {
      // The label alone on its line ("Manufacturer<br>ACME GmbH"): the value is the following lines.
      valueStart = lineEnd === -1 ? norm.length : m[0].length + lineEnd + 1;
    } else if (context.headingLike && norm.length <= 80) {
      valueStart = norm.length;
    }
    if (valueStart === null) continue;
    return { phrase, value: source.slice(valueStart).trim() };
  }
  return null;
}

/** Placeholder values that do not identify anyone. Maintainers' list. */
const PLACEHOLDERS = new RegExp(
  '^(?:n/?a|-+|–|—|\\?+|none|null|unknown|not available|tbd|tba|todo|see (?:packaging|product|label|description|below|above)|siehe (?:verpackung|etikett)|voir (?:emballage|étiquette)|keine angabe|k\\.?\\s?a\\.?|nicht verfügbar|non disponible|nd|xxx+|\\.+|0+)$',
  'iu',
);

/** True if a value is empty or a placeholder such as "n/a" or "see packaging". Pure. */
export function isPlaceholder(value: string): boolean {
  const v = normalizeText(value).replace(/[.:;,]+$/u, '');
  return v === '' || PLACEHOLDERS.test(v);
}
