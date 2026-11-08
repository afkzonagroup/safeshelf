// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Core types shared by the page scanner, the feed checker and the reports.
 */

/** The pieces of information Safeshelf looks for, one per item of GPSR Art. 19. */
export type ElementId =
  | 'manufacturer-name'
  | 'manufacturer-postal-address'
  | 'manufacturer-electronic-address'
  | 'responsible-person-name'
  | 'responsible-person-postal-address'
  | 'responsible-person-electronic-address'
  | 'product-picture'
  | 'product-type'
  | 'product-identifier'
  | 'safety-information';

/** Every element id, in report order. */
export const ELEMENT_IDS: readonly ElementId[] = Object.freeze([
  'manufacturer-name',
  'manufacturer-postal-address',
  'manufacturer-electronic-address',
  'responsible-person-name',
  'responsible-person-postal-address',
  'responsible-person-electronic-address',
  'product-picture',
  'product-type',
  'product-identifier',
  'safety-information',
]);

/** True if `value` is an element id. */
export function isElementId(value: string): value is ElementId {
  return (ELEMENT_IDS as readonly string[]).includes(value);
}

/**
 * Outcome for one element of one product.
 *
 * - `found`: detected, and on a page detected in visible content.
 * - `found-not-visible`: on a page, detected only in machine-readable data
 *   (JSON-LD, meta tags) or in hidden content, not in what a visitor sees.
 * - `not-found`: no evidence detected. The information may still be there in a
 *   form Safeshelf cannot read (an image, a PDF, a tab loaded on click).
 * - `not-applicable`: the requirement appears not to apply (for example the
 *   responsible person when the manufacturer's address is in an EU Member State).
 * - `review`: a person has to decide (for example warnings are needed only for
 *   products that have them).
 */
export type Status = 'found' | 'found-not-visible' | 'not-found' | 'not-applicable' | 'review';

/** How strongly the evidence supports the status. Not a legal assessment. */
export type Confidence = 'high' | 'medium' | 'low';

/** Where a piece of evidence came from. */
export type EvidenceSource = 'json-ld' | 'microdata' | 'meta' | 'text' | 'image' | 'link' | 'feed';

/** Visibility of page evidence. Feed evidence is always `n/a`. */
export type Visibility = 'visible' | 'collapsed' | 'hidden' | 'n/a';

/** One piece of evidence. */
export interface Evidence {
  readonly source: EvidenceSource;
  /** Short text snippet (at most 300 characters). */
  readonly text: string;
  /** CSS selector of the element on the page, or empty. */
  readonly selector: string;
  /** Structured-data path or feed column, or empty. */
  readonly field: string;
  readonly visibility: Visibility;
  /** Label phrase that matched, when the evidence came from a labelled section. */
  readonly label?: string;
  /** Language code of the matched label (ISO 639-1, lower case). */
  readonly labelLanguage?: string;
  /** Where the label phrase comes from: the official text of Art. 19, the maintainers' English, or a translation that needs native review. */
  readonly labelSource?: PhraseSource;
  /** Relative path of a cropped screenshot (`screenshots/E0001.jpg`), when taken. */
  readonly screenshot?: string;
}

/** Result for one element of one product. */
export interface ElementResult {
  readonly element: ElementId;
  readonly status: Status;
  readonly confidence: Confidence;
  /** Plain explanation of why this status was given. */
  readonly explanation: string;
  readonly evidence: readonly Evidence[];
}

/**
 * Origin of a phrase in the data files.
 * - `official-text`: appears verbatim in that language version of GPSR Art. 19, or for the fulfilment service provider of its definition in Art. 3, point (12) (checked by a test).
 * - `original`: English written by the maintainers.
 * - `translation`: any other language not taken from an official text; needs native review.
 */
export type PhraseSource = 'official-text' | 'original' | 'translation';

/** A phrase with its language and origin. */
export interface SourcedPhrase {
  readonly text: string;
  readonly lang: string;
  readonly source: PhraseSource;
}

/** Whether the offer is a shop's own offer or a listing on an online marketplace (GPSR Art. 22(9)). */
export type SalesContext = 'shop' | 'marketplace';

/** What is known about where the manufacturer is established. */
export type EuEstablishment = 'yes' | 'no' | 'auto';
