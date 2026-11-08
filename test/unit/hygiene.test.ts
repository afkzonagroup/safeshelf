// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Repository hygiene: no invisible or bidirectional control characters in
 * tracked text files (they can hide code from reviewers), no raw control
 * characters, a copyright header in every source file, and package metadata
 * that matches the code.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TOOL_VERSION } from '../../src/report/types.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TEXT = /\.(ts|js|mjs|json|md|yml|yaml|html|txt|css|csv|tsv|xml)$|^(LICENSE|Dockerfile|\.gitignore|\.npmrc|\.editorconfig|\.dockerignore)$/;

function trackedAndNewFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' });
  return out.split('\n').filter((f) => f !== '' && TEXT.test(path.basename(f)));
}

describe('repository hygiene', () => {
  const files = trackedAndNewFiles();

  it('finds the files to check', () => {
    expect(files.length).toBeGreaterThan(60);
  });

  it('contains no bidirectional or invisible formatting characters', () => {
    const bad = /[\u202a-\u202e\u2066-\u2069\u2028\u2029\u200b-\u200f\ufeff\u00ad]/u;
    const hits = files.filter((f) => bad.test(readFileSync(path.join(ROOT, f), 'utf8')));
    expect(hits).toEqual([]);
  });

  it('contains no raw control characters other than tab, line feed and carriage return', () => {
    // eslint-disable-next-line no-control-regex -- detecting control characters is the point
    const bad = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
    const hits = files.filter((f) => bad.test(readFileSync(path.join(ROOT, f), 'utf8')));
    expect(hits).toEqual([]);
  });

  it('every TypeScript file carries the copyright and licence header', () => {
    // Examples are meant to be copied into other projects, so they carry no header.
    const ts = files.filter((f) => f.endsWith('.ts') && !f.startsWith('examples/'));
    const missing = ts.filter((f) => {
      const text = readFileSync(path.join(ROOT, f), 'utf8');
      return !text.includes('Copyright 2026 MB AFKzona Group') || !text.includes('SPDX-License-Identifier: AGPL-3.0-only');
    });
    expect(missing).toEqual([]);
  });
});

describe('package metadata', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as Record<string, unknown>;
  it('matches the code version and the licence', () => {
    expect(pkg.version).toBe(TOOL_VERSION);
    expect(pkg.license).toBe('AGPL-3.0-only');
    expect(pkg.name).toBe('@afkzona/safeshelf');
    expect(pkg.engines).toEqual({ node: '>=22' });
  });
  it('has no install scripts, an allow-list of files and exact dependency versions', () => {
    const scripts = pkg.scripts as Record<string, string>;
    for (const s of ['preinstall', 'install', 'postinstall', 'prepare']) expect(scripts[s]).toBeUndefined();
    expect(pkg.files).toEqual(expect.arrayContaining(['dist', 'schema', 'LICENSE', 'LICENSE-ADDITIONAL-TERMS.md']));
    for (const deps of [pkg.dependencies, pkg.devDependencies] as Record<string, string>[]) {
      for (const v of Object.values(deps)) expect(v).toMatch(/^\d+\.\d+\.\d+$/);
    }
    expect(Object.keys(pkg.dependencies as object)).toEqual(['playwright-core']);
  });
  it('CI runs on pull requests and manual dispatch only, read-only, with pinned actions', () => {
    for (const f of ['ci.yml', 'codeql.yml']) {
      const yml = readFileSync(path.join(ROOT, '.github/workflows', f), 'utf8');
      expect(yml).toMatch(/on:\n {2}pull_request:\n {2}workflow_dispatch:\n/);
      expect(yml).not.toMatch(/^\s+(push|schedule):/m);
      expect(yml).toMatch(/permissions:\n {2}contents: read/);
      for (const uses of yml.match(/uses: \S+/g) ?? []) expect(uses).toMatch(/@[0-9a-f]{40}$/);
    }
  });
});

describe('release packaging', () => {
  const runCheckPack = (listing: unknown): number => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'safeshelf-pack-'));
    try {
      const file = path.join(dir, 'pack.json');
      writeFileSync(file, JSON.stringify(listing));
      try {
        execFileSync(process.execPath, [path.join(ROOT, 'scripts/check-pack.mjs'), file], { cwd: ROOT, stdio: 'pipe' });
        return 0;
      } catch (error) {
        return (error as { status?: number }).status ?? -1;
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const complete = [
    'package.json',
    'LICENSE',
    'LICENSE-ADDITIONAL-TERMS.md',
    'README.md',
    'dist/index.js',
    'dist/index.d.ts',
    'dist/playwright/index.js',
    'dist/playwright/index.d.ts',
    'dist/cli/bin.js',
    'schema/report.schema.json',
    'schema/mapping.schema.json',
  ];

  it('check-pack refuses a package without its compiled code and accepts a complete one', () => {
    expect(runCheckPack([{ files: complete.filter((f) => !f.startsWith('dist/')).map((p) => ({ path: p })) }])).toBe(1);
    expect(runCheckPack([{ files: complete.filter((f) => f !== 'LICENSE-ADDITIONAL-TERMS.md').map((p) => ({ path: p })) }])).toBe(1);
    expect(runCheckPack([{ files: complete.map((p) => ({ path: p })) }])).toBe(0);
  });

  it('CI and release build, check the packed file list, and run the browser tests with the sandbox on', () => {
    for (const f of ['ci.yml', 'release.yml']) {
      const yml = readFileSync(path.join(ROOT, '.github/workflows', f), 'utf8');
      const steps = ['npm run check', 'npm run build', 'npm pack --dry-run --json > "$RUNNER_TEMP/pack.json"', 'node scripts/check-pack.mjs "$RUNNER_TEMP/pack.json"'];
      const at = steps.map((s) => yml.indexOf(`- run: ${s}`));
      expect(at.every((i) => i !== -1)).toBe(true);
      expect([...at].sort((a, b) => a - b)).toEqual(at);
      expect(yml).toContain('playwright-core install --with-deps --only-shell chromium');
      expect(yml).toContain('sysctl -w kernel.apparmor_restrict_unprivileged_userns=0');
    }
    const release = readFileSync(path.join(ROOT, '.github/workflows/release.yml'), 'utf8');
    expect(release.indexOf('check-pack.mjs')).toBeLessThan(release.indexOf('npm publish'));
  });
});
