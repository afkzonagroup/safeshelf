// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { EU_LANGUAGES } from '../data/labels.js';
import { FEED_FORMATS, type FeedFormat } from '../feeds/mapping.js';
import type { EuEstablishment, SalesContext } from '../types.js';

/** Which reports to write. */
export interface ReportSelection {
  readonly json: boolean;
  readonly html: boolean;
  readonly csv: boolean;
}

/** Options shared by scan and feed. */
interface Common {
  readonly outDir: string;
  readonly reports: ReportSelection;
  readonly context: SalesContext;
  readonly manufacturerInEu: EuEstablishment;
  readonly safetyLanguages: readonly string[];
  readonly requireSafetyInformation: boolean;
  readonly failOn: 'missing' | 'review' | 'none';
  readonly quiet: boolean;
}

/** Parsed command line. */
export type Command =
  | { readonly kind: 'help' }
  | { readonly kind: 'version' }
  | (Common & {
      readonly kind: 'scan';
      readonly url?: string;
      readonly urlsFile?: string;
      readonly sitemap: boolean;
      readonly maxPages?: number;
      readonly maxProducts?: number;
      readonly maxDurationSeconds?: number;
      readonly respectRobotsTxt: boolean;
      readonly allowAddresses: readonly string[];
      readonly sandbox: boolean;
    })
  | (Common & {
      readonly kind: 'feed';
      readonly file: string;
      readonly format: FeedFormat;
      readonly mappingFile?: string;
    });

/** Usage error (exit code 2). */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export const USAGE = `Usage:
  safeshelf scan <shop-url> [options]          Crawl a shop and check its product pages
  safeshelf scan --urls <file> [options]       Check the product pages listed in a file (one URL per line)
  safeshelf feed <file> --format <f> [options] Check a product export offline
  safeshelf --help | --version

Scan options:
  --sitemap                 Also read the shop's sitemaps to find product pages
  --max-pages <n>           Pages to load (default 50, max 2000)
  --max-products <n>        Product pages to check (default 50, max 2000)
  --max-duration <s>        Time budget in seconds (default 600, max 3600)
  --ignore-robots           Do not read robots.txt
  --allow-address <ip>      Allow one private IP (your own staging server); repeatable
  --no-sandbox              Run Chromium without its OS sandbox (containers only)

Feed options:
  --format <f>              shopify, woocommerce, google-xml, google-tsv or generic
  --mapping <file>          JSON column mapping (see schema/mapping.schema.json)

Common options:
  --out <dir>               Output directory (default ./safeshelf-report)
  --report <list>           Any of json,html,csv (default all three)
  --marketplace             The offers are listings on an online marketplace (Art. 22(9))
  --manufacturer-in-eu <v>  yes, no or auto (default auto: from the manufacturer's address)
  --safety-languages <list> Languages accepted for warnings, for example lt,en
  --require-safety-info     The products have warnings; report them as missing when not found
  --fail-on <level>         Exit 1 if any product has information "missing" or "review" (default none)
  --quiet                   Print only the summary line

Safeshelf reports information it could not find. It does not decide whether
a product is safe or an offer is lawful, and it is not legal advice.

Safeshelf by AFKzona Group - https://afkzonagroup.lt
Licensed under AGPL-3.0-only with additional terms; see LICENSE and LICENSE-ADDITIONAL-TERMS.md.`;

function intArg(name: string, value: string | undefined, min: number, max: number): number {
  if (value === undefined || !/^\d{1,7}$/.test(value)) throw new UsageError(`${name} needs a whole number`);
  const n = Number(value);
  if (n < min || n > max) throw new UsageError(`${name} must be between ${String(min)} and ${String(max)}`);
  return n;
}

function list(value: string): string[] {
  return value
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v !== '');
}

/** Parse argv (without node and script). Pure. */
export function parseArgs(argv: readonly string[], env: Readonly<Record<string, string | undefined>> = {}): Command {
  if (argv.length > 200) throw new UsageError('Too many arguments');
  const [cmd, ...rest] = argv;
  if (cmd === undefined || cmd === '--help' || cmd === '-h' || cmd === 'help') return { kind: 'help' };
  if (cmd === '--version' || cmd === '-v') return { kind: 'version' };
  if (cmd !== 'scan' && cmd !== 'feed') throw new UsageError(`Unknown command: ${cmd.slice(0, 40)}`);

  let positional: string | undefined;
  let urlsFile: string | undefined;
  let sitemap = false;
  let maxPages: number | undefined;
  let maxProducts: number | undefined;
  let maxDurationSeconds: number | undefined;
  let respectRobotsTxt = true;
  const allowAddresses: string[] = [];
  let sandbox = env.SAFESHELF_NO_SANDBOX !== '1';
  let format: FeedFormat | undefined;
  let mappingFile: string | undefined;
  let outDir = 'safeshelf-report';
  let reports: ReportSelection = { json: true, html: true, csv: true };
  let context: SalesContext = 'shop';
  let manufacturerInEu: EuEstablishment = 'auto';
  let safetyLanguages: string[] = [];
  let requireSafetyInformation = false;
  let failOn: 'missing' | 'review' | 'none' = 'none';
  let quiet = false;
  const scanOnly = new Set(['--urls', '--sitemap', '--max-pages', '--max-products', '--max-duration', '--ignore-robots', '--allow-address', '--no-sandbox']);
  const feedOnly = new Set(['--format', '--mapping']);

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i] ?? '';
    const next = (): string => {
      const value = rest[i + 1];
      if (value === undefined || value.startsWith('--')) throw new UsageError(`${arg} needs a value`);
      i += 1;
      return value;
    };
    if (cmd === 'feed' && scanOnly.has(arg)) throw new UsageError(`${arg} is a scan option`);
    if (cmd === 'scan' && feedOnly.has(arg)) throw new UsageError(`${arg} is a feed option`);
    switch (arg) {
      case '--urls':
        urlsFile = next();
        break;
      case '--sitemap':
        sitemap = true;
        break;
      case '--max-pages':
        maxPages = intArg(arg, next(), 1, 2000);
        break;
      case '--max-products':
        maxProducts = intArg(arg, next(), 1, 2000);
        break;
      case '--max-duration':
        maxDurationSeconds = intArg(arg, next(), 5, 3600);
        break;
      case '--ignore-robots':
        respectRobotsTxt = false;
        break;
      case '--allow-address':
        if (allowAddresses.length >= 20) throw new UsageError('At most 20 --allow-address values');
        allowAddresses.push(next());
        break;
      case '--no-sandbox':
        sandbox = false;
        break;
      case '--format': {
        const f = next();
        if (!(FEED_FORMATS as readonly string[]).includes(f)) throw new UsageError(`--format must be one of ${FEED_FORMATS.join(', ')}`);
        format = f as FeedFormat;
        break;
      }
      case '--mapping':
        mappingFile = next();
        break;
      case '--out':
        outDir = next();
        break;
      case '--report': {
        const r = list(next());
        if (r.length === 0 || r.some((x) => x !== 'json' && x !== 'html' && x !== 'csv')) throw new UsageError('--report takes json, html and/or csv');
        reports = { json: r.includes('json'), html: r.includes('html'), csv: r.includes('csv') };
        break;
      }
      case '--marketplace':
        context = 'marketplace';
        break;
      case '--manufacturer-in-eu': {
        const v = next();
        if (v !== 'yes' && v !== 'no' && v !== 'auto') throw new UsageError('--manufacturer-in-eu must be yes, no or auto');
        manufacturerInEu = v;
        break;
      }
      case '--safety-languages': {
        const langs = list(next());
        for (const l of langs) if (!EU_LANGUAGES.includes(l)) throw new UsageError(`Unknown EU language code: ${l.slice(0, 10)}`);
        safetyLanguages = langs;
        break;
      }
      case '--require-safety-info':
        requireSafetyInformation = true;
        break;
      case '--fail-on': {
        const v = next();
        if (v !== 'missing' && v !== 'review' && v !== 'none') throw new UsageError('--fail-on must be missing, review or none');
        failOn = v;
        break;
      }
      case '--quiet':
        quiet = true;
        break;
      default:
        if (arg.startsWith('-')) throw new UsageError(`Unknown option: ${arg.slice(0, 40)}`);
        if (positional !== undefined) throw new UsageError(cmd === 'scan' ? 'Only one shop URL may be given' : 'Only one file may be given');
        positional = arg;
    }
  }
  const common: Common = { outDir, reports, context, manufacturerInEu, safetyLanguages, requireSafetyInformation, failOn, quiet };
  if (cmd === 'feed') {
    if (positional === undefined) throw new UsageError('feed needs a file');
    if (format === undefined) throw new UsageError('feed needs --format');
    return { kind: 'feed', ...common, file: positional, format, ...(mappingFile === undefined ? {} : { mappingFile }) };
  }
  if ((positional === undefined) === (urlsFile === undefined)) throw new UsageError('scan needs either a shop URL or --urls <file>');
  if (urlsFile !== undefined && sitemap) throw new UsageError('--sitemap works with a shop URL, not with --urls');
  return {
    kind: 'scan',
    ...common,
    sitemap,
    respectRobotsTxt,
    allowAddresses,
    sandbox,
    ...(positional === undefined ? {} : { url: positional }),
    ...(urlsFile === undefined ? {} : { urlsFile }),
    ...(maxPages === undefined ? {} : { maxPages }),
    ...(maxProducts === undefined ? {} : { maxProducts }),
    ...(maxDurationSeconds === undefined ? {} : { maxDurationSeconds }),
  };
}
