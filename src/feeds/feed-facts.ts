// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Build {@link ProductFacts} from a feed record. Pure.
 *
 * A feed shows which data exists, not what the shop displays: every piece of
 * evidence has visibility `n/a`.
 */

import { findEmails, findWebAddress, isEmail, scoreAddress, countryFromValue } from '../detect/address.js';
import { partyBuilder, type ProductFacts } from '../detect/facts.js';
import { addPartyText, addSections, identifierCandidate, type FactsBuilder } from '../detect/interpret.js';
import { findSections, type TextUnit } from '../detect/sections.js';
import { clip, isPlaceholder, squash } from '../detect/text.js';
import type { ElementId, Evidence } from '../types.js';
import { htmlToUnits } from './html-text.js';
import type { FieldRole } from './mapping.js';
import type { FeedField, FeedRecord } from './readers.js';

const ev = (f: FeedField, text: string = f.value): Evidence => ({ source: 'feed', text: clip(squash(text), 300), selector: '', field: f.column, visibility: 'n/a' });

const YES = /^(?:y|yes|true|1|ja|oui|sí|si|tak|taip|kyllä|igen|da|ano|áno|jah|jā|sim|ναι|да|iva)$/i;
const NO = /^(?:n|no|false|0|nein|non|nie|ne|ei|nem|nu|nē|não|όχι|не|le|nej)$/i;

/** Elements that have a dedicated column when a role is present. */
const ROLE_ELEMENTS: Readonly<Partial<Record<FieldRole, readonly ElementId[]>>> = {
  manufacturerName: ['manufacturer-name'],
  manufacturerAddress: ['manufacturer-postal-address'],
  manufacturerEmail: ['manufacturer-electronic-address'],
  manufacturerText: ['manufacturer-name', 'manufacturer-postal-address', 'manufacturer-electronic-address'],
  responsibleName: ['responsible-person-name'],
  responsibleAddress: ['responsible-person-postal-address'],
  responsibleEmail: ['responsible-person-electronic-address'],
  responsibleText: ['responsible-person-name', 'responsible-person-postal-address', 'responsible-person-electronic-address'],
  image: ['product-picture'],
  type: ['product-type'],
  gtin: ['product-identifier'],
  mpn: ['product-identifier'],
  sku: ['product-identifier'],
  identifier: ['product-identifier'],
  safety: ['safety-information'],
};

/** Elements with a mapped column, given the roles present in a file. Pure. */
export function mappedElements(roles: ReadonlySet<FieldRole>): Set<ElementId> {
  const out = new Set<ElementId>();
  for (const role of roles) for (const e of ROLE_ELEMENTS[role] ?? []) out.add(e);
  return out;
}

/** The record's title (first title field), or its key. */
export function recordTitle(record: FeedRecord): string {
  return record.fields.find((f) => f.role === 'title')?.value ?? record.key;
}

/**
 * Facts for one record.
 *
 * @example
 * ```ts
 * const facts = feedFacts(record, new Set(['manufacturerName', 'image']));
 * ```
 */
export function feedFacts(record: FeedRecord, roles: ReadonlySet<FieldRole>): ProductFacts {
  const b: FactsBuilder = { manufacturer: partyBuilder(), responsible: partyBuilder(), brands: [], sellers: [], pictures: [], types: [], identifiers: [], safety: [] };
  let manufacturerInEu: boolean | undefined;
  const units: TextUnit[] = [];
  for (const f of record.fields) {
    const value = f.value;
    if (isPlaceholder(value)) continue;
    const party = f.role.startsWith('manufacturer') ? b.manufacturer : b.responsible;
    switch (f.role) {
      case 'manufacturerName':
      case 'responsibleName':
        party.names.push({ value: clip(squash(value), 200), strength: 'strong', evidence: ev(f) });
        break;
      case 'manufacturerAddress':
      case 'responsibleAddress': {
        const hit = scoreAddress(value);
        party.postal.push({
          value: clip(squash(value), 300),
          strength: hit?.strength ?? 'weak',
          evidence: ev(f),
          note: hit === null ? 'The column has a value, but it does not look like a postal address.' : `Address signals: ${hit.signals.join(', ')}.`,
        });
        if (hit?.country !== undefined) party.countries.push(hit.country);
        break;
      }
      case 'manufacturerEmail':
      case 'responsibleEmail': {
        const email = findEmails(value)[0];
        const web = findWebAddress(value);
        if (email !== undefined) party.electronic.push({ value: email, strength: isEmail(value.trim()) ? 'strong' : 'medium', evidence: ev(f) });
        else if (web !== null) party.electronic.push({ value: web, strength: 'medium', evidence: ev(f), note: 'A web address; the Regulation does not define "electronic address", so check that it lets people contact the party.' });
        else party.electronic.push({ value: clip(value, 200), strength: 'weak', evidence: ev(f), note: 'The column has a value, but it is not an email or web address.' });
        break;
      }
      case 'manufacturerText':
      case 'responsibleText':
        addPartyText(party, value.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]{0,500}>/g, ' '), (text) => ev(f, text), { labelled: true });
        break;
      case 'manufacturerCountry': {
        const c = countryFromValue(value);
        if (c !== null) b.manufacturer.countries.push(c);
        break;
      }
      case 'manufacturerInEu':
        if (YES.test(value.trim())) manufacturerInEu = true;
        else if (NO.test(value.trim())) manufacturerInEu = false;
        break;
      case 'brand':
        b.brands.push({ value: clip(squash(value), 200), strength: 'medium', evidence: ev(f) });
        break;
      case 'seller':
        b.sellers.push({ value: clip(squash(value), 200), strength: 'medium', evidence: ev(f) });
        break;
      case 'image':
        b.pictures.push({ value, strength: /^https?:\/\//i.test(value) ? 'strong' : 'medium', evidence: ev(f) });
        break;
      case 'type':
        b.types.push({ value: clip(squash(value), 120), strength: 'strong', evidence: ev(f) });
        break;
      case 'gtin':
      case 'mpn':
      case 'sku':
      case 'identifier': {
        const kind = f.role === 'identifier' ? 'other' : f.role;
        const c = identifierCandidate(value, kind, ev(f), true);
        if (c !== null) b.identifiers.push(c);
        break;
      }
      case 'safety':
        b.safety.push({ value: clip(squash(value), 300), strength: squash(value).length >= 8 ? 'strong' : 'weak', evidence: ev(f) });
        break;
      case 'description':
        units.push(...htmlToUnits(value, f.column));
        break;
      case 'labelled':
        units.push(...htmlToUnits(value, f.column).map((u) => ({ ...u, headingLike: false })));
        break;
      case 'title':
      case 'url':
        break;
    }
  }
  addSections(b, findSections(units));
  const title = recordTitle(record);
  if (b.types.length === 0 && title !== '') {
    const titleField = record.fields.find((f) => f.role === 'title');
    b.types.push({
      value: clip(title, 200),
      strength: 'weak',
      evidence: { source: 'feed', text: clip(title, 300), selector: '', field: titleField?.column ?? '', visibility: 'n/a' },
      note: 'Only the product name was found; check whether it states the type.',
    });
  }
  return {
    productName: clip(title, 300),
    manufacturer: b.manufacturer,
    responsible: b.responsible,
    brands: b.brands,
    sellers: b.sellers,
    pictures: b.pictures,
    types: b.types,
    identifiers: b.identifiers,
    safety: b.safety,
    coverage: { kind: 'feed', limitations: [], mappedElements: mappedElements(roles) },
    ...(manufacturerInEu === undefined ? {} : { manufacturerInEu }),
  };
}
