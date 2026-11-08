// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    alias: {
      '@afkzona/safeshelf/playwright': new URL('./src/playwright/index.ts', import.meta.url).pathname,
      '@afkzona/safeshelf': new URL('./src/index.ts', import.meta.url).pathname,
    },
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // bin.ts is a three-line wrapper; page-scripts.ts runs inside Chromium, where V8
      // coverage of the Node process cannot see it (it is exercised by test/integration).
      exclude: ['src/cli/bin.ts', 'src/browser/page-scripts.ts'],
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
    },
  },
});
