// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * GitHub Action entry point. Inputs arrive as environment variables set by
 * action.yml (never interpolated into a shell script), are turned into an
 * argument array and passed to the CLI. Outputs are written to
 * $GITHUB_OUTPUT from the in-memory report of this run only; the job summary
 * contains counts and fixed element titles, never text from the scanned site
 * or the feed.
 */

import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { main, type CliIo } from '../cli/main.js';
import { ELEMENTS } from '../legal/elements.js';
import { ELEMENT_IDS } from '../types.js';
import type { SafeshelfReport } from '../report/types.js';

/** Map action inputs to CLI arguments. Pure. */
export function actionArgs(env: Readonly<Record<string, string | undefined>>): string[] {
  const get = (name: string): string => (env[name] ?? '').trim();
  const feed = get('SAFESHELF_FEED');
  const args: string[] = feed !== '' ? ['feed', feed] : ['scan'];
  if (feed === '') {
    const url = get('SAFESHELF_URL');
    const urls = get('SAFESHELF_URLS_FILE');
    if (url !== '') args.push(url);
    if (urls !== '') args.push('--urls', urls);
    if (get('SAFESHELF_SITEMAP') === 'true') args.push('--sitemap');
    if (get('SAFESHELF_IGNORE_ROBOTS') === 'true') args.push('--ignore-robots');
    for (const [flag, value] of [
      ['--max-pages', get('SAFESHELF_MAX_PAGES')],
      ['--max-products', get('SAFESHELF_MAX_PRODUCTS')],
      ['--max-duration', get('SAFESHELF_MAX_DURATION')],
    ] as const) {
      if (value !== '') args.push(flag, value);
    }
    for (const ip of get('SAFESHELF_ALLOW_ADDRESSES').split(/[\s,]+/).filter((v) => v !== '')) args.push('--allow-address', ip);
  } else {
    if (get('SAFESHELF_FEED_FORMAT') !== '') args.push('--format', get('SAFESHELF_FEED_FORMAT'));
    if (get('SAFESHELF_MAPPING') !== '') args.push('--mapping', get('SAFESHELF_MAPPING'));
  }
  for (const [flag, value] of [
    ['--out', get('SAFESHELF_OUT')],
    ['--report', get('SAFESHELF_REPORT')],
    ['--manufacturer-in-eu', get('SAFESHELF_MANUFACTURER_IN_EU')],
    ['--safety-languages', get('SAFESHELF_SAFETY_LANGUAGES')],
    ['--fail-on', get('SAFESHELF_FAIL_ON')],
  ] as const) {
    if (value !== '') args.push(flag, value);
  }
  if (get('SAFESHELF_MARKETPLACE') === 'true') args.push('--marketplace');
  if (get('SAFESHELF_REQUIRE_SAFETY_INFO') === 'true') args.push('--require-safety-info');
  return args;
}

/** A count as a plain non-negative integer string (anything else becomes "0"). Pure. */
function count(value: unknown): string {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? String(value) : '0';
}

/** Lines for $GITHUB_OUTPUT. Values are validated integers or the output path only. Pure. */
export function outputLines(report: Pick<SafeshelfReport, 'summary'>, outDir: string): string {
  // eslint-disable-next-line no-control-regex -- control characters must never reach $GITHUB_OUTPUT
  const safeDir = outDir.replace(/[\u0000-\u001f\u007f\u2028\u2029]/gu, '');
  return [
    `products=${count(report.summary.products)}`,
    `products-with-missing=${count(report.summary.productsWithMissing)}`,
    `products-with-review=${count(report.summary.productsWithReview)}`,
    `report-dir=${safeDir}`,
    '',
  ].join('\n');
}

/** Markdown job summary with counts and fixed element titles only. Pure. */
export function summaryMarkdown(report: Pick<SafeshelfReport, 'summary'>): string {
  const rows = ELEMENT_IDS.map((id) => {
    const c = (report.summary.byElement as Partial<SafeshelfReport['summary']['byElement']>)[id];
    return `| ${ELEMENTS[id].title} | ${count(c?.found)} | ${count(c?.['found-not-visible'])} | ${count(c?.['not-found'])} | ${count(c?.review)} | ${count(c?.['not-applicable'])} |`;
  }).join('\n');
  return [
    '## Safeshelf',
    '',
    `${count(report.summary.products)} product(s) checked: ${count(report.summary.productsWithMissing)} with information not found or not visible, ${count(report.summary.productsWithReview)} with items to review.`,
    '',
    '| Information | Found | Not visible | Not found | Review | Not applicable |',
    '| --- | --- | --- | --- | --- | --- |',
    rows,
    '',
    'GPSR Art. 19 information that Safeshelf could not find; see the HTML report for evidence. Not legal advice.',
    '',
  ].join('\n');
}

/**
 * Run the action. Returns the exit code.
 *
 * Outputs and the job summary are built from the report of this run, held in
 * memory. A `report.json` already present in the workspace (for example
 * committed in a pull request) is never read.
 */
export async function runAction(env: Readonly<Record<string, string | undefined>>, testing: Pick<CliIo, 'scanner' | 'scanOverrides'> = {}): Promise<number> {
  const args = actionArgs(env);
  let finished: { report: SafeshelfReport; outDir: string } | undefined;
  const code = await main(args, {
    ...testing,
    out: (line) => {
      process.stdout.write(`${line}\n`);
    },
    err: (line) => {
      process.stderr.write(`${line}\n`);
    },
    env,
    onReport: (report, outDir) => {
      finished = { report, outDir };
    },
  });
  if (finished === undefined) return code;
  if (env.GITHUB_OUTPUT !== undefined && env.GITHUB_OUTPUT !== '') await appendFile(env.GITHUB_OUTPUT, outputLines(finished.report, finished.outDir));
  if (env.GITHUB_STEP_SUMMARY !== undefined && env.GITHUB_STEP_SUMMARY !== '') await appendFile(env.GITHUB_STEP_SUMMARY, summaryMarkdown(finished.report));
  return code;
}

// Run only when executed directly as the action script (not when imported by tests).
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runAction(process.env);
}
