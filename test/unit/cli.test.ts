// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actionArgs, outputLines, runAction, summaryMarkdown } from '../../src/action/entrypoint.js';
import { parseArgs, USAGE, UsageError } from '../../src/cli/args.js';
import { main, parseUrlList, safeLine, type CliIo } from '../../src/cli/main.js';
import { checkFeed } from '../../src/feeds/check.js';
import type { SafeshelfReport } from '../../src/report/types.js';
import type { ScanOptions } from '../../src/scan.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FEEDS = path.join(ROOT, 'test/fixtures/feeds');
let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'safeshelf-cli-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function io(extra: Partial<CliIo> = {}): CliIo & { lines: string[]; errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  return { out: (l) => lines.push(l), err: (l) => errors.push(l), env: {}, lines, errors, ...extra };
}

describe('parseArgs', () => {
  it('parses scan and feed commands with defaults', () => {
    expect(parseArgs(['scan', 'https://shop.example'])).toMatchObject({ kind: 'scan', url: 'https://shop.example', sitemap: false, respectRobotsTxt: true, sandbox: true, outDir: 'safeshelf-report', context: 'shop', manufacturerInEu: 'auto', failOn: 'none' });
    expect(parseArgs(['feed', 'x.csv', '--format', 'woocommerce', '--mapping', 'm.json'])).toMatchObject({ kind: 'feed', file: 'x.csv', format: 'woocommerce', mappingFile: 'm.json' });
    expect(parseArgs(['scan', '--urls', 'list.txt', '--max-products', '5', '--marketplace', '--safety-languages', 'LT,en', '--report', 'json,csv', '--fail-on', 'missing'])).toMatchObject({
      urlsFile: 'list.txt',
      maxProducts: 5,
      context: 'marketplace',
      safetyLanguages: ['lt', 'en'],
      reports: { json: true, html: false, csv: true },
      failOn: 'missing',
    });
    expect(parseArgs([])).toEqual({ kind: 'help' });
    expect(parseArgs(['-v'])).toEqual({ kind: 'version' });
  });
  it('keeps the sandbox on unless --no-sandbox or SAFESHELF_NO_SANDBOX=1', () => {
    expect(parseArgs(['scan', 'https://a.example', '--no-sandbox'])).toMatchObject({ sandbox: false });
    expect(parseArgs(['scan', 'https://a.example'], { SAFESHELF_NO_SANDBOX: '1' })).toMatchObject({ sandbox: false });
    expect(parseArgs(['scan', 'https://a.example'], { SAFESHELF_NO_SANDBOX: 'true' })).toMatchObject({ sandbox: true });
  });
  it.each([
    [['scan'], /shop URL or --urls/],
    [['scan', 'a', 'b'], /Only one shop URL/],
    [['scan', 'a', '--urls', 'f'], /either/],
    [['scan', '--urls', 'f', '--sitemap'], /--sitemap works with a shop URL/],
    [['scan', 'a', '--format', 'shopify'], /feed option/],
    [['feed', 'x.csv'], /--format/],
    [['feed', 'x.csv', '--format', 'xlsx'], /--format must be/],
    [['feed', 'x.csv', '--format', 'shopify', '--sitemap'], /scan option/],
    [['scan', 'a', '--max-pages', '0'], /between 1 and 2000/],
    [['scan', 'a', '--max-pages', '1e3'], /whole number/],
    [['scan', 'a', '--safety-languages', 'xx'], /Unknown EU language/],
    [['scan', 'a', '--report', 'pdf'], /--report/],
    [['scan', 'a', '--out'], /needs a value/],
    [['scan', 'a', '--bogus'], /Unknown option/],
    [['delete'], /Unknown command/],
    [Array.from({ length: 201 }, () => 'x'), /Too many/],
  ])('rejects %j', (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(UsageError);
    expect(() => parseArgs(argv)).toThrow(message);
  });
});

describe('main', () => {
  it('prints help with the attribution and the version', async () => {
    const a = io();
    expect(await main(['--help'], a)).toBe(0);
    expect(a.lines[0]).toBe(USAGE);
    expect(USAGE).toContain('Safeshelf by AFKzona Group - https://afkzonagroup.lt');
    const b = io();
    expect(await main(['--version'], b)).toBe(0);
    expect(b.lines).toEqual(['0.1.0']);
  });

  it('checks a feed, writes the reports and sets the exit code from --fail-on', async () => {
    const out = path.join(dir, 'feed-out');
    const a = io();
    expect(await main(['feed', path.join(FEEDS, 'woocommerce.csv'), '--format', 'woocommerce', '--out', out, '--fail-on', 'missing'], a)).toBe(1);
    expect(a.lines[0]).toBe('5 product(s) checked: 3 with information not found or not visible, 4 with items to review.');
    expect(a.lines.some((l) => l.startsWith('FIXES report: '))).toBe(true);
    const report = JSON.parse(await readFile(path.join(out, 'report.json'), 'utf8')) as SafeshelfReport;
    expect(report.kind).toBe('feed');
    expect(await readFile(path.join(out, 'fixes.csv'), 'utf8')).toMatch(/^"ID",/);
    const b = io();
    expect(await main(['feed', path.join(FEEDS, 'woocommerce.csv'), '--format', 'woocommerce', '--out', out, '--quiet'], b)).toBe(0);
    expect(b.lines).toHaveLength(1);
  });

  it('uses a mapping file', async () => {
    const a = io();
    const code = await main(['feed', path.join(FEEDS, 'generic.csv'), '--format', 'generic', '--mapping', path.join(FEEDS, 'generic-mapping.json'), '--out', path.join(dir, 'g'), '--quiet'], a);
    expect(code).toBe(0);
    expect(a.lines[0]).toMatch(/^2 product\(s\) checked: 1 with information not found/);
  });

  it('reports invalid input on one line without a stack trace (exit 2)', async () => {
    const bad = path.join(dir, 'bad.csv');
    await writeFile(bad, 'ID,Name\n"1,x\n');
    const a = io();
    expect(await main(['feed', bad, '--format', 'woocommerce', '--out', path.join(dir, 'b')], a)).toBe(2);
    expect(a.errors).toEqual(['Invalid input: Unterminated quoted field (line 3)']);
    const m = path.join(dir, 'm.json');
    await writeFile(m, '{"columns":{"nope":"x"}}');
    const c = io();
    expect(await main(['feed', bad, '--format', 'generic', '--mapping', m], c)).toBe(2);
    expect(c.errors[0]).toMatch(/^Invalid input: Unknown role "nope"/);
    const d = io();
    expect(await main(['feed', path.join(dir, 'none.csv'), '--format', 'generic'], d)).toBe(2);
    expect(d.errors.join('\n')).not.toMatch(/\n\s+at /);
  });

  it('refuses a blocked start URL before starting a browser', async () => {
    const a = io();
    expect(await main(['scan', 'http://169.254.169.254/', '--out', path.join(dir, 'x')], a)).toBe(2);
    expect(a.errors[0]).toMatch(/^Refused: Address 169\.254\.169\.254 is not allowed \(metadata\)/);
    const b = io();
    expect(await main(['scan', 'file:///etc/passwd', '--out', path.join(dir, 'x')], b)).toBe(2);
    expect(b.errors[0]).toMatch(/^Refused: Scheme file:/);
  });

  it('passes options to the scanner and reads URL lists', async () => {
    let got: ScanOptions | undefined;
    const list = path.join(dir, 'urls.txt');
    await writeFile(list, '# products\nhttps://a.example/p/1\n\nhttps://a.example/p/2\n');
    const fake = (o: ScanOptions): Promise<SafeshelfReport> => {
      got = o;
      return Promise.resolve({ ...checkFeed('id\n1\n', { format: 'generic' }), kind: 'scan' as const });
    };
    const a = io({ scanner: fake });
    await main(['scan', '--urls', list, '--allow-address', '10.0.0.5', '--no-sandbox', '--manufacturer-in-eu', 'no', '--require-safety-info', '--out', path.join(dir, 's'), '--report', 'json'], a);
    expect(got).toMatchObject({ urls: ['https://a.example/p/1', 'https://a.example/p/2'], allowAddresses: ['10.0.0.5'], chromiumSandbox: false, manufacturerInEu: 'no', requireSafetyInformation: true });
    const b = io({ scanner: fake });
    expect(await main(['scan', 'https://a.example', '--allow-address', 'not-an-ip'], b)).toBe(2);
    expect(() => parseUrlList(Array.from({ length: 2001 }, (_v, i) => `https://a.example/${String(i)}`).join('\n'))).toThrow(/more than 2000/);
    // URL list and mapping files are size-checked before they are read.
    const huge = path.join(dir, 'huge.txt');
    await writeFile(huge, `${'#'.repeat(1024 * 1024)}\n`);
    const c = io({ scanner: fake });
    expect(await main(['scan', '--urls', huge, '--out', path.join(dir, 's2')], c)).toBe(2);
    expect(c.errors[0]).toMatch(/URL list is larger than 1048576 bytes/);
    const e = io({ scanner: fake });
    expect(await main(['scan', '--urls', dir, '--out', path.join(dir, 's3')], e)).toBe(2);
    expect(e.errors[0]).toMatch(/not a regular file/);
  });

  it('removes terminal control and bidi characters from every printed line', async () => {
    expect(safeLine('a\u001b[31mred\u0007\u202e\u2028b\u200b\u0085c')).toBe('a?[31mred???b??c');
    const fake = (): Promise<SafeshelfReport> => {
      const r = checkFeed('id,title\n1,"Evil \u001b]0;pwned\u0007 name"\n', { format: 'generic', mapping: { columns: { title: ['title'] } } });
      return Promise.resolve(r);
    };
    const a = io({ scanner: fake });
    await main(['scan', 'https://a.example', '--out', path.join(dir, 'esc')], a);
    // eslint-disable-next-line no-control-regex -- detecting control characters is the point
    for (const l of a.lines) expect(l).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u);
  });
});

describe('GitHub Action', () => {
  it('maps inputs to arguments without a shell', () => {
    expect(actionArgs({ SAFESHELF_URL: 'https://a.example', SAFESHELF_SITEMAP: 'true', SAFESHELF_MAX_PRODUCTS: '5', SAFESHELF_ALLOW_ADDRESSES: '10.0.0.5, 10.0.0.6', SAFESHELF_FAIL_ON: 'missing', SAFESHELF_MARKETPLACE: 'true' })).toEqual([
      'scan',
      'https://a.example',
      '--sitemap',
      '--max-products',
      '5',
      '--allow-address',
      '10.0.0.5',
      '--allow-address',
      '10.0.0.6',
      '--fail-on',
      'missing',
      '--marketplace',
    ]);
    expect(actionArgs({ SAFESHELF_FEED: 'export.csv', SAFESHELF_FEED_FORMAT: 'woocommerce', SAFESHELF_URL: 'ignored' })).toEqual(['feed', 'export.csv', '--format', 'woocommerce']);
    expect(actionArgs({ SAFESHELF_URL: '$(touch /tmp/x); `id`' })).toEqual(['scan', '$(touch /tmp/x); `id`']);
  });

  it('validates outputs and keeps the summary free of scanned text', () => {
    const report = { summary: { products: 2, productsWithMissing: '1\nreport-dir=/etc' as unknown as number, productsWithReview: -1, byElement: {} } } as unknown as SafeshelfReport;
    expect(outputLines(report, '/out\nevil=1')).toBe('products=2\nproducts-with-missing=0\nproducts-with-review=0\nreport-dir=/outevil=1\n');
    const md = summaryMarkdown(checkFeed('id,title\n1,"<img src=x onerror=alert(1)>"\n', { format: 'generic', mapping: { columns: { title: ['title'] } } }));
    expect(md).not.toContain('<img');
    expect(md).toContain('| Manufacturer name | 0 | 0 | 1 | 0 | 0 |');
  });

  it('writes outputs from the in-memory report only, never from a planted report.json', async () => {
    const work = path.join(dir, 'action');
    const out = path.join(work, 'safeshelf-report');
    const gh = path.join(dir, 'gh-output');
    await writeFile(gh, '');
    // A report.json committed in a pull request must not be read.
    await rm(out, { recursive: true, force: true });
    const { mkdir } = await import('node:fs/promises');
    await mkdir(out, { recursive: true });
    await writeFile(path.join(out, 'report.json'), JSON.stringify({ summary: { products: 999, productsWithMissing: '0\ninjected=1' } }));
    const code = await runAction({ SAFESHELF_FEED: path.join(FEEDS, 'google.xml'), SAFESHELF_FEED_FORMAT: 'google-xml', SAFESHELF_OUT: out, SAFESHELF_REPORT: 'html', GITHUB_OUTPUT: gh });
    expect(code).toBe(0);
    const lines = await readFile(gh, 'utf8');
    expect(lines).toContain('products=2\n');
    expect(lines).not.toContain('999');
    expect(lines).not.toContain('injected');
  });

  it('action.yml passes inputs through env only and keeps the sandbox on', () => {
    const yml = readFileSync(path.join(ROOT, 'action.yml'), 'utf8');
    const runs = yml.split('\n').filter((l) => /^\s+run: /.test(l) || /^\s{8}\S/.test(l));
    for (const l of runs) if (/run:/.test(l)) expect(l).not.toMatch(/\$\{\{\s*inputs\./);
    expect(yml).not.toMatch(/--no-sandbox|NO_SANDBOX/);
    expect(yml).toMatch(/if: inputs\.feed == '' && runner\.os == 'Linux' && runner\.environment == 'github-hosted'/);
    for (const uses of yml.match(/uses: \S+/g) ?? []) expect(uses).toMatch(/@[0-9a-f]{40}$/);
  });

  it('Dockerfile runs as a non-root user with a pinned base image', () => {
    const docker = readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
    expect(docker).toMatch(/^USER node$/m);
    expect(docker).toMatch(/node:22-bookworm-slim@sha256:[0-9a-f]{64}/);
    expect(docker).not.toMatch(/^USER root$/m);
  });
});
