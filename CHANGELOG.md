# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-11-08

### Added

- Library and `safeshelf` CLI that check the information GPSR (Regulation
  (EU) 2023/988) Art. 19 lists for distance sales, with Art. 22(9) for
  marketplace listings: manufacturer name, postal and electronic address;
  responsible person (Art. 16(1), Regulation (EU) 2019/1020 Art. 4) where the
  manufacturer is not established in the Union; picture, type and other
  identifier; warnings and safety information.
- Page scanner: same-origin crawl with sitemap support (plain and gzip,
  sitemap index files), URL lists, robots.txt, product-page detection,
  schema.org JSON-LD and microdata, Open Graph tags, labelled sections in the
  24 official EU languages, tabs and accordions through `aria-controls`,
  cropped screenshots as evidence.
- Offline feed checks: Shopify product CSV (current and older column names,
  metafields), WooCommerce product CSV (attributes, `Meta:` columns,
  variations), Google Merchant Center XML and TSV (`product_detail`), generic
  CSV with a validated column mapping.
- Reports: JSON (format 1.0.0 with JSON Schema), self-contained HTML with a
  strict Content-Security-Policy, `missing.csv`, and `fixes.csv` for a
  WooCommerce or Shopify import round trip; all CSV formula-injection safe.
- Network guard: DNS and IP checks for all blocked ranges, route
  interception, a pinned local guard proxy that re-checks every redirect hop,
  byte budgets charged while streaming, Chromium sandbox on by default.
- GitHub Action, Docker image (non-root), Playwright test helper
  (`@afkzona/safeshelf/playwright`).

[Unreleased]: https://github.com/afkzonagroup/safeshelf/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/afkzonagroup/safeshelf/releases/tag/v0.1.0
