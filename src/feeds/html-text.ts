// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Turn product description HTML from a feed into text units for label
 * matching. This is a tolerant tokenizer, not a browser: it never runs or
 * renders anything, and keeps only text, line breaks, headings and
 * table/term pairs. Pure.
 */

import type { TextUnit } from '../detect/sections.js';

const NAMED: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', copy: '©', reg: '®', trade: '™', euro: '€' };

/** Decode common HTML entities; unknown ones are left as they are. Pure. */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (m, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      if (!Number.isFinite(code) || code < 32 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return m === '&#10;' || m === '&#9;' ? ' ' : '';
      return String.fromCodePoint(code);
    }
    const value = Object.hasOwn(NAMED, name.toLowerCase()) ? NAMED[name.toLowerCase()] : undefined;
    return value ?? m;
  });
}

const BLOCK = new Set(['p', 'div', 'section', 'article', 'aside', 'header', 'footer', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'dl', 'dt', 'dd', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'address', 'details', 'summary', 'figure', 'figcaption', 'hr']);

/** Maximum HTML length read from one field. */
export const MAX_HTML_CHARS = 200_000;

/**
 * Split HTML (or plain text) into units. Each block element or line break
 * starts a new unit; headings, `dt`, `th`, `summary` and bold-only lines are
 * heading-like; table rows with two cells and `dt`/`dd` pairs become
 * "label: value". Pure.
 *
 * @example
 * ```ts
 * htmlToUnits('<p><strong>Manufacturer:</strong> ACME GmbH</p>', 'Description').map((u) => u.text); // ["Manufacturer: ACME GmbH"]
 * ```
 */
export function htmlToUnits(html: string, field: string, maxUnits = 2000): TextUnit[] {
  const src = html.slice(0, MAX_HTML_CHARS).replace(/<(script|style|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
  const units: TextUnit[] = [];
  let buf = '';
  let level = 0;
  let headingLike = false;
  let boldOnly = true;
  let sawText = false;
  let cell = -1;
  const flush = (): void => {
    const text = decodeHtmlEntities(buf).replace(/\s+/g, ' ').trim();
    if (text !== '' && units.length < maxUnits) {
      units.push({ selector: '', text: text.slice(0, 2000), tag: level > 0 ? `h${String(level)}` : 'p', headingLike: headingLike || level > 0 || (boldOnly && sawText && text.length <= 60), level, lead: '', visibility: 'n/a', links: [], source: 'feed', field });
    }
    buf = '';
    level = 0;
    headingLike = false;
    boldOnly = true;
    sawText = false;
  };
  let bold = 0;
  const re = /<\s*(\/?)\s*([a-z][a-z0-9]*)\b[^>]*>|([^<]+)|(<)/gi;
  for (const m of src.matchAll(re)) {
    if (m[3] !== undefined || m[4] !== undefined) {
      const text = m[3] ?? m[4] ?? '';
      if (text.trim() !== '') {
        sawText = true;
        if (bold === 0) boldOnly = false;
      }
      // Plain-text descriptions: line breaks separate units too.
      const parts = text.split(/\r?\n/);
      parts.forEach((p, i) => {
        if (i > 0) flush();
        buf += p;
      });
      continue;
    }
    const closing = m[1] === '/';
    const tag = (m[2] ?? '').toLowerCase();
    if (tag === 'strong' || tag === 'b') {
      bold = Math.max(0, bold + (closing ? -1 : 1));
      continue;
    }
    if (tag === 'br') {
      flush();
      continue;
    }
    if (tag === 'td' || tag === 'th') {
      if (closing) {
        cell += 1;
        if (cell === 1 && !/[:：]\s*$/.test(buf)) buf += ':';
        buf += ' ';
      }
      continue;
    }
    if (tag === 'tr') {
      if (closing) flush();
      cell = 0;
      continue;
    }
    if (tag === 'dt') {
      if (closing && !/[:：]\s*$/.test(buf)) buf += ': ';
      else if (!closing) flush();
      continue;
    }
    if (tag === 'dd') {
      // The description continues the term's line ("Model: K1").
      if (closing) flush();
      continue;
    }
    if (BLOCK.has(tag)) {
      if (!closing) {
        flush();
        const h = /^h([1-6])$/.exec(tag);
        if (h !== null) level = Number(h[1]);
        if (tag === 'summary') headingLike = true;
      } else {
        flush();
      }
    }
  }
  flush();
  return units;
}
