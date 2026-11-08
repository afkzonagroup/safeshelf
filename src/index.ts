// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Safeshelf: checks online product offers and product feeds for the
 * information that Article 19 of the General Product Safety Regulation
 * (EU) 2023/988 lists for distance sales.
 *
 * @packageDocumentation
 */

export { scan, normaliseLimits, launchErrorMessage, isCrawlable, crawlKey, PRODUCT_PATH, MAX_URL_LIST, type ScanOptions } from './scan.js';
export { checkFeed, checkFeedFile, readFeed, readFeedFile, MAX_FEED_BYTES, type CheckFeedOptions } from './feeds/check.js';
export { validateMapping, parseMapping, classifyHeader, MappingError, FEED_FORMATS, FIELD_ROLES, type ColumnMapping, type FeedFormat, type FieldRole } from './feeds/mapping.js';
export { readTableFeed, readGoogleXml, FeedFormatError, type FeedRecord, type FeedField, type FeedRead } from './feeds/readers.js';
export { parseCsv, toCsv, csvField, neutralizeFormula, detectDelimiter, CsvError, type Table } from './feeds/csv.js';
export { parseXml, XmlError, type XmlElement } from './feeds/xml.js';
export { htmlToUnits } from './feeds/html-text.js';
export { feedFacts } from './feeds/feed-facts.js';
export { evaluateFacts, judge, establishment, rankCandidates, absenceConfidence, type EvaluateOptions } from './detect/evaluate.js';
export { pageFacts, pageProducts, type PageProducts } from './detect/page-facts.js';
export { findSections, labelOf, type Section, type TextUnit } from './detect/sections.js';
export { matchLabel, normalizeText, isPlaceholder, type LabelMatch } from './detect/text.js';
export { scoreAddress, findCountry, findEmails, findObfuscatedEmail, findWebAddress, type AddressHit, type Strength } from './detect/address.js';
export { isValidGtin, looksLikeGtin, type IdentifierKind } from './detect/identifiers.js';
export { extractPartyName } from './detect/interpret.js';
export { productsFromJsonLd, productsFromMicrodata, parseJsonLd, type StructuredProduct } from './detect/structured.js';
export type { ProductFacts, PartyFacts, Candidate, IdentifierCandidate, Coverage } from './detect/facts.js';
export { collectSitemapUrls, parseSitemap } from './crawl/sitemap.js';
export { writeReports, resolveOutputDir, type WriteReportsOptions, type WrittenReports } from './report/write.js';
export { renderHtmlReport, escapeHtml, safeHref, ATTRIBUTION } from './report/html.js';
export { missingCsv, fixesCsv } from './report/csv.js';
export {
  REPORT_SCHEMA_VERSION,
  TOOL_VERSION,
  DISCLAIMER,
  summarize,
  productResult,
  type SafeshelfReport,
  type ProductResult,
  type PageResult,
  type ReportSummary,
  type ScanLimits,
} from './report/types.js';
export { PROVISIONS, GPSR_URL, GPSR_OJ_URL, MSR_URL, type Provision, type ProvisionId } from './legal/provisions.js';
export { ELEMENTS, provisionFor, type ElementDefinition } from './legal/elements.js';
export { LABEL_PHRASES, EU_LANGUAGES, type LabelPhrase, type LabelCategory } from './data/labels.js';
export { COUNTRIES, type Country } from './data/countries.js';
export { classifyIp, parseIp, canonicalIp } from './net/ip.js';
export { checkUrlSyntax, resolveAndCheck, BlockedRequestError, type NetworkPolicy, type Resolver } from './net/guard.js';
export { ELEMENT_IDS, isElementId, type ElementId, type ElementResult, type Evidence, type Status, type Confidence, type SalesContext, type EuEstablishment, type PhraseSource, type SourcedPhrase } from './types.js';
