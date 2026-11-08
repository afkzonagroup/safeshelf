import { expect as baseExpect, test } from '@playwright/test';
import { checkPage, safeshelfMatchers } from '@afkzona/safeshelf/playwright';

const expect = baseExpect.extend(safeshelfMatchers);

test('product page shows the GPSR information', async ({ page }) => {
  await page.goto('/products/toy-lt.html');
  await expect(page).toShowGpsrInformation();
});

test('a page without manufacturer details is reported', async ({ page }) => {
  await page.goto('/products/no-info.html');
  const result = await checkPage(page, { elements: ['manufacturer-name', 'manufacturer-postal-address'] });
  expect(result.problems.map((p) => p.status)).toEqual(['not-found', 'not-found']);
});
