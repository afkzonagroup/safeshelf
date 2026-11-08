import { scan, writeReports, type ScanOptions } from '@afkzona/safeshelf';

/** Crawl a shop, check up to 20 product pages and write the reports to outDir. */
export async function checkShop(url: string, outDir: string, extra: Partial<ScanOptions> = {}) {
  const report = await scan({ url, sitemap: true, maxProducts: 20, outputDir: outDir, ...extra });
  await writeReports(report, outDir);
  for (const p of report.products) {
    if (p.missing.length > 0) console.log(`${p.name}: not found or not visible: ${p.missing.join(', ')}`);
  }
  return report;
}
