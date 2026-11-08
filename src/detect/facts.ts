// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The intermediate model: what was detected for one product, from a page or
 * a feed, before the rules in `evaluate.ts` turn it into statuses.
 */

import type { Country } from '../data/countries.js';
import type { ElementId, Evidence } from '../types.js';
import type { Strength } from './address.js';
import type { IdentifierKind } from './identifiers.js';

/** One detected value with its evidence. */
export interface Candidate {
  readonly value: string;
  readonly strength: Strength;
  readonly evidence: Evidence;
  /** Extra explanation shown with the result. */
  readonly note?: string;
}

/** A detected identifier. */
export interface IdentifierCandidate extends Candidate {
  readonly kind: IdentifierKind;
}

/** Facts about a party (manufacturer or responsible person). */
export interface PartyFacts {
  readonly names: readonly Candidate[];
  readonly postal: readonly Candidate[];
  readonly electronic: readonly Candidate[];
  /** Countries seen in this party's addresses. */
  readonly countries: readonly Country[];
  /** Labelled sections for this party, even when their values were incomplete. */
  readonly sections: readonly Evidence[];
}

/** How completely the source could be read. */
export interface Coverage {
  readonly kind: 'page' | 'feed';
  /** Reasons the source may hold information Safeshelf could not read. */
  readonly limitations: readonly string[];
  /** Feeds: elements that have a dedicated, mapped column (an empty one means "not filled in"). */
  readonly mappedElements: ReadonlySet<ElementId>;
}

/** Everything detected for one product. */
export interface ProductFacts {
  readonly productName: string;
  readonly manufacturer: PartyFacts;
  readonly responsible: PartyFacts;
  readonly brands: readonly Candidate[];
  readonly sellers: readonly Candidate[];
  readonly pictures: readonly Candidate[];
  readonly types: readonly Candidate[];
  readonly identifiers: readonly IdentifierCandidate[];
  readonly safety: readonly Candidate[];
  readonly coverage: Coverage;
  /** Feeds: explicit statement whether the manufacturer is established in the EU, from a mapped column. */
  readonly manufacturerInEu?: boolean;
}

/** An empty party. */
export const EMPTY_PARTY: PartyFacts = Object.freeze({ names: [], postal: [], electronic: [], countries: [], sections: [] });

/** Mutable builder used while collecting facts. */
export interface PartyBuilder {
  names: Candidate[];
  postal: Candidate[];
  electronic: Candidate[];
  countries: Country[];
  sections: Evidence[];
}

/** A new, empty party builder. */
export function partyBuilder(): PartyBuilder {
  return { names: [], postal: [], electronic: [], countries: [], sections: [] };
}
