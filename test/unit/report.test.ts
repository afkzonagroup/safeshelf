// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { createHash } from 'node:crypto';
import { link, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkFeed } from '../../src/feeds/check.js';
import { ATTRIBUTION, IMAGE_LIMITS, escapeHtml, renderHtmlReport, safeHref } from '../../src/report/html.js';
import { DISCLAIMER, summarize, type SafeshelfReport } from '../../src/report/types.js';
import { writeReports } from '../../src/report/write.js';
import { ensureSubdir, isSafeFileName, safeWriteFile } from '../../src/util/files.js';
import { validate } from '../helpers/jsonschema.js';

const schema = JSON.parse(readFileSync(new URL('../../schema/report.schema.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const fixture = (name: string): string => readFileSync(new URL(`../fixtures/feeds/${name}`, import.meta.url), 'utf8');

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'safeshelf-report-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const base = (): SafeshelfReport => checkFeed(fixture('woocommerce.csv'), { format: 'woocommerce', fileName: 'export.csv' });

/** A report as it might come from a hostile JSON file. */
function hostile(): SafeshelfReport {
  const r = base();
  const x = '<script>alert(1)</script><img src=x onerror=alert(2)>"\'`';
  const product = r.products[0];
  if (product === undefined) throw new Error('fixture');
  return {
    ...r,
    finishedAt: x,
    schemaVersion: x,
    input: { startUrl: 'javascript:alert(1)', file: x },
    notes: [x],
    summary: { ...r.summary, products: '<meta http-equiv="refresh" content="0;url=https://evil.example">' as unknown as number },
    pages: [{ url: x, status: 'error', error: x, httpStatus: '<b>' as unknown as number }],
    provisions: [{ id: 'gpsr-19-a', citation: x, url: 'javascript:alert(1)', quote: x, use: x }],
    products: [
      {
        ...product,
        name: x,
        id: x,
        source: { kind: 'page', url: 'javascript:alert(3)' },
        notes: [x],
        elements: product.elements.map((e) => ({
          ...e,
          explanation: x,
          confidence: x as never,
          status: x as never,
          evidence: [{ source: 'text', text: x, selector: x, field: x, visibility: 'visible', label: x, screenshot: '../../etc/passwd' }],
        })),
      },
    ],
  };
}

describe('HTML report', () => {
  it('escapes every value from an untrusted report, including numbers', async () => {
    const html = await renderHtmlReport(hostile());
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img src=x/i);
    expect(html).not.toMatch(/<meta http-equiv="refresh"/i);
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('does not throw on missing or wrongly typed fields', async () => {
    const broken = { schemaVersion: 1, products: [null, 5, { elements: [null, { evidence: [null, 'x'] }] }], pages: 'x', summary: null, provisions: [7] } as unknown as SafeshelfReport;
    const html = await renderHtmlReport(broken);
    expect(html).toContain('Safeshelf report');
  });

  it('has a strict CSP with the style hash, no scripts, and the attribution footer', async () => {
    const html = await renderHtmlReport(base());
    const style = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
    const hash = createHash('sha256').update(style).digest('base64');
    expect(html).toContain(`content="${escapeHtml(`default-src 'none'; img-src data:; style-src 'sha256-${hash}'; base-uri 'none'; form-action 'none'`)}"`);
    expect(html).not.toMatch(/<script|\son\w+=|\sstyle=/i);
    expect(html).toContain(`<a href="${ATTRIBUTION.url}" rel="noopener noreferrer">${ATTRIBUTION.text}</a>`);
    expect(html).toContain(escapeHtml(DISCLAIMER));
    expect(html).toContain('GPSR Art. 19(a)');
  });

  it('embeds only JPEG screenshots inside the report directory', async () => {
    const out = path.join(dir, 'shots');
    await mkdir(path.join(out, 'screenshots'), { recursive: true });
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(20)]);
    await writeFile(path.join(out, 'screenshots', 'E0001.jpg'), jpeg);
    await writeFile(path.join(out, 'screenshots', 'E0002.jpg'), Buffer.from('<svg onload=alert(1)>'));
    await writeFile(path.join(dir, 'outside.jpg'), jpeg);
    await symlink(path.join(dir, 'outside.jpg'), path.join(out, 'screenshots', 'E0003.jpg'));
    const r = base();
    const p = r.products[0];
    if (p === undefined) throw new Error('fixture');
    const withShots = (shot: string) => ({ ...r, products: [{ ...p, elements: p.elements.map((e, i) => (i === 0 ? { ...e, evidence: [{ source: 'text' as const, text: 't', selector: '', field: '', visibility: 'visible' as const, screenshot: shot }] } : e)) }] });
    expect(await renderHtmlReport(withShots('screenshots/E0001.jpg'), { baseDir: out })).toContain('data:image/jpeg;base64,');
    expect(await renderHtmlReport(withShots('screenshots/E0002.jpg'), { baseDir: out })).not.toContain('data:image');
    expect(await renderHtmlReport(withShots('screenshots/E0003.jpg'), { baseDir: out })).not.toContain('data:image');
    expect(await renderHtmlReport(withShots('screenshots/../../outside.jpg'), { baseDir: out })).not.toContain('data:image');
    // A JPEG inside the report directory but not a screenshot is not read either.
    await writeFile(path.join(out, 'private.jpg'), jpeg);
    expect(await renderHtmlReport(withShots('private.jpg'), { baseDir: out })).not.toContain('data:image');
  });

  it('embeds no screenshot larger than the per-image cap', async () => {
    const out = path.join(dir, 'bigshot');
    await mkdir(path.join(out, 'screenshots'), { recursive: true });
    await writeFile(path.join(out, 'screenshots', 'E0001.jpg'), Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(IMAGE_LIMITS.maxImageBytes)]));
    const r = base();
    const p = r.products[0];
    if (p === undefined) throw new Error('fixture');
    const shot = { ...r, products: [{ ...p, elements: p.elements.map((e, i) => (i === 0 ? { ...e, evidence: [{ source: 'text' as const, text: 't', selector: '', field: '', visibility: 'visible' as const, screenshot: 'screenshots/E0001.jpg' }] } : e)) }] };
    expect(await renderHtmlReport(shot, { baseDir: out })).not.toContain('data:image');
  });

  it('renders at most 2000 product cards and says so', async () => {
    const r = base();
    const p = r.products[0];
    if (p === undefined) throw new Error('fixture');
    const many = { ...r, products: Array.from({ length: 2005 }, (_v, i) => ({ ...p, id: `P${String(i).padStart(4, '0')}` })) };
    const html = await renderHtmlReport(many);
    expect(html.match(/<section class="product"/g)).toHaveLength(2000);
    expect(html).toContain('Only the first 2000 of 2005 products are shown here.');
  });

  it('only links http(s) URLs', () => {
    expect(safeHref('https://a.example/x')).toBe('https://a.example/x');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,x')).toBeNull();
    expect(safeHref(5)).toBeNull();
    expect(escapeHtml('<a href="x">\'`&')).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&#96;&amp;');
  });
});

describe('JSON report', () => {
  it('matches the published schema (feed reports)', () => {
    for (const [file, format] of [
      ['woocommerce.csv', 'woocommerce'],
      ['shopify.csv', 'shopify'],
      ['google.xml', 'google-xml'],
      ['google.tsv', 'google-tsv'],
    ] as const) {
      expect(validate(schema, JSON.parse(JSON.stringify(checkFeed(fixture(file), { format }))))).toEqual([]);
    }
  });
  it('the schema rejects unknown statuses and extra keys', () => {
    const r = JSON.parse(JSON.stringify(base())) as Record<string, unknown>;
    expect(validate(schema, { ...r, extra: 1 })).not.toEqual([]);
    const products = r.products as { elements: { status: string }[] }[];
    const first = products[0]?.elements[0];
    if (first !== undefined) first.status = 'illegal';
    expect(validate(schema, r).some((e) => e.includes('enum'))).toBe(true);
  });
  it('summarises per element', () => {
    const s = summarize(base().products);
    expect(s.products).toBe(5);
    expect(s.byElement['manufacturer-name']).toEqual({ found: 3, 'found-not-visible': 0, 'not-found': 1, 'not-applicable': 0, review: 1 });
  });
});

describe('writing files', () => {
  it('writes the four files with mode 0600 into a 0700 directory', async () => {
    const out = path.join(dir, 'w');
    const written = await writeReports(base(), out);
    expect(Object.keys(written).sort()).toEqual(['csv', 'fixes', 'html', 'json']);
    for (const f of Object.values(written) as string[]) expect((await stat(f)).mode & 0o777).toBe(0o600);
    expect((await stat(out)).mode & 0o777).toBe(0o700);
    expect(JSON.parse(await readFile(path.join(out, 'report.json'), 'utf8'))).toMatchObject({ kind: 'feed' });
  });
  it('refuses to write through a symlink or with an unsafe name', async () => {
    const out = path.join(dir, 'sym');
    await mkdir(out, { recursive: true });
    await writeFile(path.join(dir, 'target.txt'), 'keep');
    await symlink(path.join(dir, 'target.txt'), path.join(out, 'report.json'));
    await expect(writeReports(base(), out, { html: false, csv: false, fixes: false })).rejects.toThrow();
    expect(await readFile(path.join(dir, 'target.txt'), 'utf8')).toBe('keep');
    await expect(safeWriteFile(out, '../x', 'a')).rejects.toThrow(/Unsafe/);
    expect(isSafeFileName('..')).toBe(false);
    expect(isSafeFileName('a/b')).toBe(false);
    expect(isSafeFileName('E0001.jpg')).toBe(true);
  });
  it('refuses a symlinked output directory and a hard-linked report file', async () => {
    await mkdir(path.join(dir, 'real-out'), { recursive: true });
    await symlink(path.join(dir, 'real-out'), path.join(dir, 'linked-out'));
    await expect(writeReports(base(), path.join(dir, 'linked-out'))).rejects.toThrow(/symlink/);
    expect(await readdir(path.join(dir, 'real-out'))).toEqual([]);
    const out = path.join(dir, 'hard');
    await mkdir(out, { recursive: true });
    await writeFile(path.join(dir, 'precious.txt'), 'keep');
    await link(path.join(dir, 'precious.txt'), path.join(out, 'report.json'));
    await expect(writeReports(base(), out, { html: false, csv: false, fixes: false })).rejects.toThrow(/not a plain file/);
    expect(await readFile(path.join(dir, 'precious.txt'), 'utf8')).toBe('keep');
    // An existing plain file is replaced.
    const again = path.join(dir, 'again');
    await writeReports(base(), again, { html: false, csv: false, fixes: false });
    await writeReports(base(), again, { html: false, csv: false, fixes: false });
    expect(JSON.parse(await readFile(path.join(again, 'report.json'), 'utf8'))).toMatchObject({ kind: 'feed' });
  });

  it('refuses a symlinked screenshots directory', async () => {
    const out = path.join(dir, 'symdir');
    await mkdir(out, { recursive: true });
    await mkdir(path.join(dir, 'elsewhere'), { recursive: true });
    await symlink(path.join(dir, 'elsewhere'), path.join(out, 'screenshots'));
    await expect(ensureSubdir(out, 'screenshots')).rejects.toThrow(/not a plain directory/);
  });
});
