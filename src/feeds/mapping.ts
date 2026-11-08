// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Column mapping for feeds: which column holds which piece of information.
 * Hand-written validation (schema/mapping.schema.json describes the same
 * shape for editors).
 */

/** Feed formats Safeshelf reads. */
export type FeedFormat = 'shopify' | 'woocommerce' | 'google-xml' | 'google-tsv' | 'generic';

/** All feed formats. */
export const FEED_FORMATS: readonly FeedFormat[] = Object.freeze(['shopify', 'woocommerce', 'google-xml', 'google-tsv', 'generic']);

/** What a column holds. */
export type FieldRole =
  | 'title'
  | 'url'
  | 'description'
  | 'manufacturerName'
  | 'manufacturerAddress'
  | 'manufacturerEmail'
  | 'manufacturerText'
  | 'manufacturerCountry'
  | 'manufacturerInEu'
  | 'responsibleName'
  | 'responsibleAddress'
  | 'responsibleEmail'
  | 'responsibleText'
  | 'brand'
  | 'seller'
  | 'image'
  | 'type'
  | 'gtin'
  | 'mpn'
  | 'sku'
  | 'identifier'
  | 'safety'
  | 'labelled';

/** Roles a mapping may set. */
export const FIELD_ROLES: readonly FieldRole[] = Object.freeze([
  'title',
  'url',
  'description',
  'manufacturerName',
  'manufacturerAddress',
  'manufacturerEmail',
  'manufacturerText',
  'manufacturerCountry',
  'manufacturerInEu',
  'responsibleName',
  'responsibleAddress',
  'responsibleEmail',
  'responsibleText',
  'brand',
  'seller',
  'image',
  'type',
  'gtin',
  'mpn',
  'sku',
  'identifier',
  'safety',
  'labelled',
]);

/** A validated column mapping. */
export interface ColumnMapping {
  /** Column that identifies a product (rows with the same key are one product). */
  readonly key?: string;
  /** Delimiter for generic CSV: ",", ";" or "\t". Detected when omitted. */
  readonly delimiter?: ',' | ';' | '\t';
  /** Columns per role. */
  readonly columns: Readonly<Partial<Record<FieldRole, readonly string[]>>>;
}

/** Thrown for an invalid mapping. */
export class MappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MappingError';
  }
}

const MAX_COLUMN_NAME = 300;
const MAX_COLUMNS_PER_ROLE = 20;

function columnName(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > MAX_COLUMN_NAME) {
    throw new MappingError(`${where} must be a non-empty column name of at most ${String(MAX_COLUMN_NAME)} characters`);
  }
  // eslint-disable-next-line no-control-regex -- control characters in column names are refused
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new MappingError(`${where} contains control characters`);
  return value.trim();
}

/**
 * Validate a mapping object (for example parsed from a JSON file). Unknown
 * keys are refused so typos are caught.
 *
 * @example
 * ```ts
 * validateMapping({ key: 'SKU', columns: { manufacturerName: 'Manufacturer', image: ['Image 1', 'Image 2'] } });
 * ```
 * @throws MappingError
 */
export function validateMapping(input: unknown): ColumnMapping {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new MappingError('Mapping must be a JSON object');
  const o = input as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (!['key', 'delimiter', 'columns', '$schema'].includes(k)) throw new MappingError(`Unknown mapping key "${k.slice(0, 40)}"`);
  }
  const out: { key?: string; delimiter?: ',' | ';' | '\t'; columns: Partial<Record<FieldRole, readonly string[]>> } = { columns: {} };
  if (o.key !== undefined) out.key = columnName(o.key, 'key');
  if (o.delimiter !== undefined) {
    if (o.delimiter !== ',' && o.delimiter !== ';' && o.delimiter !== '\t') throw new MappingError('delimiter must be ",", ";" or "\\t"');
    out.delimiter = o.delimiter;
  }
  if (o.columns !== undefined) {
    if (typeof o.columns !== 'object' || o.columns === null || Array.isArray(o.columns)) throw new MappingError('columns must be an object');
    for (const [role, value] of Object.entries(o.columns as Record<string, unknown>)) {
      if (!(FIELD_ROLES as readonly string[]).includes(role)) throw new MappingError(`Unknown role "${role.slice(0, 40)}" in columns`);
      const list = Array.isArray(value) ? value : [value];
      if (list.length === 0 || list.length > MAX_COLUMNS_PER_ROLE) throw new MappingError(`columns.${role} must list 1 to ${String(MAX_COLUMNS_PER_ROLE)} columns`);
      out.columns[role as FieldRole] = list.map((c, i) => columnName(c, `columns.${role}[${String(i)}]`));
    }
  }
  return out;
}

/** Maximum size of a mapping file in bytes. */
export const MAX_MAPPING_BYTES = 64 * 1024;

/** Parse and validate a mapping JSON text. @throws MappingError */
export function parseMapping(text: string): ColumnMapping {
  if (text.length > MAX_MAPPING_BYTES) throw new MappingError('Mapping file is larger than 64 KiB');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new MappingError('Mapping file is not valid JSON');
  }
  return validateMapping(value);
}

/**
 * Role for a column name that is not in the format's standard columns, by
 * keywords (English and some other languages). Used for Shopify metafields,
 * WooCommerce meta columns and generic CSVs without a mapping. Pure.
 */
export function classifyHeader(name: string): FieldRole | null {
  const n = name.toLowerCase();
  // "Manufacturer warranty", "Hersteller-Garantie", "manufacturer_url": about the party, but not its details.
  if (/warrant|guarant|garanti|gwarancj|price|preis|prix|logo|website|url|link/.test(n)) return null;
  const party = /responsible|eu[-_ ]?rep|verantwortlich|personne[-_ ]responsable|persona[-_ ]responsable|importer|importeur|importateur|importador|authori[sz]ed[-_ ]rep|fulfil{1,2}ment[-_ ]?(?:service[-_ ]?)?provider|fulfil{1,2}ment[-_ ]?dienstleister/.test(n)
    ? 'responsible'
    : /manufactur|hersteller|fabricant|fabricante|fabbricante|produttore|producent|gamintoj|valmistaj|tillverkar|fabrikant|výrobc|gyártó|producător|производител/.test(n)
      ? 'manufacturer'
      : null;
  if (party !== null) {
    if (/part[-_ ]?num|mpn/.test(n)) return 'mpn';
    if (/e-?mail|electronic|elektronisch|courriel|correo/.test(n)) return party === 'manufacturer' ? 'manufacturerEmail' : 'responsibleEmail';
    if (/address|adresse|anschrift|dirección|indirizzo|adres|street|postal/.test(n)) return party === 'manufacturer' ? 'manufacturerAddress' : 'responsibleAddress';
    if (/country|land|pays|país|paese|kraj|šalis/.test(n)) return party === 'manufacturer' ? 'manufacturerCountry' : null;
    if (/(?:^|[-_ .])name$|(?:^|[-_ .])name[-_ ]|firma|company/.test(n)) return party === 'manufacturer' ? 'manufacturerName' : 'responsibleName';
    return party === 'manufacturer' ? 'manufacturerText' : 'responsibleText';
  }
  if (/warning|safety|warnhinweis|sicherheit|avertissement|sécurité|advertencia|seguridad|avvertenz|sicurezza|ostrzeż|bezpieczeń|perspėjim|saugos/.test(n)) return 'safety';
  if (/gtin|ean|upc|barcode|isbn/.test(n)) return 'gtin';
  if (/(?:^|[^a-z])mpn(?:$|[^a-z])/.test(n)) return 'mpn';
  if (/(?:^|[^a-z])(?:model|modell|modèle|modelo|modello)(?:$|[^a-z])/.test(n)) return 'type';
  if (/(?:^|[^a-z])gpsr(?:$|[^a-z])/.test(n)) return 'labelled';
  return null;
}
