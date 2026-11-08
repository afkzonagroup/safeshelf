// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * README examples are real files in examples/ and are executed here:
 * - every README block marked `<!-- example: path -->` must equal that file;
 * - the library examples run against the fixture shop and a fixture export;
 * - the mapping example validates in code and against the JSON schema;
 * - the Playwright Test example runs under the real Playwright Test runner
 *   against the built package.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkWooExport } from '../../examples/check-feed.js';
import { checkShop } from '../../examples/check-shop.js';
import { checkFeed } from '../../src/feeds/check.js';
import { parseMapping } from '../../src/feeds/mapping.js';
import { validate } from '../helpers/jsonschema.js';
import { startFixtures, type Fixtures } from '../helpers/server.js';

const exec = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let fx: Fixtures;
let dir: string;
beforeAll(async () => {
  fx = await startFixtures();
  dir = await mkdtemp(path.join(os.tmpdir(), 'safeshelf-examples-'));
});
afterAll(async () => {
  await fx.close();
  await rm(dir, { recursive: true, force: true });
});

describe('README examples', () => {
  it('every marked README block equals its example file', async () => {
    const readme = await readFile(path.join(ROOT, 'README.md'), 'utf8');
    const blocks = [...readme.matchAll(/<!-- example: (\S+) -->\n```\w+\n([\s\S]*?)```/g)];
    expect(blocks.map((b) => b[1])).toEqual(['examples/check-shop.ts', 'examples/mapping.json', 'examples/check-feed.ts', 'examples/github-workflow.yml', 'examples/product-page.spec.ts']);
    for (const [, file, body] of blocks) expect(body).toBe(await readFile(path.join(ROOT, file ?? ''), 'utf8'));
  });

  it('shop example scans and writes reports', async () => {
    const out = path.join(dir, 'shop');
    const report = await checkShop(`${fx.base}/`, out, { resolver: fx.resolver, allowAddresses: fx.allowAddresses, maxProducts: 3 });
    expect(report.products).toHaveLength(3);
    expect(JSON.parse(await readFile(path.join(out, 'report.json'), 'utf8'))).toMatchObject({ kind: 'scan', summary: { products: 3 } });
  }, 120_000);

  it('feed example writes the fill-in file', async () => {
    const out = path.join(dir, 'feed');
    const report = await checkWooExport(path.join(ROOT, 'test/fixtures/feeds/woocommerce.csv'), out);
    expect(report.summary.productsWithMissing).toBe(3);
    expect(await readFile(path.join(out, 'fixes.csv'), 'utf8')).toMatch(/^"ID","Meta: gpsr_manufacturer"/);
  });

  it('mapping example is valid in code and against the JSON schema, and works with its CSV', async () => {
    const text = await readFile(path.join(ROOT, 'examples/mapping.json'), 'utf8');
    const schema = JSON.parse(await readFile(path.join(ROOT, 'schema/mapping.schema.json'), 'utf8')) as Record<string, unknown>;
    expect(validate(schema, JSON.parse(text))).toEqual([]);
    expect(validate(schema, { columns: { nope: 'x' } })).not.toEqual([]);
    const report = checkFeed(await readFile(path.join(ROOT, 'examples/generic.csv'), 'utf8'), { format: 'generic', mapping: parseMapping(text) });
    expect(report.products).toHaveLength(2);
  });

  it('Playwright Test example passes against the built package', async () => {
    await exec(process.execPath, [path.join(ROOT, 'node_modules/typescript/bin/tsc'), '-p', path.join(ROOT, 'tsconfig.build.json')], { cwd: ROOT });
    const { stdout } = await exec(process.execPath, [path.join(ROOT, 'node_modules/@playwright/test/cli.js'), 'test', '--config', path.join(ROOT, 'examples/playwright.config.ts'), '--output', path.join(dir, 'pw')], {
      cwd: ROOT,
      env: { ...process.env, BASE_URL: `http://127.0.0.1:${String(fx.port)}`, CI: '1' },
    });
    expect(stdout).toMatch(/2 passed/);
  }, 120_000);
});
