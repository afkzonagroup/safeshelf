// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Turn labelled sections and free-text party details into candidates.
 * Shared by the page scanner and the feed checker. Pure functions.
 */

import type { Evidence, Visibility } from '../types.js';
import { findEmails, findObfuscatedEmail, findWebAddress, hasStreetNumber, isEmail, scoreAddress, type Strength } from './address.js';
import type { Candidate, IdentifierCandidate, PartyBuilder } from './facts.js';
import { identifierKindOf, isPlausibleIdentifier, isValidGtin, looksLikeGtin, type IdentifierKind } from './identifiers.js';
import type { Section } from './sections.js';
import { clip, isPlaceholder, normalizeText, squash } from './text.js';

/** Mutable collection of candidates for one product. */
export interface FactsBuilder {
  readonly manufacturer: PartyBuilder;
  readonly responsible: PartyBuilder;
  readonly brands: Candidate[];
  readonly sellers: Candidate[];
  readonly pictures: Candidate[];
  readonly types: Candidate[];
  readonly identifiers: IdentifierCandidate[];
  readonly safety: Candidate[];
}

/** Sub-labels inside a party block ("Name:", "Firma:", "Address:"). Maintainers' list; non-English entries are translations. */
const NAME_PREFIX = /^(?:name|company|company name|firm|legal name|firma|firmenname|name des unternehmens|nom|raison sociale|nombre|razón social|ragione sociale|denominazione|naam|bedrijfsnaam|nazwa|nazwa firmy|pavadinimas|įmonė|nosaukums|nimi|yritys|företag|navn|název|obchodní název|názov|ime|naziv|név|cégnév|denumire|име|наименование|επωνυμία|όνομα|isem)\s*[:：]\s*/iu;
const ADDRESS_PREFIX = /^(?:address|postal address|adresse|anschrift|postanschrift|dirección|indirizzo|adres|adresas|adrese|aadress|osoite|adress|adresa|cím|адрес|διεύθυνση|indirizz)\s*[:：]\s*/iu;
const EMAIL_PREFIX = /^(?:e-?mail|email address|e-mail-adresse|courriel|correo(?: electrónico)?|posta elettronica|e-pasts|e-post|el\.?\s?paštas|sähköposti|e-posta|ел\.?\s?поща|ηλ\.?\s?ταχυδρομείο|contact)\s*[:：]\s*/iu;

/** Lines of a section body, cleaned. */
function lines(body: string): string[] {
  return body
    .split(/\n+/)
    .map((l) => squash(l))
    .filter((l) => l !== '');
}

/** Characters of a party block that are read. */
export const MAX_PARTY_TEXT = 3000;

/** Legal-form words that can follow a comma inside a company name. Maintainers' list. */
const LEGAL_FORM_AFTER_COMMA = /^(?:ltd\.?|limited|inc\.?|llc|llp|plc|corp\.?|co\.?|gmbh|kg|ag|ug|e\.?\s?k\.?|ohg|s\.?\s?a\.?(?:\s|$|,)|s\.?\s?l\.?(?:\s|$|,)|s\.?\s?r\.?\s?l\.?|s\.?\s?p\.?\s?a\.?|sas|sarl|b\.?\s?v\.?|n\.?\s?v\.?|oy|oyj|ab|a\/s|aps|as|s\.?\s?r\.?\s?o\.?|a\.?\s?s\.?|sp\.?\s?z\s?o\.?\s?o\.?|uab|kft\.?|zrt\.?|d\.?\s?o\.?\s?o\.?|srl|lda\.?)(?![\p{L}])/iu;

/** Cut a line before the first comma, semicolon, bar or spaced dash whose remainder is an address or contact detail. Pure. */
export function cutBeforeAddress(line: string): string {
  // "ACME SAS – 14 rue des Forges": a dash with spaces around it separates like a comma; "Hewlett-Packard" does not.
  const parts = line.split(/\s*[,;|]\s*|\s+[-–—]\s+/u);
  for (let i = 1; i < Math.min(parts.length, 6); i += 1) {
    const rest = parts.slice(i).join(', ');
    if (LEGAL_FORM_AFTER_COMMA.test(parts[i] ?? '')) continue;
    if (scoreAddress(rest) !== null || findEmails(rest).length > 0) return parts.slice(0, i).join(', ');
  }
  return line;
}

/** Pick the name part of a party block: the first line, cut before an address or contact part. Pure. */
export function extractPartyName(body: string): string | null {
  for (const raw of lines(body).slice(0, 3)) {
    let line = raw.replace(NAME_PREFIX, '');
    if (ADDRESS_PREFIX.test(line) || EMAIL_PREFIX.test(line)) continue;
    if (isEmail(line) || /^(?:https?:\/\/|www\.)/i.test(line)) continue;
    // "ACME GmbH, Hauptstraße 5, 10115 Berlin": keep the part before the first comma or semicolon
    // whose remainder is an address or contact, skipping commas inside legal forms ("Co., Ltd.").
    line = cutBeforeAddress(line);
    line = line.replace(/[,;:]+$/u, '').trim();
    if (line.length < 2 || line.length > 200 || !/\p{L}/u.test(line) || isPlaceholder(line)) return null;
    // A street and house number is the start of an address, not a name.
    if (hasStreetNumber(line)) return null;
    // A line that is only an address is not a name.
    const addr = scoreAddress(line);
    if (addr !== null && addr.strength !== 'weak' && line.split(/[\s,]+/).length > 2 && /\d/.test(line)) return null;
    return clip(line, 200);
  }
  return null;
}

/** Evidence for a section. */
function sectionEvidence(section: Section, text: string, visibility: Visibility = section.visibility): Evidence {
  const unit = section.content[0] ?? section.labelUnit;
  return {
    source: unit.source ?? 'text',
    text: clip(squash(text), 300),
    selector: section.labelUnit.selector,
    field: unit.field ?? '',
    visibility,
    label: section.match.phrase.text,
    labelLanguage: section.match.phrase.lang,
    labelSource: section.match.phrase.source,
  };
}

const MODEL_WORDS = new Set([
  'model', 'model number', 'model no', 'model name', 'item model number', 'type designation', 'modell', 'modellnummer', 'typenbezeichnung', 'modèle', 'numéro de modèle', 'modelo', 'modello',
  'modelnummer', 'modelis', 'mudel', 'malli', 'mudell', 'samhail', 'модел', 'μοντέλο',
]);

/**
 * Add the details of a party (name, postal address, electronic address,
 * country) found in free text to a party builder. `labelled` is true when the
 * text came from a section labelled for this party. Pure apart from the builder.
 */
export function addPartyText(party: PartyBuilder, fullBody: string, evidence: (text: string) => Evidence, options: { readonly labelled: boolean; readonly links?: readonly { readonly href: string; readonly text: string }[]; readonly note?: string }): void {
  // Feed fields can be very long; party details are at the start. The cap also bounds every regular expression below.
  const body = fullBody.slice(0, MAX_PARTY_TEXT);
  const note = options.note === undefined ? {} : { note: options.note };
  const name = extractPartyName(body);
  if (name !== null) party.names.push({ value: name, strength: options.labelled ? 'strong' : 'medium', evidence: evidence(name), ...note });
  // Address: the body without the name, email and web lines.
  let addressText = lines(body)
    .map((l) => l.replace(NAME_PREFIX, '').replace(ADDRESS_PREFIX, ''))
    .filter((l) => !EMAIL_PREFIX.test(l) && !isEmail(l) && !/^(?:https?:\/\/|www\.)\S+$/i.test(l))
    .join(', ');
  if (name !== null && addressText.startsWith(name)) addressText = addressText.slice(name.length).replace(/^\s*(?:[,;|]|[-–—](?=\s))?\s*/u, '');
  // Contact details written inline after the address are not part of it.
  addressText = addressText
    .replace(/(?:e-?mail|tel\.?|phone|telefon|téléphone|teléfono)\s*[:：]?\s*$/iu, '')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}/gu, '')
    .replace(/\b(?:https?:\/\/|www\.)\S+/giu, '')
    .replace(/(?:\s*[,;|]\s*|\s+[-–—]\s*)+$/u, '')
    .replace(/(?:\s*,\s*){2,}/gu, ', ')
    .trim();
  const hit = scoreAddress(addressText);
  if (hit !== null) {
    party.postal.push({ value: clip(addressText, 300), strength: hit.strength, evidence: evidence(addressText), note: `Address signals: ${hit.signals.join(', ')}.` });
    if (hit.country !== undefined) party.countries.push(hit.country);
  }
  for (const email of findEmails(body).slice(0, 2)) party.electronic.push({ value: email, strength: 'strong', evidence: evidence(email), ...note });
  for (const link of options.links ?? []) {
    if (/^mailto:/i.test(link.href)) {
      const value = decodeMailto(link.href);
      if (value !== '') party.electronic.push({ value, strength: 'strong', evidence: evidence(link.text === '' ? value : `${link.text} (${value})`), ...note });
    } else if (party.electronic.length === 0 && isContactLink(link)) {
      party.electronic.push({
        value: link.href,
        strength: 'medium',
        evidence: evidence(`${link.text} (${link.href})`),
        note: 'A web link; the Regulation does not define "electronic address", so check that it lets people contact the party.',
      });
    }
  }
  const obfuscated = findObfuscatedEmail(body);
  if (obfuscated !== null && findEmails(body).length === 0) {
    party.electronic.push({ value: obfuscated, strength: 'medium', evidence: evidence(obfuscated), note: 'An email address written in a disguised form.' });
  }
  const web = findWebAddress(body);
  if (web !== null && party.electronic.length === 0) {
    party.electronic.push({
      value: web,
      strength: 'medium',
      evidence: evidence(web),
      note: 'A web address; the Regulation does not define "electronic address", so check that it lets people contact the party.',
    });
  }
}

/** Words that mark a contact link. Maintainers' list; non-English entries are translations. */
const CONTACT_WORDS =
  /contact|kontakt|contatt|contacto|contato|support|service|kundendienst|klantenservice|kundtj[äa]nst|kundeservice|asiakaspalvelu|help|hilfe|aide|ayuda|aiuto|(?:^|[^a-z])form(?:ular|ulaire|ulario)?(?:[^a-z]|$)|modulo|mail|reach|klient|ügyfél|zákazn/iu;

/**
 * True if a link in a party block can be an electronic address: a contact
 * page or form, or a link whose text is itself a web address. A link on the
 * name ("ACME" pointing to the shop's brand page) is not. Pure.
 */
export function isContactLink(link: { readonly href: string; readonly text: string }): boolean {
  if (CONTACT_WORDS.test(link.text) || CONTACT_WORDS.test(link.href)) return true;
  const text = link.text.trim();
  return /^(?:https?:\/\/|www\.)\S+$/iu.test(text) || /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}(?:\/\S*)?$/iu.test(text);
}

/** The address of a mailto: link, without query. Pure. */
export function decodeMailto(href: string): string {
  try {
    const raw = decodeURIComponent(href.replace(/^mailto:/i, '').split('?')[0] ?? '');
    return isEmail(raw) ? raw : '';
  } catch {
    return '';
  }
}

/** Identifier kind for a label phrase. */
function kindForLabel(label: string): IdentifierKind {
  const l = normalizeText(label);
  if (/gtin|ean|upc|barcode|code-barres|barkodas/.test(l)) return 'gtin';
  if (l === 'isbn') return 'isbn';
  if (/mpn|part number|herstellernummer/.test(l)) return 'mpn';
  // An ASIN is the marketplace's own product number: like a SKU, it may or may not identify the product elsewhere.
  if (l === 'sku' || l === 'asin') return 'sku';
  return identifierKindOf(l);
}

/**
 * Shop notices that sit under words such as "Warning", "Achtung" or
 * "Attenzione" but are not product warnings: stock levels, prices, delivery
 * offers and browser notices. Maintainers' list; non-English entries are
 * translations.
 */
const SHOP_NOTICE = new RegExp(
  [
    '\\b(?:only \\d+ left|left in stock|in stock|out of stock|low stock|sold out|nur noch \\d+|auf lager|ausverkauft|plus que \\d+|en stock|rupture de stock|solo \\d+ disponibili|disponibilit[àa] limitata|quedan \\d+|agotado|ostatnie \\d+|liko \\d+|nog \\d+ op voorraad)',
    '(?:free|gratis|gratuit\\w*|kostenlos\\w*|darmowa|nemokam\\w*|zdarma|fri)\\s+(?:shipping|delivery|returns|spedizion\\w*|versand|lieferung|livraison|env[ií]o|consegna|dostawa|pristatym\\w*|verzending|frakt|doprava)',
    '(?:shipping|delivery|spedizion\\w*|versand\\w*|livraison|env[ií]o|consegna|dostawa|pristatym\\w*|verzending|frakt|doprava)\\s+(?:is\\s+)?(?:free|gratis|gratuit\\w*|kostenlos\\w*|darmowa|nemokam\\w*|zdarma)',
    '\\b(?:orders?|ordini|bestellungen|commandes?|pedidos?|zamówienia)\\s+(?:over|above|from|superiori|ab|dès|à partir|desde|od)\\b',
    '[€£$]\\s?\\d|\\d\\s?(?:[€£$]|eur\\b|zł|kr\\b|kč)',
    '\\b(?:cookies?|javascript|your browser|ihr browser|votre navigateur)\\b',
  ].join('|'),
  'iu',
);

/** True if a text under a warning label is a shop notice (stock, price, delivery, browser), not product safety information. Pure. */
export function isShopNotice(text: string): boolean {
  return SHOP_NOTICE.test(text.slice(0, 500));
}

/** True if a section's text is only the text of links to documents (PDF files), not the information itself. Pure. */
export function onlyDocumentLinks(text: string, links: readonly { readonly href: string; readonly text: string }[]): boolean {
  const docs = links.filter((l) => /\.pdf(?:[?#]|$)/i.test(l.href) || /\bpdf\b/i.test(l.text));
  if (docs.length === 0) return false;
  let rest = text;
  for (const l of docs) rest = rest.split(squash(l.text)).join(' ');
  return rest.replace(/[\s()[\],.:;|·•-]+/gu, '').length < 12;
}

/** Delivery words. Maintainers' list; non-English entries are translations. */
const DELIVERY_WORD =
  /\b(?:deliver\w*|dispatch\w*|ships?|shipping|shipped|tracking|lieferung|lieferzeit|versand\w*|livraison|exp[ée]di\w*|consegna|spedizion\w*|spedito|env[ií]o|entrega|dostaw\w*|wysy[łl]k\w*|pristatym\w*|verzend\w*|levering|leverans|frakt|doprava|doru[čc]en\w*|kézbesítés|szállítás|livrare|доставка)/iu;
/** Delivery times ("within 24 hours", "in 2-3 days"). Maintainers' list. */
const DELIVERY_TIME =
  /\d+\s*(?:[-–]\s*\d+\s*)?(?:business\s+|working\s+)?(?:days?|hours?|h\b|werktage?n?|tage?n?|stunden|jours?|heures|giorni|ore\b|d[ií]as|horas|dni|godzin\w*|dien\w*|valand\w*|dagen|uur|dagar|timmar|dny|hodin\w*|nap|óra|zile|ore)|\b(?:within|innerhalb|sous|entro|en un plazo|w ciągu|per)\b/iu;

/**
 * True if a party block has contact details (an email address, or a postal
 * address of at least medium strength) and is not a delivery notice. Used for
 * labels that also name carriers ("Logistics provider: dispatch within 24
 * hours"). Pure.
 */
export function looksLikePartyDetails(body: string): boolean {
  const text = body.slice(0, MAX_PARTY_TEXT);
  if (isShopNotice(text) || (DELIVERY_WORD.test(text) && DELIVERY_TIME.test(text))) return false;
  if (findEmails(text).length > 0) return true;
  const address = scoreAddress(text);
  return address !== null && address.strength !== 'weak';
}

/** Candidate for an identifier value, with a GTIN check-digit test. Pure. */
export function identifierCandidate(value: string, kind: IdentifierKind, evidence: Evidence, labelled: boolean): IdentifierCandidate | null {
  const v = squash(value).slice(0, 100);
  if (!isPlausibleIdentifier(v) && !looksLikeGtin(v)) return null;
  if (kind === 'gtin' || (kind !== 'mpn' && kind !== 'sku' && looksLikeGtin(v))) {
    if (isValidGtin(v)) return { value: v, kind: 'gtin', strength: 'strong', evidence };
    if (kind === 'gtin') return { value: v, kind: 'gtin', strength: 'medium', evidence, note: 'The GTIN check digit is not valid.' };
  }
  // A SKU is often the shop's own code; it identifies the product only if it is used for it.
  if (kind === 'sku') return { value: v, kind, strength: 'medium', evidence, note: "A SKU (or a marketplace number such as an ASIN) can be the shop's own article number; check that it identifies the product." };
  const strength: Strength = labelled ? 'strong' : 'medium';
  return { value: v, kind, strength, evidence };
}

/** Add the candidates of the labelled sections to a builder. Pure apart from the builder. */
export function addSections(builder: FactsBuilder, sections: readonly Section[]): void {
  for (const s of sections) {
    const body = s.body;
    const ev = (text: string): Evidence => sectionEvidence(s, text);
    const links = s.content.flatMap((c) => c.links);
    switch (s.category) {
      case 'manufacturer':
        builder.manufacturer.sections.push(ev(body === '' ? s.match.phrase.text : body));
        addPartyText(builder.manufacturer, body, ev, { labelled: true, links });
        break;
      case 'responsible':
      case 'importer':
      case 'representative':
      case 'fulfilment': {
        // Logistics words also name carriers and delivery times; only a block with a party's contact details counts.
        if (s.category === 'fulfilment' && !looksLikePartyDetails(body)) break;
        builder.responsible.sections.push(ev(body === '' ? s.match.phrase.text : body));
        const note =
          s.category === 'importer'
            ? 'Labelled as importer. An importer can be the responsible person (Regulation (EU) 2019/1020 Art. 4(2)(b)).'
            : s.category === 'representative'
              ? 'Labelled as authorised representative. One with a written mandate can be the responsible person (Regulation (EU) 2019/1020 Art. 4(2)(c)).'
              : s.category === 'fulfilment'
                ? 'Labelled as fulfilment service provider. One established in the Union can be the responsible person where no manufacturer, importer or authorised representative is established there (Regulation (EU) 2019/1020 Art. 4(2)(d)).'
                : undefined;
        addPartyText(builder.responsible, body, ev, { labelled: true, links, ...(note === undefined ? {} : { note }) });
        break;
      }
      case 'brand': {
        const name = extractPartyName(body);
        if (name !== null) builder.brands.push({ value: name, strength: 'medium', evidence: ev(name) });
        break;
      }
      case 'seller': {
        const name = extractPartyName(body);
        if (name !== null) builder.sellers.push({ value: name, strength: 'medium', evidence: ev(name) });
        break;
      }
      case 'type': {
        const value = lines(body)[0] ?? '';
        if (value === '' || value.length > 120 || isPlaceholder(value) || !/[\p{L}\p{N}]/u.test(value)) break;
        const modelLabel = MODEL_WORDS.has(normalizeText(s.match.phrase.text));
        if (modelLabel || /\d/.test(value)) {
          builder.types.push({ value: clip(value, 120), strength: 'strong', evidence: ev(value) });
        } else {
          // "Type: Phone case" names a category more often than a type designation.
          builder.types.push({
            value: clip(value, 120),
            strength: 'weak',
            evidence: ev(value),
            note: 'Under a "Type" label without a model number this is often a product category; check that it is the type designation.',
          });
        }
        break;
      }
      case 'identifier': {
        const value = lines(body)[0] ?? '';
        if (value === '' || isPlaceholder(value)) break;
        const c = identifierCandidate(value, kindForLabel(s.match.phrase.text), ev(value), true);
        if (c !== null) builder.identifiers.push(c);
        break;
      }
      case 'safety': {
        const text = squash(body);
        if (text.length < 8 || isPlaceholder(text) || isShopNotice(text)) break;
        if (onlyDocumentLinks(text, links)) {
          builder.safety.push({
            value: clip(text, 300),
            strength: 'weak',
            evidence: ev(text),
            note: 'Only a link to a document was found. Check that the document has the warnings, and whether a link counts as indicating them clearly and visibly in the offer.',
          });
          break;
        }
        builder.safety.push({ value: clip(text, 300), strength: 'strong', evidence: ev(text) });
        break;
      }
      case 'stop':
        break;
    }
  }
}
