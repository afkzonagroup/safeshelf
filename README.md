# Safeshelf

Safeshelf checks online product offers and product exports for the information that Article 19 of the EU General Product Safety Regulation lists for distance sales.

It looks for each item (manufacturer, its postal and electronic address, the responsible person in the EU where needed, a picture, the type, another product identifier, and warnings) and reports what it **found**, what it found **only in hidden or machine-readable data**, and what it **could not find**, with evidence and a confidence level.

"Not found" means Safeshelf did not detect it. The information may still be there in a form Safeshelf cannot read, such as an image or a PDF. Safeshelf never says that a product is unsafe or that an offer is unlawful.

Not legal advice. Using Safeshelf does not make any offer compliant with anything.

## Why it exists

[Regulation (EU) 2023/988 on general product safety](https://eur-lex.europa.eu/eli/reg/2023/988/oj) (GPSR) applies from 13 December 2024 (Art. 52). [Article 19](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R0988-20260529#art_19) says that where economic operators make products available online or through other distance sales, "the offer of those products shall clearly and visibly indicate at least the following information":

> (a) name, registered trade name or registered trade mark of the manufacturer, as well as the postal and electronic address at which they can be contacted;
> (b) where the manufacturer is not established in the Union, the name, postal and electronic address of the responsible person within the meaning of Article 16(1) of this Regulation or Article 4(1) of Regulation (EU) 2019/1020;
> (c) information allowing the identification of the product, including a picture of it, its type and any other product identifier; and
> (d) any warning or safety information to be affixed to the product or to the packaging or included in an accompanying document in accordance with this Regulation or the applicable Union harmonisation legislation in a language which can be easily understood by consumers, as determined by the Member State in which the product is made available on the market.

[Article 22(9)](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R0988-20260529#art_22) asks online marketplaces to let traders provide the same four items and to display them, or make them easily accessible, on the product listing.

Shops with hundreds of products need to know which offers lack which item. Today that is mostly paid shop-platform apps or plugins where you type the data in. Safeshelf checks what the offer actually shows, and checks your product export before you upload it.

All legal text was read from the official texts on EUR-Lex: the GPSR as published in the Official Journal and in the consolidated version of 29 May 2026 (which includes the amendments by Regulation (EU) 2024/2748: Articles 4, 9, 11, 16, 19, 21 and 22 are unchanged; Article 3 gains a new point 29; Article 2(1)(b) now also excludes the new Chapter IIa for harmonised products), and [Regulation (EU) 2019/1020](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02019R1020-20260812#art_4) Article 4 in the consolidated version of 12 August 2026.

## Quick start

Requires Node.js 22 or later.

```sh
npm install @afkzona/safeshelf
npx playwright-core install chromium-headless-shell

# Check a product export offline (nothing is fetched)
npx safeshelf feed products.csv --format woocommerce

# Crawl a shop and check its product pages
npx safeshelf scan https://shop.example --sitemap --max-products 20
```

Both write `safeshelf-report/` with `report.json`, `report.html` and `missing.csv`; feeds also get `fixes.csv`, and scans get `screenshots/`. Open `report.html` in a browser.

Safeshelf uses Playwright's bundled Chromium only. It never starts a Chrome browser installed on your machine. Checking a feed does not start a browser at all.

## What it checks, and under which provision

Each item is reported under Art. 19 for a shop's own offers, or under Art. 22(9) with `--marketplace` for listings on an online marketplace.

| Item | Provision | How Safeshelf detects it | Confidence when found |
| --- | --- | --- | --- |
| Manufacturer name | [Art. 19(a)](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R0988-20260529#art_19) / [22(9)(a)](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R0988-20260529#art_22); context [Art. 9(6)](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R0988-20260529#art_9), [Art. 3(8)](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R0988-20260529#art_3) | schema.org `manufacturer` (JSON-LD or microdata); a labelled section ("Manufacturer:", "Hersteller", "Gamintojas", ... in 24 languages); a mapped feed column. A brand alone gives **review**: it may be the manufacturer's registered trade mark, which Art. 19(a) accepts, but Safeshelf cannot tell. Seller details ("Sold by") are never taken for the manufacturer. | high for a labelled section or a feed column; medium when a structured-data name also appears in the text without a label |
| Manufacturer postal address | Art. 19(a) | Address scoring in the manufacturer's section or `manufacturer.address`: a postcode in a known format (1 or 1.5 points), a street word with a number (1.5), a post-office box (1.5), a country name (1). | high at 3 points or more, medium at 2, review below |
| Manufacturer electronic address | Art. 19(a) | An email address or `mailto:` link in the section, or `manufacturer.email`. A web address or contact link counts with medium confidence: the Regulation does not define "electronic address". A link on the name (for example to the shop's brand page) does not count. Disguised addresses ("info [at] ...") are medium. | high for an email |
| Responsible person: name, postal and electronic address (three items) | [Art. 19(b)](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R0988-20260529#art_19), [Art. 16(1)](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R0988-20260529#art_16), [Regulation (EU) 2019/1020 Art. 4(1) and (2)](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02019R1020-20260812#art_4) | Sections labelled "Responsible person", "EU Responsible Person", "Verantwortliche Person", ..., and also "Importer", "Authorised representative" and "Fulfilment service provider", because under Regulation (EU) 2019/1020 Art. 4(2) an importer, an authorised representative with a written mandate, or (where none of those and no manufacturer is established in the Union) a fulfilment service provider can be the responsible person (points (b), (c) and (d)). A fulfilment service provider section counts only when it has an email or a postal address, so delivery text such as "dispatched by our fulfilment service provider within 24 hours" is not taken. Only needed where the manufacturer is not established in the Union: **not applicable** when the manufacturer's address is in an EU Member State, **not found** when it is outside the EU, **review** when Safeshelf cannot tell. Set `--manufacturer-in-eu yes|no` or map a feed column to decide it yourself. | as for the manufacturer |
| Picture of the product | [Art. 19(c)](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R0988-20260529#art_19) | A rendered image of at least 150 x 150 pixels that is not a logo or icon (high when at least 200 x 200 in the main content and not a wide banner; pictures named like the product come first); `image` in structured data or `og:image` (not visible unless the same file is shown); a feed image column. | high or medium |
| Type | Art. 19(c); context [Art. 9(5)](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R0988-20260529#art_9) | schema.org `model`; a "Model" / "Type" / "Modell" / ... section; a mapped feed column; an MPN (medium). Only a product name gives **review**, and so does a "Type" label whose value has no digits ("Type: Phone case" is usually a category). The Shopify "Type" column is a category and is not used. | high for model labels or values with digits |
| Other product identifier | Art. 19(c) | GTIN/EAN/UPC (with a check-digit test), MPN, ISBN, article number, from structured data, labelled text or feed columns. A GTIN with a wrong check digit, and a SKU or an ASIN (often the shop's or marketplace's own code), are medium. If none is found but the type is, the result is **review**: "any other product identifier" applies only if the product has one. | high |
| Warnings and safety information | [Art. 19(d)](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R0988-20260529#art_19); context [Art. 9(7)](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R0988-20260529#art_9) | Sections labelled "Warning", "Safety information", "Warnhinweise", "Įspėjimai", ... A section that is only a link to a PDF gives **review**. Not found gives **review**, because only products that have warnings need them; `--require-safety-info` makes it **not found**. With `--safety-languages lt,en`, warnings found only under a label in another language are marked for review. Safeshelf judges the label's language, not the text. | high |

Art. 19 also applies to products under Union harmonisation legislation: Art. 2(1)(b) excludes Chapter III Section 1 for them, but Art. 19 is in Section 2. Under Art. 2(1), first subparagraph, the GPSR still gives way where specific Union rules with the same objective apply to a product; Safeshelf does not check sector rules.

### Statuses and confidence

| Status | Meaning |
| --- | --- |
| `found` | Detected; on a page, in content a visitor can see. Content inside a closed tab, accordion or `<details>` is found with lower confidence and a note, because whether content shown after a click is "clearly and visibly" indicated is a judgement. |
| `found-not-visible` | Detected only in machine-readable data (JSON-LD, meta tags) or hidden content. Art. 19 asks the offer to indicate it clearly and visibly. |
| `not-found` | Not detected. |
| `not-applicable` | The requirement appears not to apply (responsible person for an EU manufacturer). |
| `review` | A person has to decide (a brand only, a product name only, warnings that the product may not need, an unknown establishment). |

Confidence says how strongly the evidence supports the status. It is not a legal assessment. For "not found": **medium** on a page that was read completely, **low** when frames, CSS background pictures, collection limits or empty tabs mean something may have been missed, **high** in a feed when the dedicated column exists and is empty, **medium** when the feed has no column for it.

Every result lists up to three pieces of evidence: the source (`json-ld`, `microdata`, `meta`, `text`, `image`, `feed`), the text, the CSS selector or feed column, the visibility, the label that matched with its language and origin, and on pages a cropped screenshot.

### Label phrases in 24 languages

The labels Safeshelf recognises are data in [`src/data/labels.ts`](src/data/labels.ts). Each phrase records where it comes from:

- `official-text`: the word appears verbatim in that language version of Art. 19 (a test checks this against the stored official text of all 24 versions). Some are inflected forms, because that is how they appear in the text. Art. 19 does not name the fulfilment service provider, so its official labels are the defined term of GPSR Art. 3, point (12), checked the same way against that definition.
- `original`: English written by the maintainers.
- `translation`: everything else, written by the maintainers. **These need review by native speakers.** Corrections are welcome (see CONTRIBUTING.md).

The same applies to the country names in [`src/data/countries.ts`](src/data/countries.ts), the add-to-cart words in [`src/data/cart.ts`](src/data/cart.ts) and the street words and legal forms in the address heuristics.

## Library

<!-- example: examples/check-shop.ts -->
```ts
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
```

Main exports:

- `scan(options)`: crawl a shop (`url`, optionally `sitemap: true`) or check a list of product pages (`urls`).
- `checkFeed(text, options)` and `checkFeedFile(path, options)`: check an export offline.
- `writeReports(report, dir, { json, html, csv, fixes })`: writes `report.json`, `report.html`, `missing.csv` and, for feeds, `fixes.csv`.
- `renderHtmlReport`, `missingCsv`, `fixesCsv`: the outputs as strings.
- `evaluateFacts`, `pageFacts`, `feedFacts`, `matchLabel`, `scoreAddress`, `isValidGtin` and the other pure functions, for your own data.
- `PROVISIONS`, `ELEMENTS`, `LABEL_PHRASES`, `COUNTRIES`: the legal mapping and the phrase data.

The JSON report format is versioned (`schemaVersion`, currently `1.0.0`) and described by [`schema/report.schema.json`](schema/report.schema.json).

## Product feeds and exports

```sh
safeshelf feed <file> --format shopify|woocommerce|google-xml|google-tsv|generic [--mapping mapping.json]
```

Nothing is fetched: image URLs and links in the file are read as text. Formats and the columns Safeshelf reads by default:

| Format | Key | Columns used | Source of the column names |
| --- | --- | --- | --- |
| `shopify` | `URL handle` (older exports: `Handle`); rows with the same handle are one product | `Title`, `Description` / `Body (HTML)`, `Vendor` (as brand), `SKU` / `Variant SKU`, `Barcodes` / `Barcode` / `Variant Barcode`, `Product image URL` / `Image Src` / `Variant image URL`, `Google Shopping / MPN`, and metafield columns `Name (product.metafields.namespace.key)` whose names mention the manufacturer, responsible person, importer or warnings | [Shopify help: product CSV](https://help.shopify.com/en/manual/products/import-export/using-csv) |
| `woocommerce` | `ID` (or `SKU`); variation rows are added to their parent | `Name`, `Description`, `Short description`, `SKU`, `GTIN, UPC, EAN, or ISBN`, `Images` (comma-separated), `Brands`, `Attribute N name` / `Attribute N value(s)` pairs (for example "Manufacturer"), and `Meta: key` columns whose keys mention the manufacturer, responsible person or warnings | [WooCommerce product CSV import schema](https://github.com/woocommerce/woocommerce/wiki/Product-CSV-Import-Schema), [WooCommerce importer documentation](https://woocommerce.com/document/product-csv-importer-exporter/) |
| `google-xml`, `google-tsv` | `id` | `title`, `description`, `link`, `image_link`, `additional_image_link`, `brand`, `gtin`, `mpn`, `product_detail` (section, attribute name and value; in TSV `section:attribute:value`) | [Google Merchant Center product data specification](https://support.google.com/merchants/answer/7052112) |
| `generic` | from the mapping, or `id` / `sku` / `handle` | from the mapping, plus columns whose names say what they hold | your own export |

Rows for products that are not offered are skipped and counted in the notes: WooCommerce `Published` -1 (draft) or 0 (private), Shopify `Status` draft or archived.

Descriptions are read as text (never rendered): headings, table rows and term lists such as `<tr><th>Manufacturer</th><td>...</td></tr>` count as labelled sections.

### Column mapping

A mapping file says which columns hold which information. It can be used with any format and overrides the defaults. Roles: `title`, `url`, `description`, `manufacturerName`, `manufacturerAddress`, `manufacturerEmail`, `manufacturerText` (name, address and email in one field), `manufacturerCountry`, `manufacturerInEu` (yes/no and translations), `responsibleName`, `responsibleAddress`, `responsibleEmail`, `responsibleText`, `brand`, `seller`, `image`, `type`, `gtin`, `mpn`, `sku`, `identifier`, `safety`, `labelled` ("Label: value" text). Each role takes a column name or a list of up to 20. Unknown keys are refused, so typos are caught. Schema: [`schema/mapping.schema.json`](schema/mapping.schema.json).

<!-- example: examples/mapping.json -->
```json
{
  "key": "Product ID",
  "delimiter": ";",
  "columns": {
    "title": "Product name",
    "manufacturerName": "Maker",
    "manufacturerAddress": "Maker address",
    "manufacturerEmail": "Maker email",
    "manufacturerInEu": "Maker established in EU",
    "responsibleText": "EU rep",
    "image": "Picture",
    "type": "Model",
    "gtin": "EAN",
    "safety": "Safety notes"
  }
}
```

### WooCommerce round trip: export, check, fix

1. In WooCommerce, export products (Products > Export) to CSV.
2. Run `safeshelf feed wc-product-export.csv --format woocommerce`.
3. Open `safeshelf-report/fixes.csv`. It has one row per product with information not found: the `ID` column, one empty column per missing item and two `Safeshelf:` columns that say what is missing. When your export already has a column for an item (for example `Meta: gpsr_manufacturer`), that column is used; otherwise a suggested `Meta: gpsr_...` column.
4. Fill in the empty cells and import the file (Products > Import, "Update existing products"). WooCommerce matches rows by `ID` or `SKU` and stores `Meta:` columns as product meta. Leave the two `Safeshelf:` columns unmapped.
5. **Meta fields are not shown on the product page by themselves.** Map the columns to the fields your theme or GPSR plugin displays, then check the pages with `safeshelf scan`.

<!-- example: examples/check-feed.ts -->
```ts
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
```

For Shopify, `fixes.csv` starts with `URL handle` and `Title` (the importer needs the title) and suggests metafield columns. For other formats it uses the file's key column and plain suggested names.

All CSV output is formula-injection safe: every cell is quoted, and a cell starting with `=`, `+`, `-`, `@`, `|`, `%`, tab or carriage return gets a leading apostrophe, unless it is a plain number. A product name such as `=HYPERLINK(...)` is therefore written as `'=HYPERLINK(...)`; if you import that cell back, remove the apostrophe.

## Command line

```
safeshelf scan <shop-url> [options]
safeshelf scan --urls <file> [options]
safeshelf feed <file> --format <f> [options]
safeshelf --help | --version
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--sitemap` | off | Read the shop's sitemaps (from robots.txt and `/sitemap.xml`, plain or gzip) to find product pages. Sitemaps on other sites are ignored |
| `--urls <file>` | none | Check the product pages listed in a file, one URL per line, `#` for comments, at most 2000 |
| `--max-pages <n>` | 50 | Pages to load, 1 to 2000 |
| `--max-products <n>` | 50 | Product pages to check, 1 to 2000 |
| `--max-duration <s>` | 600 | Time budget in seconds, 5 to 3600 |
| `--ignore-robots` | off | Do not read robots.txt |
| `--allow-address <ip>` | none | Allow one private IP address (your own staging server). Repeatable. Cloud metadata addresses can never be allowed |
| `--no-sandbox` | off | Run Chromium without its OS sandbox, only inside a container. Also set by `SAFESHELF_NO_SANDBOX=1`. If the sandbox cannot start, Safeshelf stops with an explanation instead of turning it off |
| `--format <f>` | required for `feed` | `shopify`, `woocommerce`, `google-xml`, `google-tsv` or `generic` |
| `--mapping <file>` | none | JSON column mapping, at most 64 KiB |
| `--out <dir>` | `safeshelf-report` | Output directory |
| `--report <list>` | `json,html,csv` | Which reports to write; `csv` also controls `fixes.csv` |
| `--marketplace` | off | The offers are marketplace listings: cite Art. 22(9) |
| `--manufacturer-in-eu <v>` | `auto` | `yes`, `no` or `auto` (from the manufacturer's address) |
| `--safety-languages <list>` | none | ISO 639-1 codes of the languages accepted for warnings |
| `--require-safety-info` | off | Your products have warnings: report them as not found when missing |
| `--fail-on <level>` | `none` | Exit 1 if any product has an item `missing` (not found or not visible), or `review` (also items to review) |
| `--quiet` | off | Print only the summary line |

Exit codes: 0 done, 1 products at or above `--fail-on`, 2 usage, input or runtime error.

## How a scan works

From the start URL Safeshelf loads pages on the same origin (scheme, host and port), product-looking URLs first (`/products/`, `/product/`, `/p/`, ...), and skips carts, accounts, checkouts and files. A page counts as a product page when it has schema.org data for one product, an Open Graph type "product", or a product-like URL with an add-to-cart control; listing pages with several products are skipped. Pages given with `--urls` are always checked.

Each page is loaded in Playwright's bundled Chromium, given up to three seconds to settle, and read once by a collector that runs in an isolated JavaScript world (page scripts cannot tamper with it): text blocks in reading order (with tabs and accordions linked to their panels through `aria-controls`), JSON-LD, microdata, Open Graph tags and rendered images. Nothing on the page is clicked.

## Connectors

### GitHub Action

<!-- example: examples/github-workflow.yml -->
```yaml
name: Product information check
on:
  workflow_dispatch:
permissions:
  contents: read
jobs:
  safeshelf:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - id: check
        # Pin to a full commit SHA of the release you reviewed.
        uses: afkzonagroup/safeshelf@v0.1.0
        with:
          feed: exports/products.csv
          feed-format: woocommerce
          fail-on: missing
```

Inputs: `url`, `urls-file` or `feed` (with `feed-format` and optional `mapping`), and `sitemap`, `max-pages`, `max-products`, `max-duration`, `marketplace`, `manufacturer-in-eu`, `safety-languages`, `require-safety-info`, `out`, `report`, `fail-on`, `allow-addresses`, `ignore-robots`. Outputs: `products`, `products-with-missing`, `products-with-review`, `report-dir`. The job summary shows counts per item.

Inputs reach the program as environment variables, never inside a shell script. Outputs and the summary come from the report of the current run held in memory; a `report.json` already in the workspace is never read, and every output value is checked (integers, or the path without control characters). Chromium's sandbox stays on: on GitHub-hosted Ubuntu runners the Action allows unprivileged user namespaces, which the sandbox needs; on self-hosted runners it changes nothing. Feed checks do not install a browser.

### Docker

```sh
docker build -t safeshelf .
docker run --rm \
  --cap-drop=ALL --security-opt no-new-privileges \
  --read-only --tmpfs /tmp --tmpfs /home/node \
  --memory 2g --pids-limit 512 \
  -v "$PWD/out:/work/out" \
  safeshelf scan https://shop.example --out /work/out
```

The image runs as the unprivileged `node` user with production dependencies only. Chromium's own sandbox is off inside the image (`SAFESHELF_NO_SANDBOX=1`), because a default container cannot provide what it needs: the container is the boundary, so run it with the flags above. For a feed, mount the file read-only: `-v "$PWD/products.csv:/work/products.csv:ro"` and run `safeshelf feed /work/products.csv --format woocommerce --out /work/out`. The mounted output directory must be writable by user id 1000.

### Playwright test helper

Check product pages inside your own Playwright tests, for example after a theme change. The page is yours, so this helper fetches nothing itself and the network guard does not apply.

<!-- example: examples/product-page.spec.ts -->
```ts
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
```

`toShowGpsrInformation(options)` passes when every selected item is found, not applicable or (unless `failOnReview` is set) for review. Options: `elements`, `failOnReview`, `context`, `manufacturerInEu`, `safetyLanguages`, `requireSafetyInformation`.

## Limitations

Safeshelf reads text and data. Known gaps, so you know where to look yourself:

- **False "not found"**: information inside images (a scanned label), PDFs, frames, closed shadow DOM, content that loads only after a click or scroll, text split across unusual markup, labels in wording not in the phrase lists, or a manufacturer named without any label. Pages that detect automated browsers can show different content.
- **False "found"**: a labelled section that names the wrong party (for example a distributor labelled "Manufacturer"), placeholder text not in the placeholder list, an address-like string that is not an address, or a structured-data name that also appears elsewhere on the page. Safeshelf does not check that names, addresses or email addresses are real or correct, or that the information matches the product.
- **Address scoring** knows common postcode formats and street words. Addresses without postcodes (for example Hong Kong) score lower; unusual formats may score as "review".
- **Responsible person**: Safeshelf infers where the manufacturer is established from the country in its address. It does not know a company's legal seat. Iceland, Liechtenstein and Norway are treated as unknown; whether an EEA establishment counts depends on the EEA Agreement, which Safeshelf does not assess.
- **Warnings**: Safeshelf cannot know which warnings a product needs, whether those shown are complete, or which languages a Member State requires. It reports the language of the label that introduced the warnings, not of the text.
- **"Clearly and visibly"** is not measured beyond visible, collapsed or hidden. Font size, contrast and position are not judged.
- **Feeds** show which data exists, not what the shop displays. Check the pages as well.
- **Other duties** in the GPSR (product safety, risk analysis, labelling on the product itself under Art. 9, 11 and 16(3), marketplace processes under Art. 22) are outside what Safeshelf checks. Translations of labels need native review.

## Configuration reference

`ScanOptions` (library): `url` or `urls`, `sitemap`, `maxPages` (50), `maxProducts` (50), `maxDurationMs` (600 000), `navigationTimeoutMs` (30 000), `maxResponseBytes` (10 MiB per response), `maxTotalBytes` (500 MiB per scan, both directions), `maxRedirects` (5), `respectRobotsTxt` (true), `allowAddresses`, `outputDir`, `chromiumSandbox` (true), `viewport` (1280 x 900), `locale` (en-GB), `resolver`, `onProgress`, plus the evaluation options `context`, `manufacturerInEu`, `safetyLanguages`, `requireSafetyInformation`.

`CheckFeedOptions`: `format`, `mapping`, `fileName`, `maxProducts` (100 000), plus the evaluation options. Feed files may be up to 100 MiB; CSV is limited to 200 000 rows, 1000 columns, 1 000 000 characters per cell and 30 000 000 cells; XML to 64 levels and 3 000 000 elements. Feeds are read into memory: allow about 2 GB for a feed near the 100 MiB limit (for Docker, `--memory 3g`).

## Security

Safeshelf renders untrusted web pages, so the scanner is built to resist hostile sites. In short: Chromium's OS sandbox on by default; the page collector in an isolated JavaScript world; an SSRF guard that resolves every host and refuses private, loopback, link-local, CGNAT, unique-local, multicast, reserved and cloud metadata addresses, on every request, redirect hop and sub-resource (route checks plus a local guard proxy that pins the checked address); byte budgets charged while data streams in both directions; page, time, redirect and size limits; pop-ups closed; no cookies or credentials from you; robots.txt respected by default; terminal escape sequences stripped; Action outputs validated. Feeds are parsed by hand-written readers with size caps; XML document type declarations are refused. See [SECURITY.md](SECURITY.md) for the threat model and how to report a vulnerability.

Safeshelf has no telemetry. It sends requests only to the sites you scan and the resources those pages load, and reports stay in the directory you choose.

## Dependencies

One runtime dependency: [`playwright-core`](https://www.npmjs.com/package/playwright-core) (pinned), to drive Playwright's bundled Chromium. CSV, XML, JSON-LD, microdata, robots.txt and sitemap handling are written in this package so that their limits are under its control. `@playwright/test` is an optional peer dependency for the test helper.

## Licence and Enterprise

Safeshelf is licensed under the [GNU Affero General Public License version 3](LICENSE) only, with an additional term under section 7(b) in [LICENSE-ADDITIONAL-TERMS.md](LICENSE-ADDITIONAL-TERMS.md): the notice "Safeshelf by AFKzona Group" with its link must stay in user interfaces and generated HTML reports. "Safeshelf" is a trademark of MB AFKzona Group ([TRADEMARKS.md](TRADEMARKS.md)); forks must use another name.

A commercial licence without the AGPL obligations is available ([COMMERCIAL.md](COMMERCIAL.md)).

**Enterprise.** MB AFKzona Group offers a commercial licence for organisations that cannot use the AGPL-3.0 terms (including white-label use without the attribution notice), integration into your systems, custom connectors and features, and support agreements. Contact info@afkzonagroup.lt.

## Contributing

Contributions are welcome, especially native-speaker reviews of the label phrases. Please read [CONTRIBUTING.md](CONTRIBUTING.md); pull requests need a signed [CLA](CLA.md). Run `npm run check` (typecheck, lint, tests) before opening a pull request.

## Disclaimer

Safeshelf reports whether it could find information that Article 19 of Regulation (EU) 2023/988 lists. It does not assess whether a product is safe, whether an offer or a business complies with the law, or which national rules apply. It is not legal advice. Have a qualified person review the results.

Safeshelf by AFKzona Group - https://afkzonagroup.lt
