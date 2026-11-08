// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * CSV and TSV: an RFC 4180 reader with size caps, and a writer that guards
 * against formula injection. Pure functions.
 */

/** Limits for parsing. */
export interface CsvLimits {
  readonly maxRows: number;
  readonly maxColumns: number;
  readonly maxCellChars: number;
  /** Cells in the whole file. Rows of empty cells cost memory without holding data. */
  readonly maxCells: number;
}

/** Default limits: 200 000 rows, 1000 columns, 1 000 000 characters per cell, 30 000 000 cells. */
export const DEFAULT_CSV_LIMITS: CsvLimits = Object.freeze({ maxRows: 200_000, maxColumns: 1000, maxCellChars: 1_000_000, maxCells: 30_000_000 });

/** Parse error with a 1-based line number. */
export class CsvError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(`${message} (line ${String(line)})`);
    this.name = 'CsvError';
    this.line = line;
  }
}

/** A parsed table. */
export interface Table {
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
  /** 1-based line number where each data row starts. */
  readonly lines: readonly number[];
  readonly delimiter: string;
}

/**
 * Guess the delimiter from the first line: tab, semicolon or comma, whichever
 * occurs most outside quotes. Pure.
 */
export function detectDelimiter(text: string): string {
  const first = text.slice(0, 64 * 1024).split(/\r?\n/)[0] ?? '';
  const counts = new Map<string, number>([
    ['\t', 0],
    [';', 0],
    [',', 0],
  ]);
  let quoted = false;
  for (const ch of first) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && counts.has(ch)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  let best = ',';
  let max = 0;
  for (const [d, n] of counts) {
    if (n > max) {
      best = d;
      max = n;
    }
  }
  return best;
}

/**
 * Parse CSV text (RFC 4180: quoted fields, doubled quotes, CRLF or LF). A
 * leading byte order mark is removed. Empty lines are skipped.
 *
 * @throws CsvError on an unterminated quote, a quote inside an unquoted
 *   field, or when a limit is exceeded.
 */
export function parseCsv(text: string, delimiter: string = detectDelimiter(text), limits: CsvLimits = DEFAULT_CSV_LIMITS): Table {
  if (delimiter.length !== 1 || delimiter === '"' || delimiter === '\n' || delimiter === '\r') throw new CsvError('Invalid delimiter', 1);
  const src = text.startsWith('\ufeff') ? text.slice(1) : text;
  const records: string[][] = [];
  const lines: number[] = [];
  let record: string[] = [];
  let cell = '';
  let quoted = false;
  let wasQuoted = false;
  let line = 1;
  let recordLine = 1;
  let cells = 0;
  const pushCell = (): void => {
    if (record.length >= limits.maxColumns) throw new CsvError(`More than ${String(limits.maxColumns)} columns`, line);
    cells += 1;
    if (cells > limits.maxCells) throw new CsvError(`More than ${String(limits.maxCells)} cells`, line);
    record.push(cell);
    cell = '';
    wasQuoted = false;
  };
  const pushRecord = (): void => {
    pushCell();
    if (!(record.length === 1 && record[0] === '')) {
      if (records.length > limits.maxRows) throw new CsvError(`More than ${String(limits.maxRows)} rows`, line);
      records.push(record);
      lines.push(recordLine);
    }
    record = [];
  };
  for (let i = 0; i < src.length; i += 1) {
    const ch = src.charAt(i);
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        if (ch === '\n') line += 1;
        cell += ch;
      }
    } else if (ch === '"') {
      if (cell !== '' || wasQuoted) throw new CsvError('Quote inside an unquoted field', line);
      quoted = true;
      wasQuoted = true;
    } else if (ch === delimiter) {
      pushCell();
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      pushRecord();
      line += 1;
      recordLine = line;
    } else {
      if (wasQuoted) throw new CsvError('Text after a closing quote', line);
      cell += ch;
    }
    if (cell.length > limits.maxCellChars) throw new CsvError(`A cell is longer than ${String(limits.maxCellChars)} characters`, line);
  }
  if (quoted) throw new CsvError('Unterminated quoted field', line);
  if (cell !== '' || record.length > 0 || wasQuoted) pushRecord();
  const [header = [], ...rows] = records;
  const [, ...rowLines] = lines;
  return { header: header.map((h) => h.trim()), rows, lines: rowLines, delimiter };
}

/** Characters that make a spreadsheet treat a cell as a formula. */
const FORMULA_START = /^[=+\-@\t\r|%]/;

/**
 * Make a value safe to open in a spreadsheet: a value starting with = + - @
 * tab, carriage return, | or % gets a leading apostrophe, so Excel,
 * LibreOffice and Google Sheets show it as text instead of running it as a
 * formula (CSV injection). Plain numbers such as "-5" or "+3.2" are kept. Pure.
 *
 * @example
 * ```ts
 * neutralizeFormula('=HYPERLINK("http://x")'); // "'=HYPERLINK(\"http://x\")"
 * ```
 */
export function neutralizeFormula(value: string): string {
  if (!FORMULA_START.test(value)) return value;
  if (/^[+-]?\d+(?:[.,]\d+)?$/.test(value)) return value;
  return `'${value}`;
}

/** Quote one CSV field (always quoted, quotes doubled, formula-neutralised). Pure. */
export function csvField(value: string): string {
  return `"${neutralizeFormula(value).replace(/"/g, '""')}"`;
}

/** Serialise rows as CSV with CRLF line ends (RFC 4180). Every field is quoted and formula-neutralised. Pure. */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}
