// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { readFile, stat } from 'node:fs/promises';
import { CsvError } from '../feeds/csv.js';
import { checkFeedFile } from '../feeds/check.js';
import { MAX_MAPPING_BYTES, MappingError, parseMapping, type ColumnMapping } from '../feeds/mapping.js';
import { FeedFormatError } from '../feeds/readers.js';
import { XmlError } from '../feeds/xml.js';
import { BlockedRequestError } from '../net/guard.js';
import { canonicalIp } from '../net/ip.js';
import { TOOL_VERSION, type SafeshelfReport } from '../report/types.js';
import { resolveOutputDir, writeReports } from '../report/write.js';
import { MAX_URL_LIST, scan, type ScanOptions } from '../scan.js';
import { parseArgs, USAGE, UsageError } from './args.js';

/** Where the CLI writes text. */
export interface CliIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Injected for tests; defaults to the real scanner. */
  readonly scanner?: typeof scan;
  /** Extra scan options for tests (for example a resolver). */
  readonly scanOverrides?: Partial<ScanOptions>;
  /** Called with the finished report and the output directory, after the report files are written. */
  readonly onReport?: (report: SafeshelfReport, outDir: string) => Promise<void> | void;
}

/** Replace control characters (terminal escape sequences, bidi controls) in text from scanned pages or files. Pure. */
export function safeLine(line: string): string {
  // eslint-disable-next-line no-control-regex -- removing control characters is the point
  return line.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069\u200b-\u200f\ufeff]/gu, '?');
}

/** Largest URL list file read, in bytes. */
export const MAX_URL_FILE_BYTES = 1024 * 1024;

async function readSmallFile(file: string, maxBytes: number, what: string): Promise<string> {
  const info = await stat(file);
  if (!info.isFile()) throw new UsageError(`${what} is not a regular file`);
  if (info.size > maxBytes) throw new UsageError(`${what} is larger than ${String(maxBytes)} bytes`);
  return await readFile(file, 'utf8');
}

/** URLs from a list file: one per line, blank lines and lines starting with # ignored. Pure. */
export function parseUrlList(text: string): string[] {
  const urls = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'));
  if (urls.length > MAX_URL_LIST) throw new UsageError(`The URL list has more than ${String(MAX_URL_LIST)} entries`);
  return urls;
}

function summaryLine(report: SafeshelfReport): string {
  const s = report.summary;
  return `${String(s.products)} product(s) checked: ${String(s.productsWithMissing)} with information not found or not visible, ${String(s.productsWithReview)} with items to review.`;
}

/**
 * Run the CLI. Returns the exit code: 0 success, 1 products at or above
 * --fail-on, 2 usage or runtime error. Never prints stack traces.
 */
export async function main(argv: readonly string[], rawIo: CliIo): Promise<number> {
  const io: CliIo = {
    ...rawIo,
    out: (line) => {
      rawIo.out(safeLine(line));
    },
    err: (line) => {
      rawIo.err(safeLine(line));
    },
  };
  try {
    const cmd = parseArgs(argv, io.env);
    if (cmd.kind === 'help') {
      io.out(USAGE);
      return 0;
    }
    if (cmd.kind === 'version') {
      io.out(TOOL_VERSION);
      return 0;
    }
    const outDir = resolveOutputDir(cmd.outDir);
    const evaluate = {
      context: cmd.context,
      manufacturerInEu: cmd.manufacturerInEu,
      safetyLanguages: cmd.safetyLanguages,
      requireSafetyInformation: cmd.requireSafetyInformation,
    };
    let report: SafeshelfReport;
    if (cmd.kind === 'feed') {
      let mapping: ColumnMapping | undefined;
      if (cmd.mappingFile !== undefined) mapping = parseMapping(await readSmallFile(cmd.mappingFile, MAX_MAPPING_BYTES, 'Mapping file'));
      report = await checkFeedFile(cmd.file, { format: cmd.format, ...evaluate, ...(mapping === undefined ? {} : { mapping }) });
    } else {
      for (const a of cmd.allowAddresses) {
        if (canonicalIp(a) === null) throw new UsageError(`--allow-address needs an IP address, got ${a.slice(0, 60)}`);
      }
      const urls = cmd.urlsFile === undefined ? undefined : parseUrlList(await readSmallFile(cmd.urlsFile, MAX_URL_FILE_BYTES, 'URL list'));
      const runScan = io.scanner ?? scan;
      report = await runScan({
        ...evaluate,
        ...(cmd.url === undefined ? {} : { url: cmd.url }),
        ...(urls === undefined ? {} : { urls }),
        sitemap: cmd.sitemap,
        outputDir: outDir,
        respectRobotsTxt: cmd.respectRobotsTxt,
        allowAddresses: cmd.allowAddresses,
        chromiumSandbox: cmd.sandbox,
        ...(cmd.maxPages === undefined ? {} : { maxPages: cmd.maxPages }),
        ...(cmd.maxProducts === undefined ? {} : { maxProducts: cmd.maxProducts }),
        ...(cmd.maxDurationSeconds === undefined ? {} : { maxDurationMs: cmd.maxDurationSeconds * 1000 }),
        ...(cmd.quiet ? {} : { onProgress: (m: string) => { io.err(m); } }),
        ...io.scanOverrides,
      });
    }
    const written = await writeReports(report, outDir, { json: cmd.reports.json, html: cmd.reports.html, csv: cmd.reports.csv, fixes: cmd.reports.csv });
    if (rawIo.onReport !== undefined) await rawIo.onReport(report, outDir);
    io.out(summaryLine(report));
    if (!cmd.quiet) {
      for (const p of report.products) {
        if (p.missing.length === 0 && p.review.length === 0) continue;
        const where = p.source.kind === 'page' ? p.source.url : `${p.source.keyColumn} ${p.source.key}`;
        io.out(`  ${p.id} ${p.name.slice(0, 80)} (${where.slice(0, 200)}): ${String(p.missing.length)} missing, ${String(p.review.length)} to review`);
      }
      for (const [label, file] of Object.entries(written)) io.out(`${label.toUpperCase()} report: ${file}`);
    }
    if (cmd.failOn === 'missing' && report.summary.productsWithMissing > 0) return 1;
    if (cmd.failOn === 'review' && (report.summary.productsWithMissing > 0 || report.summary.productsWithReview > 0)) return 1;
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(`Error: ${error.message}`);
      io.err('Run "safeshelf --help" for usage.');
    } else if (error instanceof BlockedRequestError) {
      io.err(`Refused: ${error.message}`);
    } else if (error instanceof MappingError || error instanceof CsvError || error instanceof XmlError || error instanceof FeedFormatError) {
      io.err(`Invalid input: ${error.message}`);
    } else if (error instanceof Error) {
      io.err(`Error: ${error.message.split('\n')[0] ?? 'unknown error'}`);
    } else {
      io.err('Error: unknown error');
    }
    return 2;
  }
}
