// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import path from 'node:path';
import { ensureDir, safeWriteFile } from '../util/files.js';
import { fixesCsv, missingCsv } from './csv.js';
import { renderHtmlReport } from './html.js';
import type { SafeshelfReport } from './types.js';

/** Which files to write. */
export interface WriteReportsOptions {
  readonly json?: boolean;
  readonly html?: boolean;
  /** `missing.csv`: products with information not found. */
  readonly csv?: boolean;
  /** `fixes.csv`: fill-in file for re-import (feed reports only). */
  readonly fixes?: boolean;
}

/** Paths written. */
export interface WrittenReports {
  readonly json?: string;
  readonly html?: string;
  readonly csv?: string;
  readonly fixes?: string;
}

/**
 * Write `report.json`, `report.html`, `missing.csv` and (for feeds)
 * `fixes.csv` into `dir`. The directory is created with mode 0700; files are
 * written with mode 0600 and never through a symlink. Screenshots referenced
 * by the report are read from `dir/screenshots` and embedded in the HTML.
 */
export async function writeReports(report: SafeshelfReport, dir: string, options: WriteReportsOptions = {}): Promise<WrittenReports> {
  const real = await ensureDir(dir);
  const out: { json?: string; html?: string; csv?: string; fixes?: string } = {};
  if (options.json !== false) out.json = await safeWriteFile(real, 'report.json', `${JSON.stringify(report, null, 2)}\n`);
  if (options.html !== false) out.html = await safeWriteFile(real, 'report.html', await renderHtmlReport(report, { baseDir: real }));
  if (options.csv !== false) out.csv = await safeWriteFile(real, 'missing.csv', missingCsv(report));
  if (options.fixes !== false && report.kind === 'feed') out.fixes = await safeWriteFile(real, 'fixes.csv', fixesCsv(report));
  return out;
}

/** Resolve a user-supplied output directory against the working directory. */
export function resolveOutputDir(dir: string, cwd: string = process.cwd()): string {
  return path.resolve(cwd, dir);
}
