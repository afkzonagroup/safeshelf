// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Product identifiers: GTIN check digits and simple shape checks. Pure.
 */

/** Kinds of identifier Safeshelf recognises. */
export type IdentifierKind = 'gtin' | 'mpn' | 'sku' | 'model' | 'isbn' | 'other';

/**
 * True if `digits` is a GTIN-8, -12, -13 or -14 with a correct check digit
 * (GS1 mod-10 algorithm). Spaces and hyphens are ignored. Pure.
 *
 * @example
 * ```ts
 * isValidGtin('4006381333931'); // true
 * isValidGtin('4006381333932'); // false
 * ```
 */
export function isValidGtin(value: string): boolean {
  const digits = value.replace(/[\s-]/g, '');
  if (!/^\d+$/.test(digits) || ![8, 12, 13, 14].includes(digits.length)) return false;
  if (/^0+$/.test(digits)) return false;
  let sum = 0;
  const body = digits.slice(0, -1);
  for (let i = 0; i < body.length; i += 1) {
    const d = Number(body[body.length - 1 - i]);
    sum += i % 2 === 0 ? d * 3 : d;
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(digits[digits.length - 1]);
}

/** True if a string looks like a GTIN (8 to 14 digits), valid or not. Pure. */
export function looksLikeGtin(value: string): boolean {
  return /^\d{8,14}$/.test(value.replace(/[\s-]/g, ''));
}

/**
 * True if a value could be an identifier: 2 to 64 characters with at least one
 * letter or digit and no spaces runs longer than a few words. Pure.
 */
export function isPlausibleIdentifier(value: string): boolean {
  const v = value.trim();
  if (v.length < 2 || v.length > 64) return false;
  if (!/[\p{L}\p{N}]/u.test(v)) return false;
  if (v.split(/\s+/).length > 4) return false;
  return /\d/.test(v) || /^[A-Z0-9][A-Z0-9._/-]+$/u.test(v);
}

/** Identifier kind for a structured-data property name or a feed column. Pure. */
export function identifierKindOf(property: string): IdentifierKind {
  const p = property.toLowerCase();
  if (/^gtin(?:8|12|13|14)?$|ean|upc|barcode|gtin/.test(p)) return 'gtin';
  if (p === 'isbn') return 'isbn';
  if (p === 'mpn' || p.includes('part number')) return 'mpn';
  if (p === 'sku' || p.includes('sku')) return 'sku';
  if (p === 'model') return 'model';
  return 'other';
}
