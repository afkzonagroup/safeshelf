// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The rules: turn detected facts into a status and confidence per element.
 * Pure functions; every rule is described in the README table "How it maps
 * to the law" and tested in test/unit/evaluate.test.ts.
 */

import type { Confidence, ElementId, ElementResult, EuEstablishment, Evidence, SalesContext, Status } from '../types.js';
import { ELEMENT_IDS } from '../types.js';
import type { Strength } from './address.js';
import type { Candidate, Coverage, PartyFacts, ProductFacts } from './facts.js';

/** Options for {@link evaluateFacts}. */
export interface EvaluateOptions {
  /** Shop's own offer (Art. 19) or marketplace listing (Art. 22(9)). Default `shop`. */
  readonly context?: SalesContext;
  /**
   * Whether the manufacturer is established in the EU. `auto` (default) uses
   * the country of the manufacturer's address when one is detected.
   */
  readonly manufacturerInEu?: EuEstablishment;
  /**
   * Languages (ISO 639-1) the Member States you sell to accept for warnings.
   * When given, warnings found only under a label in another language are
   * marked for review.
   */
  readonly safetyLanguages?: readonly string[];
  /**
   * Set when you know the products have warnings or safety information.
   * Missing warnings are then `not-found` instead of `review`.
   */
  readonly requireSafetyInformation?: boolean;
}

const VIS_RANK: Readonly<Record<Evidence['visibility'], number>> = { visible: 0, 'n/a': 0, collapsed: 1, hidden: 2 };
const STRENGTH_RANK: Readonly<Record<Strength, number>> = { strong: 0, medium: 1, weak: 2 };
const CONFIDENCE_OF: Readonly<Record<Strength, Confidence>> = { strong: 'high', medium: 'medium', weak: 'low' };

/** Candidates ordered best first: visible before collapsed before hidden, then by strength. Pure. */
export function rankCandidates(candidates: readonly Candidate[]): Candidate[] {
  return [...candidates].sort(
    (a, b) => VIS_RANK[a.evidence.visibility] - VIS_RANK[b.evidence.visibility] || STRENGTH_RANK[a.strength] - STRENGTH_RANK[b.strength],
  );
}

const MAX_EVIDENCE = 3;

function result(element: ElementId, status: Status, confidence: Confidence, explanation: string, evidence: readonly Evidence[]): ElementResult {
  return { element, status, confidence, explanation, evidence: evidence.slice(0, MAX_EVIDENCE) };
}

/** Confidence that something is absent, given how completely the source was read. Pure. */
export function absenceConfidence(element: ElementId, coverage: Coverage): Confidence {
  if (coverage.kind === 'feed') return coverage.mappedElements.has(element) ? 'high' : 'medium';
  return coverage.limitations.length > 0 ? 'low' : 'medium';
}

function absenceNote(coverage: Coverage, element: ElementId): string {
  if (coverage.kind === 'feed') {
    return coverage.mappedElements.has(element)
      ? 'The column for it is empty or holds a placeholder.'
      : 'No column holds it and it was not found in the other text fields. Map a column if your export has one.';
  }
  const base = 'It may still be on the page in a form Safeshelf cannot read, such as an image, a PDF, a frame, or a tab that loads on click.';
  return coverage.limitations.length > 0 ? `${base} Limits for this page: ${coverage.limitations.join('; ')}.` : base;
}

/** Standard status rules for one element from its candidates. Pure. */
export function judge(element: ElementId, candidates: readonly Candidate[], coverage: Coverage, what: string): ElementResult {
  const ranked = rankCandidates(candidates);
  const best = ranked[0];
  const evidence = ranked.map((c) => c.evidence);
  if (best === undefined) {
    return result(element, 'not-found', absenceConfidence(element, coverage), `Information not found: ${what}. ${absenceNote(coverage, element)}`, []);
  }
  const note = best.note === undefined ? '' : ` ${best.note}`;
  const vis = best.evidence.visibility;
  if (vis === 'hidden') {
    return result(
      element,
      'found-not-visible',
      best.strength === 'strong' ? 'medium' : 'low',
      `Found only in machine-readable data or hidden content, not in what a visitor sees: ${what}. Art. 19 asks the offer to indicate it clearly and visibly.${note}`,
      evidence,
    );
  }
  if (best.strength === 'weak') {
    return result(element, 'review', 'low', `Possible match, needs a person to check: ${what}.${note}`, evidence);
  }
  if (vis === 'collapsed') {
    return result(
      element,
      'found',
      best.strength === 'strong' ? 'medium' : 'low',
      `Found inside a collapsed section or tab: ${what}. Whether content shown after a click counts as "clearly and visibly" indicated is a judgement.${note}`,
      evidence,
    );
  }
  return result(element, 'found', CONFIDENCE_OF[best.strength], `Found: ${what}.${note}`, evidence);
}

type Establishment = { readonly state: 'eu' | 'non-eu' | 'unknown'; readonly reason: string };

/** Decide whether the responsible-person rule applies. Pure. */
export function establishment(facts: Pick<ProductFacts, 'manufacturer' | 'manufacturerInEu'>, setting: EuEstablishment): Establishment {
  if (setting === 'yes') return { state: 'eu', reason: 'You stated that the manufacturer is established in the EU.' };
  if (setting === 'no') return { state: 'non-eu', reason: 'You stated that the manufacturer is not established in the EU.' };
  if (facts.manufacturerInEu === true) return { state: 'eu', reason: 'The feed states that the manufacturer is established in the EU.' };
  if (facts.manufacturerInEu === false) return { state: 'non-eu', reason: 'The feed states that the manufacturer is not established in the EU.' };
  const regions = new Set(facts.manufacturer.countries.map((c) => c.region));
  const codes = [...new Set(facts.manufacturer.countries.map((c) => c.code))].join(', ');
  if (regions.size === 1 && regions.has('eu')) return { state: 'eu', reason: `The manufacturer's address appears to be in an EU Member State (${codes}).` };
  if (regions.size === 1 && regions.has('other')) return { state: 'non-eu', reason: `The manufacturer's address appears to be outside the EU (${codes}).` };
  if (regions.has('eea')) return { state: 'unknown', reason: `The manufacturer's address appears to be in ${codes}; Safeshelf does not assess EEA establishment.` };
  return { state: 'unknown', reason: 'Safeshelf could not tell where the manufacturer is established.' };
}

function responsibleResult(element: ElementId, candidates: readonly Candidate[], coverage: Coverage, est: Establishment, what: string): ElementResult {
  if (candidates.length > 0) return judge(element, candidates, coverage, what);
  if (est.state === 'eu') {
    return result(element, 'not-applicable', est.reason.startsWith('You stated') ? 'high' : 'medium', `Not needed if the manufacturer is established in the Union (Art. 19(b)). ${est.reason}`, []);
  }
  if (est.state === 'non-eu') {
    const r = judge(element, [], coverage, what);
    return { ...r, explanation: `${r.explanation} ${est.reason}` };
  }
  return result(
    element,
    'review',
    'low',
    `Information not found: ${what}. It is needed only where the manufacturer is not established in the Union (Art. 19(b)). ${est.reason}`,
    [],
  );
}

function manufacturerName(party: PartyFacts, brands: readonly Candidate[], sellers: readonly Candidate[], coverage: Coverage): ElementResult {
  const what = 'manufacturer name, registered trade name or registered trade mark';
  if (party.names.length > 0) return judge('manufacturer-name', party.names, coverage, what);
  if (brands.length > 0) {
    const best = rankCandidates(brands)[0];
    const r = judge('manufacturer-name', brands, coverage, `a brand ("${best?.value ?? ''}")`);
    if (r.status === 'not-found') return r;
    return {
      ...r,
      status: 'review',
      confidence: 'medium',
      explanation: `${r.explanation} No manufacturer was named. A brand can be the manufacturer's registered trade mark, which Art. 19(a) accepts, but Safeshelf cannot tell whether it is. The manufacturer's postal and electronic address are needed in any case.`,
    };
  }
  const r = judge('manufacturer-name', [], coverage, what);
  if (sellers.length > 0) {
    const s = rankCandidates(sellers)[0];
    return {
      ...r,
      explanation: `${r.explanation} Seller information was found ("${s?.value ?? ''}"); a seller is not necessarily the manufacturer.`,
      evidence: sellers.slice(0, 1).map((c) => c.evidence),
    };
  }
  return r;
}

function identifierResult(facts: ProductFacts, coverage: Coverage): ElementResult {
  const what = 'other product identifier (for example GTIN, MPN, SKU or article number)';
  const r = judge('product-identifier', facts.identifiers, coverage, what);
  const typeFound = facts.types.some((t) => t.strength !== 'weak');
  if (r.status !== 'not-found' || !typeFound) return r;
  return {
    ...r,
    status: 'review',
    confidence: 'low',
    explanation: `${r.explanation} The type was found. Art. 19(c) asks for "any other product identifier"; check whether the product has one, such as a GTIN or batch number.`,
  };
}

function safetyResult(facts: ProductFacts, options: EvaluateOptions): ElementResult {
  const what = 'warnings or safety information';
  const element = 'safety-information';
  if (facts.safety.length === 0) {
    if (options.requireSafetyInformation === true) return judge(element, [], facts.coverage, what);
    return result(
      element,
      'review',
      'low',
      `Information not found: ${what}. Art. 19(d) requires the warnings and safety information the product has under the GPSR or Union harmonisation legislation; if this product has none, nothing is missing. ${absenceNote(facts.coverage, element)}`,
      [],
    );
  }
  const r = judge(element, facts.safety, facts.coverage, what);
  const langs = options.safetyLanguages;
  if (langs !== undefined && langs.length > 0 && (r.status === 'found' || r.status === 'review')) {
    const labelled = facts.safety.filter((c) => c.evidence.labelLanguage !== undefined);
    const ok = labelled.some((c) => langs.includes(c.evidence.labelLanguage ?? ''));
    if (labelled.length > 0 && !ok) {
      const seen = [...new Set(labelled.map((c) => c.evidence.labelLanguage))].join(', ');
      return {
        ...r,
        status: 'review',
        confidence: 'medium',
        explanation: `${r.explanation} The section labels are in ${seen}, not in the languages you listed (${langs.join(', ')}). The language must be one the Member State where the product is sold accepts (Art. 19(d)). Safeshelf judges the label language only, not the text.`,
      };
    }
  }
  return r;
}

/**
 * Evaluate all elements for one product. Results are in element order.
 *
 * @example
 * ```ts
 * const results = evaluateFacts(facts, { context: 'shop', manufacturerInEu: 'auto' });
 * results.filter((r) => r.status === 'not-found');
 * ```
 */
export function evaluateFacts(facts: ProductFacts, options: EvaluateOptions = {}): ElementResult[] {
  const est = establishment(facts, options.manufacturerInEu ?? 'auto');
  const c = facts.coverage;
  const typeWhat = 'product type (model or type designation)';
  const out: Record<ElementId, ElementResult> = {
    'manufacturer-name': manufacturerName(facts.manufacturer, facts.brands, facts.sellers, c),
    'manufacturer-postal-address': judge('manufacturer-postal-address', facts.manufacturer.postal, c, 'manufacturer postal address'),
    'manufacturer-electronic-address': judge('manufacturer-electronic-address', facts.manufacturer.electronic, c, 'manufacturer electronic address'),
    'responsible-person-name': responsibleResult('responsible-person-name', facts.responsible.names, c, est, 'name of the responsible person in the EU'),
    'responsible-person-postal-address': responsibleResult('responsible-person-postal-address', facts.responsible.postal, c, est, 'postal address of the responsible person in the EU'),
    'responsible-person-electronic-address': responsibleResult('responsible-person-electronic-address', facts.responsible.electronic, c, est, 'electronic address of the responsible person in the EU'),
    'product-picture': judge('product-picture', facts.pictures, c, 'picture of the product'),
    'product-type': judge('product-type', facts.types, c, typeWhat),
    'product-identifier': identifierResult(facts, c),
    'safety-information': safetyResult(facts, options),
  };
  if (options.context === 'marketplace') {
    for (const id of ELEMENT_IDS) {
      const r = out[id];
      if (r.status === 'found' && r.evidence[0]?.visibility === 'collapsed') {
        out[id] = { ...r, explanation: `${r.explanation} For the marketplace, Art. 22(9) accepts information "displayed or otherwise made easily accessible" on the product listing; the trader's own duty under Art. 19 is to indicate it "clearly and visibly".` };
      }
    }
  }
  // Seller-only marketplace listings: say plainly that the trader's details are not the manufacturer's.
  if (options.context === 'marketplace' && out['manufacturer-name'].status === 'not-found' && facts.sellers.length > 0) {
    const r = out['manufacturer-name'];
    out['manufacturer-name'] = { ...r, explanation: `${r.explanation} On a marketplace the listing must show the manufacturer's details the trader provides (Art. 22(9)).` };
  }
  return ELEMENT_IDS.map((id) => out[id]);
}
