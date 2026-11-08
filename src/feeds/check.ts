// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Check a product export offline. Nothing is fetched: image URLs and links in
 * the file are read as text only.
 */

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { evaluateFacts, type EvaluateOptions } from '../detect/evaluate.js';
import { DISCLAIMER, REPORT_SCHEMA_VERSION, TOOL_VERSION, productResult, referencedProvisions, summarize, type ProductResult, type SafeshelfReport } from '../report/types.js';
import { feedFacts, recordTitle } from './feed-facts.js';
import type { ColumnMapping, FeedFormat } from './mapping.js';
import { readGoogleXml, readTableFeed, type FeedRead } from './readers.js';

/** Options for {@link checkFeed}. */
export interface CheckFeedOptions extends EvaluateOptions {
  readonly format: FeedFormat;
  readonly mapping?: ColumnMapping;
  /** File name shown in the report (the directory is dropped). */
  readonly fileName?: string;
  /** Products to check, at most. Default 100 000. */
  readonly maxProducts?: number;
}

/** Largest feed file read, in bytes (100 MiB). */
export const MAX_FEED_BYTES = 100 * 1024 * 1024;

/** Read the records of a feed text in the given format. Pure. */
export function readFeed(text: string, format: FeedFormat, mapping?: ColumnMapping): FeedRead {
  return format === 'google-xml' ? readGoogleXml(text, mapping) : readTableFeed(text, format, mapping);
}

/**
 * Check feed text and return a report. Pure apart from the clock.
 *
 * @example
 * ```ts
 * const report = checkFeed(csvText, { format: 'woocommerce' });
 * console.log(report.summary.productsWithMissing);
 * ```
 */
export function checkFeed(text: string, options: CheckFeedOptions): SafeshelfReport {
  const startedAt = new Date().toISOString();
  const read = readFeed(text, options.format, options.mapping);
  const max = Math.max(1, Math.min(options.maxProducts ?? 100_000, 1_000_000));
  const notes = [...read.notes];
  if (read.records.length > max) notes.push(`The file has ${String(read.records.length)} products; only the first ${String(max)} were checked.`);
  if (options.format === 'shopify') notes.push('The Shopify "Type" column is a product category, so it is not used as the product type of Art. 19(c).');
  const products: ProductResult[] = read.records.slice(0, max).map((record, i) => {
    const facts = feedFacts(record, read.mappedRoles);
    const elements = evaluateFacts(facts, options);
    return productResult(`P${String(i + 1).padStart(4, '0')}`, { kind: 'feed', key: record.key, keyColumn: record.keyColumn, position: record.position }, recordTitle(record), elements);
  });
  const context = options.context ?? 'shop';
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    tool: { name: 'safeshelf', version: TOOL_VERSION },
    kind: 'feed',
    startedAt,
    finishedAt: new Date().toISOString(),
    input: { format: options.format, columns: read.roleColumns, ...(options.fileName === undefined ? {} : { file: path.basename(options.fileName) }) },
    options: {
      context,
      manufacturerInEu: options.manufacturerInEu ?? 'auto',
      safetyLanguages: [...(options.safetyLanguages ?? [])],
      requireSafetyInformation: options.requireSafetyInformation ?? false,
    },
    products,
    pages: [],
    summary: summarize(products),
    provisions: referencedProvisions(context),
    blockedRequests: [],
    notes: [...notes, 'A feed shows which data exists, not what the offer displays. Check the product pages as well.'],
    disclaimer: DISCLAIMER,
  };
}

/** Read a feed file (a regular file of at most 100 MiB) as UTF-8 text. */
export async function readFeedFile(file: string, maxBytes: number = MAX_FEED_BYTES): Promise<string> {
  const info = await stat(file);
  if (!info.isFile()) throw new Error('Feed path is not a regular file');
  if (info.size > maxBytes) throw new Error(`Feed file is larger than ${String(maxBytes)} bytes`);
  const data = await readFile(file);
  if (data.length > maxBytes) throw new Error(`Feed file is larger than ${String(maxBytes)} bytes`);
  return new TextDecoder('utf-8', { fatal: false }).decode(data);
}

/** Check a feed file. */
export async function checkFeedFile(file: string, options: Omit<CheckFeedOptions, 'fileName'>): Promise<SafeshelfReport> {
  return checkFeed(await readFeedFile(file), { ...options, fileName: file });
}
