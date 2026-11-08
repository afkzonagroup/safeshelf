// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The legal provisions Safeshelf refers to, with links to the official text.
 *
 * Quotes are copied verbatim from the English version on EUR-Lex; a test
 * checks each quote against a stored copy of the official text.
 *
 * - GPSR: Regulation (EU) 2023/988 on general product safety (OJ L 135,
 *   23.5.2023, p. 1). Applies from 13 December 2024 (Art. 52). Amended by
 *   Regulation (EU) 2024/2748: Art. 2(1)(b) also excludes the new Chapter IIa
 *   for harmonised products and Art. 3 gains point 29; Art. 4, 9, 11, 16, 19,
 *   21 and 22 are unchanged in the consolidated text of 29.05.2026.
 * - MSR: Regulation (EU) 2019/1020 on market surveillance and compliance of
 *   products, consolidated text of 12.08.2026.
 */

/** Ids of the provisions in the catalogue. */
export type ProvisionId =
  | 'gpsr-19-a'
  | 'gpsr-19-b'
  | 'gpsr-19-c'
  | 'gpsr-19-d'
  | 'gpsr-22-9-a'
  | 'gpsr-22-9-b'
  | 'gpsr-22-9-c'
  | 'gpsr-22-9-d'
  | 'gpsr-16-1'
  | 'gpsr-16-3'
  | 'gpsr-9-5'
  | 'gpsr-9-6'
  | 'gpsr-9-7'
  | 'gpsr-11-3'
  | 'gpsr-2-1'
  | 'gpsr-3'
  | 'gpsr-4'
  | 'gpsr-52'
  | 'msr-4-1'
  | 'msr-4-2'
  | 'msr-4-4';

/** One provision. */
export interface Provision {
  readonly id: ProvisionId;
  /** Short citation, for example "GPSR Art. 19(a)". */
  readonly citation: string;
  /** Link to the official text on EUR-Lex, with the article anchor. */
  readonly url: string;
  /** Verbatim English text of the provision or of the quoted part. */
  readonly quote: string;
  /** Plain explanation of how Safeshelf uses the provision. */
  readonly use: string;
}

/** Consolidated GPSR text of 29.05.2026 (documentation only; the Official Journal text is authentic). */
export const GPSR_URL = 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R0988-20260529';
/** GPSR as published in the Official Journal. */
export const GPSR_OJ_URL = 'https://eur-lex.europa.eu/eli/reg/2023/988/oj';
/** Consolidated Market Surveillance Regulation text of 12.08.2026. */
export const MSR_URL = 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02019R1020-20260812';

const gpsr = (article: number): string => `${GPSR_URL}#art_${String(article)}`;

const P = (p: Provision): Provision => Object.freeze(p);

/** The catalogue. */
export const PROVISIONS: Readonly<Record<ProvisionId, Provision>> = Object.freeze({
  'gpsr-19-a': P({
    id: 'gpsr-19-a',
    citation: 'GPSR Art. 19(a)',
    url: gpsr(19),
    quote:
      'name, registered trade name or registered trade mark of the manufacturer, as well as the postal and electronic address at which they can be contacted;',
    use: 'Distance-sales offers must clearly and visibly indicate the manufacturer and its postal and electronic address.',
  }),
  'gpsr-19-b': P({
    id: 'gpsr-19-b',
    citation: 'GPSR Art. 19(b)',
    url: gpsr(19),
    quote:
      'where the manufacturer is not established in the Union, the name, postal and electronic address of the responsible person within the meaning of Article 16(1) of this Regulation or Article 4(1) of Regulation (EU) 2019/1020;',
    use: 'Needed only where the manufacturer is not established in the Union.',
  }),
  'gpsr-19-c': P({
    id: 'gpsr-19-c',
    citation: 'GPSR Art. 19(c)',
    url: gpsr(19),
    quote: 'information allowing the identification of the product, including a picture of it, its type and any other product identifier; and',
    use: 'A picture, the type and any other product identifier.',
  }),
  'gpsr-19-d': P({
    id: 'gpsr-19-d',
    citation: 'GPSR Art. 19(d)',
    url: gpsr(19),
    quote:
      'any warning or safety information to be affixed to the product or to the packaging or included in an accompanying document in accordance with this Regulation or the applicable Union harmonisation legislation in a language which can be easily understood by consumers, as determined by the Member State in which the product is made available on the market.',
    use: 'Only warnings and safety information the product has under the GPSR or harmonisation legislation; the language is set by each Member State.',
  }),
  'gpsr-22-9-a': P({
    id: 'gpsr-22-9-a',
    citation: 'GPSR Art. 22(9)(a)',
    url: gpsr(22),
    quote: 'name, registered trade name or registered trade mark of the manufacturer, as well as the postal and electronic address at which the manufacturer can be contacted;',
    use: 'Online marketplaces must let traders provide this and display it, or make it easily accessible, on the product listing.',
  }),
  'gpsr-22-9-b': P({
    id: 'gpsr-22-9-b',
    citation: 'GPSR Art. 22(9)(b)',
    url: gpsr(22),
    quote:
      'where the manufacturer is not established in the Union, the name, postal and electronic address of the responsible person within the meaning of Article 16(1) of this Regulation or Article 4(1) of Regulation (EU) 2019/1020;',
    use: 'Marketplace counterpart of Art. 19(b).',
  }),
  'gpsr-22-9-c': P({
    id: 'gpsr-22-9-c',
    citation: 'GPSR Art. 22(9)(c)',
    url: gpsr(22),
    quote: 'information allowing the identification of the product, including a picture of it, its type and any other product identifier; and',
    use: 'Marketplace counterpart of Art. 19(c).',
  }),
  'gpsr-22-9-d': P({
    id: 'gpsr-22-9-d',
    citation: 'GPSR Art. 22(9)(d)',
    url: gpsr(22),
    quote:
      'any warning or safety information to be affixed on the product or to accompany it in accordance with this Regulation or the applicable Union harmonisation legislation in a language which can be easily understood by consumers as determined by the Member State in which the product is made available on the market.',
    use: 'Marketplace counterpart of Art. 19(d).',
  }),
  'gpsr-16-1': P({
    id: 'gpsr-16-1',
    citation: 'GPSR Art. 16(1)',
    url: gpsr(16),
    quote:
      'A product covered by this Regulation shall not be placed on the market unless there is an economic operator established in the Union who is responsible for the tasks set out in Article 4(3) of Regulation (EU) 2019/1020 in respect to that product.',
    use: 'Defines the responsible person referred to in Art. 19(b).',
  }),
  'gpsr-16-3': P({
    id: 'gpsr-16-3',
    citation: 'GPSR Art. 16(3)',
    url: gpsr(16),
    quote:
      'The name, registered trade name or registered trade mark, and contact details, including the postal and electronic address, of the economic operator referred to in paragraph 1 shall be indicated on the product or on its packaging, the parcel or an accompanying document.',
    use: 'The same details on the product itself; Safeshelf does not check physical products.',
  }),
  'gpsr-9-5': P({
    id: 'gpsr-9-5',
    citation: 'GPSR Art. 9(5)',
    url: gpsr(9),
    quote:
      'Manufacturers shall ensure that their products bear a type, batch or serial number or other element enabling the identification of the product and which is easily visible and legible for consumers',
    use: 'Identification on the product itself; context for Art. 19(c).',
  }),
  'gpsr-9-6': P({
    id: 'gpsr-9-6',
    citation: 'GPSR Art. 9(6)',
    url: gpsr(9),
    quote:
      'Manufacturers shall indicate their name, their registered trade name or registered trade mark, their postal and electronic address and, where different, the postal or electronic address of the single contact point at which they can be contacted.',
    use: 'Manufacturer details on the product itself; context for Art. 19(a).',
  }),
  'gpsr-9-7': P({
    id: 'gpsr-9-7',
    citation: 'GPSR Art. 9(7)',
    url: gpsr(9),
    quote:
      'Manufacturers shall ensure that their product is accompanied by clear instructions and safety information in a language which can be easily understood by consumers, as determined by the Member State in which the product is made available on the market.',
    use: 'Instructions and safety information with the product; context for Art. 19(d).',
  }),
  'gpsr-11-3': P({
    id: 'gpsr-11-3',
    citation: 'GPSR Art. 11(3)',
    url: gpsr(11),
    quote:
      'Importers shall indicate their name, their registered trade name or registered trade mark, their postal and electronic address and, where different, the postal or electronic address of the single contact point at which they can be contacted.',
    use: 'Importer details on the product itself. Art. 19 does not list the importer separately; an importer can be the responsible person (MSR Art. 4(2)(b)).',
  }),
  'gpsr-2-1': P({
    id: 'gpsr-2-1',
    citation: 'GPSR Art. 2(1)',
    url: gpsr(2),
    quote: 'This Regulation applies to products that are placed or made available on the market insofar as there are no specific provisions with the same objective under Union law which regulate the safety of the products concerned.',
    use: 'Scope. For products under Union harmonisation legislation, Art. 2(1)(b) excludes Chapter III Section 1 but not Section 2, so Art. 19 still applies to them, except where specific Union provisions with the same objective apply (first subparagraph).',
  }),
  'gpsr-3': P({
    id: 'gpsr-3',
    citation: 'GPSR Art. 3',
    url: gpsr(3),
    quote:
      '‘manufacturer’ means any natural or legal person who manufactures a product or has a product designed or manufactured, and markets that product under that person’s name or trademark;',
    use: 'Definitions of manufacturer, importer, distributor, economic operator and provider of an online marketplace (points 8, 10, 11, 13 and 14).',
  }),
  'gpsr-4': P({
    id: 'gpsr-4',
    citation: 'GPSR Art. 4',
    url: gpsr(4),
    quote:
      'Products offered for sale online or through other means of distance sales shall be deemed to be made available on the market if the offer is targeted at consumers in the Union.',
    use: 'Art. 19 concerns offers targeted at consumers in the Union.',
  }),
  'gpsr-52': P({
    id: 'gpsr-52',
    citation: 'GPSR Art. 52',
    url: gpsr(52),
    quote: 'It shall apply from 13 December 2024.',
    use: 'Date of application.',
  }),
  'msr-4-1': P({
    id: 'msr-4-1',
    citation: 'Regulation (EU) 2019/1020 Art. 4(1)',
    url: `${MSR_URL}#art_4`,
    quote:
      'Notwithstanding any obligations set out in applicable Union harmonisation legislation, a product subject to legislation referred to in paragraph 5 may be placed on the market only if there is an economic operator established in the Union who is responsible for the tasks set out in paragraph 3 in respect of that product.',
    use: 'The responsible person for products under the harmonisation legislation listed in Art. 4(5); referred to in GPSR Art. 19(b).',
  }),
  'msr-4-2': P({
    id: 'msr-4-2',
    citation: 'Regulation (EU) 2019/1020 Art. 4(2)',
    url: `${MSR_URL}#art_4`,
    quote: 'For the purposes of this Article, the economic operator referred to in paragraph 1 means any of the following:',
    use: 'The responsible person is a manufacturer established in the Union, an importer, an authorised representative or a fulfilment service provider; applied to GPSR products by GPSR Art. 16(1).',
  }),
  'msr-4-4': P({
    id: 'msr-4-4',
    citation: 'Regulation (EU) 2019/1020 Art. 4(4)',
    url: `${MSR_URL}#art_4`,
    quote:
      'the name, registered trade name or registered trade mark, and contact details, including the postal address, of the economic operator referred to in paragraph 1 shall be indicated on the product or on its packaging, the parcel or an accompanying document.',
    use: 'Responsible-person details on the product itself; context only.',
  }),
});

/** True if `id` names a catalogued provision. */
export function isProvisionId(id: string): id is ProvisionId {
  return Object.hasOwn(PROVISIONS, id);
}
