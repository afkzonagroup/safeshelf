import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'product-page.spec.ts',
  reporter: 'line',
  use: { baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:3000' },
});
