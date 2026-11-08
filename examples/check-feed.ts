import { checkFeedFile, writeReports } from '@afkzona/safeshelf';

/**
 * Check a WooCommerce product export offline. Writes report.json,
 * report.html, missing.csv and fixes.csv (a fill-in file you can import back).
 */
export async function checkWooExport(file: string, outDir: string) {
  const report = await checkFeedFile(file, { format: 'woocommerce' });
  await writeReports(report, outDir);
  console.log(`${String(report.summary.productsWithMissing)} of ${String(report.summary.products)} products have information not found.`);
  return report;
}
