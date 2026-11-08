// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { ELEMENTS, provisionFor } from '../legal/elements.js';
import { PROVISIONS, type Provision, type ProvisionId } from '../legal/provisions.js';
import type { BlockedRequest } from '../net/proxy.js';
import type { FeedFormat, FieldRole } from '../feeds/mapping.js';
import { ELEMENT_IDS, type ElementId, type ElementResult, type EuEstablishment, type SalesContext, type Status } from '../types.js';

/** Version of the JSON report format (semver). Breaking changes bump the major. */
export const REPORT_SCHEMA_VERSION = '1.0.0';

/** Package version. Kept in sync with package.json by a test. */
export const TOOL_VERSION = '0.1.0';

/** Fixed disclaimer included in every report. */
export const DISCLAIMER =
  'Safeshelf checks whether it can find the information that Article 19 of the General Product Safety Regulation (EU) 2023/988 lists for distance sales, using automated heuristics. ' +
  '"Not found" means Safeshelf did not detect it; the information may be present in a form Safeshelf cannot read. ' +
  'Safeshelf does not assess whether a product is safe or whether an offer is lawful. It is not legal advice.';

/** Where a product result came from. */
export type ProductSource =
  | { readonly kind: 'page'; readonly url: string }
  | { readonly kind: 'feed'; readonly key: string; readonly keyColumn: string; readonly position: number };

/** Results for one product. */
export interface ProductResult {
  /** "P0001", unique in the report. */
  readonly id: string;
  readonly source: ProductSource;
  readonly name: string;
  readonly elements: readonly ElementResult[];
  /** Elements not found, or found only in non-visible data. */
  readonly missing: readonly ElementId[];
  /** Elements that need a person to decide. */
  readonly review: readonly ElementId[];
  readonly notes: readonly string[];
}

/** Outcome for one fetched page. */
export interface PageResult {
  readonly url: string;
  readonly status: 'product' | 'not-product' | 'skipped-robots' | 'not-html' | 'error';
  readonly httpStatus?: number;
  readonly error?: string;
  /** Why the page was or was not treated as a product page. */
  readonly reason?: string;
}

/** Limits a scan ran with. */
export interface ScanLimits {
  readonly maxPages: number;
  readonly maxProducts: number;
  readonly maxDurationMs: number;
  readonly navigationTimeoutMs: number;
  readonly maxResponseBytes: number;
  readonly maxTotalBytes: number;
  readonly maxRedirects: number;
  readonly respectRobotsTxt: boolean;
}

/** Options that affect the results. */
export interface ReportOptions {
  readonly context: SalesContext;
  readonly manufacturerInEu: EuEstablishment;
  readonly safetyLanguages: readonly string[];
  readonly requireSafetyInformation: boolean;
}

/** Counts for one element. */
export type StatusCounts = Readonly<Record<Status, number>>;

/** Summary of a report. */
export interface ReportSummary {
  readonly products: number;
  /** Products with at least one element not found or not visible. */
  readonly productsWithMissing: number;
  /** Products with at least one element for review. */
  readonly productsWithReview: number;
  readonly byElement: Readonly<Record<ElementId, StatusCounts>>;
}

/** The JSON report. */
export interface SafeshelfReport {
  readonly schemaVersion: string;
  readonly tool: { readonly name: 'safeshelf'; readonly version: string };
  readonly kind: 'scan' | 'feed';
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly input: {
    readonly startUrl?: string;
    readonly urlCount?: number;
    /** File name only (no directory). */
    readonly file?: string;
    readonly format?: FeedFormat;
    /** Feeds: the columns used for each role. */
    readonly columns?: Readonly<Partial<Record<FieldRole, readonly string[]>>>;
  };
  readonly options: ReportOptions;
  readonly products: readonly ProductResult[];
  readonly pages: readonly PageResult[];
  readonly summary: ReportSummary;
  /** Provisions the results refer to, with links to the official text. */
  readonly provisions: readonly Provision[];
  /** Requests refused by the network guard (scans only, capped). */
  readonly blockedRequests: readonly BlockedRequest[];
  readonly limits?: ScanLimits;
  readonly notes: readonly string[];
  readonly disclaimer: string;
}

/** Elements counted as missing. */
export const MISSING_STATUSES: ReadonlySet<Status> = new Set(['not-found', 'found-not-visible']);

/** Build a product result from element results. Pure. */
export function productResult(id: string, source: ProductSource, name: string, elements: readonly ElementResult[], notes: readonly string[] = []): ProductResult {
  return {
    id,
    source,
    name,
    elements,
    missing: elements.filter((e) => MISSING_STATUSES.has(e.status)).map((e) => e.element),
    review: elements.filter((e) => e.status === 'review').map((e) => e.element),
    notes,
  };
}

const zero = (): Record<Status, number> => ({ found: 0, 'found-not-visible': 0, 'not-found': 0, 'not-applicable': 0, review: 0 });

/** Summarise product results. Pure. */
export function summarize(products: readonly ProductResult[]): ReportSummary {
  const byElement = Object.fromEntries(ELEMENT_IDS.map((id) => [id, zero()])) as Record<ElementId, Record<Status, number>>;
  for (const p of products) for (const e of p.elements) byElement[e.element][e.status] += 1;
  return {
    products: products.length,
    productsWithMissing: products.filter((p) => p.missing.length > 0).length,
    productsWithReview: products.filter((p) => p.review.length > 0).length,
    byElement,
  };
}

/** Provisions referenced by a report, in catalogue order. Pure. */
export function referencedProvisions(context: SalesContext): Provision[] {
  const used = new Set<ProvisionId>(['gpsr-52', 'gpsr-4', 'gpsr-2-1']);
  for (const id of ELEMENT_IDS) {
    used.add(provisionFor(id, context));
    for (const r of ELEMENTS[id].related) used.add(r);
  }
  if (context === 'marketplace') for (const id of ELEMENT_IDS) used.add(ELEMENTS[id].provision);
  return Object.values(PROVISIONS).filter((p) => used.has(p.id));
}
