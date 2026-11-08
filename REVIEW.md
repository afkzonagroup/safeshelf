# Review record

Two review passes were made on the 0.1.0 build before any independent review.
Each finding below was fixed in the same pass and covered by a test where a
test is possible.

State after both passes: `npm run check` passes (typecheck, lint, 630 tests
in 15 files); line coverage 96.3 % overall (detection 96.9 %, feeds 98.2 %,
reports 98.7 %, network guard 94.3 %; the in-page collector runs inside
Chromium and is covered by the integration tests only); `npm audit --omit=dev`
reports 0 vulnerabilities.

## Pass 1: correctness, law, edge cases, API, tests

### What was checked

- The legal texts, read on EUR-Lex: GPSR (Regulation (EU) 2023/988) as
  published in the Official Journal and in the consolidated version of
  29.05.2026; Regulation (EU) 2019/1020 in the consolidated version of
  12.08.2026. Articles 2(1), 3, 4, 9(5) to (7), 11(3), 16, 19, 21, 22(9) and 52
  of the GPSR and Article 4 of Regulation (EU) 2019/1020 were read in full.
  Every quote in `src/legal/provisions.ts` is checked by a test against stored
  copies of the official English texts (`test/fixtures/legal`).
- The OJ and consolidated GPSR texts were compared article by article:
  Articles 4, 9, 11, 16, 19, 21 and 22 are identical; Article 3 gains point 29
  (Regulation (EU) 2024/2748) and Article 2(1)(b) also excludes the new
  Chapter IIa. The first README draft said Article 3 was unchanged; corrected.
- Art. 19 still applies to products under Union harmonisation legislation:
  Art. 2(1)(b) excludes Chapter III Section 1 only, and Art. 19 is in Section 2.
  Stated in the README and tested.
- Art. 19 in all 24 language versions, downloaded from EUR-Lex. Every phrase
  marked `official-text` is checked by a test to appear as a whole word in that
  language version. Two Irish phrases failed the check (the text has the
  lenited forms "mhonaróra" and "chineál"); they were re-marked `translation`.
- Wording of every result: "found", "not found", "information not found",
  "review"; never "unsafe", "illegal" or "non-compliant". The disclaimer is in
  every report, the HTML footer and the README.
- Every status rule in `src/detect/evaluate.ts` against the text of Art. 19:
  the responsible person only where the manufacturer is not established in the
  Union (Art. 19(b)); warnings only where the product has them (Art. 19(d));
  "any other product identifier" only where one exists (Art. 19(c)).
- Feed formats against the published documentation (Shopify product CSV,
  WooCommerce CSV import schema and importer documentation, Google Merchant
  Center product data specification). Column names that the documentation
  does not show (for example older Shopify names) are labelled as such in the
  README.
- Fixture shop pages in German, French, English, Lithuanian, Polish and Dutch,
  with tables, definition lists, accordions, tabs, `<details>`, JSON-LD with
  `@graph` references, microdata, a marketplace listing with a seller box, a
  page with frames and background pictures, and a false-positive page.
- Coverage: 95 % of lines overall after pass 1; the Playwright helper was at
  0 % in-process (only exercised by the external Playwright Test run).

### Found and fixed

| # | Finding | Fix |
| --- | --- | --- |
| 1 | Accordion buttons and tabs are inline elements, so their text merged with neighbouring labels ("Fabrikant Veiligheidsinformatie") and the manufacturer in a closed accordion was not found. | Buttons, summaries, tabs and elements with `aria-controls`/`aria-expanded` are their own text blocks; tabs and buttons take the blocks of the panel they control. Fixture `accordion-nl.html`. |
| 2 | A panel that holds several labelled parts ("Product safety" tab with "Manufacturer:" and "Warning:" lines) became one big safety section, so manufacturer text counted as warnings. | A panel stops at the first labelled part; the parts form their own sections. Unit test. |
| 3 | Company names with a comma in the legal form ("Shenzhen Toyworks Co., Ltd.") were cut at the first comma. | The name ends at the first comma whose remainder is an address or contact detail and does not start with a legal form; legal forms must end at a word boundary. Tests with "Co., Ltd." and "Ascot Ltd, Ascot Road". |
| 4 | An address line ("Hauptstraße 5, 10115 Berlin") could be read as a company name. | A street and house number is never a name. Test. |
| 5 | "producent" is both Dutch (translation) and Polish (official text); the Dutch entry won. | On equal length, official-text phrases are tried before unofficial ones. Test. |
| 6 | A bare "type" or model only (no GTIN) made "other product identifier" not found, although Art. 19(c) asks for "any other product identifier" only if the product has one. | Not found plus a found type gives `review` (low). Test. |
| 7 | A SKU counted as a strong product identifier although it is often the shop's own code. | SKU evidence is medium with a note. Test. |
| 8 | Feed columns such as "Manufacturer warranty" or a metafield `manufacturer_url` were classified as manufacturer details. | Header classification ignores warranty, price, logo, website, URL and link columns. Test. |
| 9 | Draft, private and archived products in exports were checked like offered products. | WooCommerce `Published` -1 or 0 and Shopify `Status` draft or archived are skipped and counted in the notes (values from the WooCommerce schema and the Shopify documentation). Fixtures and test. |
| 10 | `<dt>`/`<dd>` pairs in feed descriptions were split into two units, so "Model:" lost its value. | `dd` continues the term's line. Test. |
| 11 | XML character references to characters XML forbids (`&#0;`, `&#x1B;`) were accepted. | Only XML `Char` code points are decoded. Test. |
| 12 | The HTML report of a 100 000-product feed would be hundreds of megabytes. | At most 2000 product cards, with a note; JSON and CSV keep everything. Test. |
| 13 | On a marketplace, collapsed content was explained only with the Art. 19 standard. | The explanation also quotes Art. 22(9) ("displayed or otherwise made easily accessible"). Test. |
| 14 | The crawl visited the start page twice when the sitemap also listed it. | The start URL is marked as seen before the seeds are queued. Integration test. |
| 15 | Fixture `/not-html` served as PDF made Chromium start a download, which hid the not-HTML path. | Served as `text/plain`; the `not-html` status is tested. |
| 16 | The Playwright helper had no in-process test. | `test/integration/playwright-helper.test.ts` runs it in the bundled Chromium; the README example also runs under Playwright Test against the built package. |
| 17 | The feed size limit of 200 MiB allowed very large in-memory parses. | Lowered to 100 MiB; README and SECURITY.md updated. |

## Pass 2: security and hostile input

### What was checked

The threat model in SECURITY.md line by line, from the point of view of a
hostile website, a hostile feed, mapping or URL-list file, and a hostile
contributor: SSRF paths (every IP spelling, DNS answers, mixed answers,
rebinding, redirects, sub-resources, workers, WebSockets, WebRTC, pop-ups,
prerender, robots.txt and sitemap redirects, sitemaps that point elsewhere),
the guard proxy, resource exhaustion (responses, gzip bombs in responses and
sitemaps, byte budget in both directions, CSV and XML limits, very long feed
values), the in-page collector, selectors flowing from page to Playwright,
report escaping, CSV formula injection, file writing, terminal output, the
GitHub Action, the Docker image and the supply chain.

Each control was removed in turn to prove that a test fails without it, then
restored. Result: every removal was caught.

| Control removed | Caught by |
| --- | --- |
| Isolated world for the collector | `scan.test.ts` "isolated world" |
| Guard proxy | `scan.test.ts` redirects, SSRF vectors, launch options |
| Route check | `scan.test.ts` SSRF vectors (route-stage refusals) |
| Pop-up closing | `scan.test.ts` "closes pages opened by the scanned page" |
| Per-response size cap in the proxy | `scan.test.ts`, `network.test.ts` |
| Byte budget in the proxy | `scan.test.ts` "total bytes" |
| Gzip output cap for sitemaps | `sitemap.test.ts` |
| Terminal control-character removal | `cli.test.ts` |
| Action output validation | `cli.test.ts` |
| HTML escaping | `report.test.ts` |
| CSV formula neutralisation | `feeds.test.ts` |
| XML DOCTYPE refusal | `feeds.test.ts` |
| robots.txt respect | `scan.test.ts` |
| Plain-CSS selector check | `sanitize.test.ts` |
| `O_NOFOLLOW` on report files | `report.test.ts` |
| Metadata addresses never allow-listable | `guard.test.ts`, `scan.test.ts` |
| Sandbox on by default | `scan.test.ts` |
| Credential header stripping | `network.test.ts` |
| CSV cell cap, XML depth cap | `feeds.test.ts` |
| Screenshot path pattern | `report.test.ts` |
| Mapping key allow-list | `feeds.test.ts` |
| Party text length cap | `detect.test.ts` (timing) |
| Evaluation deadline | `scan.test.ts` "blocks its main thread" |
| Same-origin sitemap entries and redirects | `sitemap.test.ts` "own origin" |

### Found and fixed

| # | Finding | Fix |
| --- | --- | --- |
| 1 | The collector ran in the page's own JavaScript world. A page could replace built-ins (`Array.from`, `String.prototype.slice`, `getComputedStyle`, `JSON.stringify`, `textContent` getters) to break collection or to make it return very large values to Node despite its caps. | The scanner runs the collector and the link reader in an isolated world created through the DevTools Protocol (`Page.createIsolatedWorld`, `Runtime.evaluate` with `returnByValue`), like an extension's content script. Page scripts cannot reach its built-ins, so its caps hold; Node still re-validates everything. Fixture `hostile-dom.html` now checks that tampering has no effect, and `hostile-loop.html` that a page blocking its main thread fails alone after the 15 s deadline. |
| 2 | Very long feed values (one cell can hold 1 000 000 characters) reached address and email regular expressions, where a pattern such as `[A-Za-z0-9._%+-]+@` scans quadratically. | Party text is cut to 3000 characters before any pattern runs; other inputs were already sliced (labels 4000, addresses 2000, emails 5000). Timing tests with 500 000-character values. |
| 3 | The disguised-email pattern accepted a spelled " at " with a plain dot, so prose ("care at home. Visit") counted as an email address. | Two patterns: a bracketed "at" with any dot, or a spelled "at" only with a spelled "dot". Test. |
| 4 | Label matching tried every phrase against every block (about 600 regular expressions per block, and again for each following block), a cost a large hostile page could multiply. | Phrases are grouped by first character, and each block's label is computed once per page. |
| 5 | The pop-up test passed even with pop-up closing removed (the crawl also closes leftover pages after each page), and the SSRF test passed with the route check removed (the proxy still refused everything). | A direct browser-session test for pop-ups, and assertions that sub-resources are refused at the route stage. Both now fail when their control is removed. |
| 6 | The screenshot-path test passed with the path pattern removed (the real-path check still applied). | A JPEG inside the report directory that is not a screenshot must not be embedded. |
| 7 | The sandbox default and the launch options were not directly tested. | `launchOptions` and `sandboxSetting` are pure and tested: sandbox on unless explicitly off, no `--no-sandbox` or similar flag, all traffic through the proxy. |
| 8 | `labelOf` used `indexOf` of a page-supplied lead text without checking for -1. | Guarded. |
| 9 | The same-origin checks for sitemap entries and for sitemap redirects were not tested on their own (the guard refused the internal targets anyway). | A sitemap test with a second reachable host: sitemaps listed in robots.txt or an index on that host are never fetched, a redirect to it is not used, and its URLs are not collected. |

### Checked and left as is (documented residual risks)

- HTTPS responses pass the proxy as encrypted tunnels; the per-response size
  cap applies to plain HTTP, robots.txt and sitemaps, and HTTPS is bounded by
  the total byte budget and timeouts.
- A page can show the scanner different content from what visitors see.
- `--allow-address` opens every port of that address.
- Chromium's own sandbox is off inside the Docker image; the container is the
  boundary. The image was built and run with `--cap-drop=ALL --security-opt
  no-new-privileges --read-only --tmpfs /tmp --tmpfs /home/node --memory 2g
  --pids-limit 512`, as user `node` (uid 1000): a feed check and a URL-list
  scan against a server on the Docker host (allowed with `--allow-address`)
  worked, and a metadata URL in the same list was refused.
- The Playwright helper uses the page's own world in browsers without the
  DevTools Protocol; there the page belongs to the user's own tests.
- The GitHub Action was not run on GitHub (nothing is published); its
  behaviour is covered by unit tests of the entry point and of `action.yml`.

## Release checks

- The README quick start was run from a packed tarball in an empty directory:
  `npm install <tarball>`, `npx playwright-core install
  chromium-headless-shell`, `npx safeshelf feed products.csv --format
  woocommerce`, and `npx safeshelf scan <local fixture shop> --sitemap
  --max-products 5 --allow-address 127.0.0.1`; the library and the
  `/playwright` entry point were imported from the installed package.
- The tarball holds `dist`, `schema` and the licence and policy files only.

## For the independent review

- Interpretation choices that are not in the text: a brand alone is `review`
  (it may be the manufacturer's registered trade mark); a web address or
  contact link counts as an electronic address with medium confidence (the
  Regulation does not define the term); collapsed content counts as found with
  lower confidence; an importer or authorised representative counts as the
  responsible person (Regulation (EU) 2019/1020 Art. 4(2)); EEA countries are
  treated as unknown for "established in the Union".
- Translation phrase lists (23 languages besides English) and the country,
  street-word, legal-form and add-to-cart lists need native review.
- Shopify column names older than the current help page ("Handle", "Body
  (HTML)", "Variant SKU", "Variant Barcode", "Image Src") are from older
  exports; the help page shows only "Barcode" as the older name of
  "Barcodes".
- The Google TSV form of `product_detail` ("section:attribute:value") is the
  maintainers' reading of the specification.
- The attribution link in reports and `--help` points to https://afkzonagroup.lt.

## Independent review

A separate review of the 0.1.0 build, made without relying on the two passes
above or on the README. Everything below was checked against the code, the
official texts and test runs. Each fix is its own commit with a regression
test; every security control was removed once to confirm that a test fails.

State after the review: `npm run check` passes (typecheck, lint, 721 tests in
16 files); line coverage 96.9 % (statements 93.2 %, branches 86.3 %);
`npm audit --omit=dev` reports 0 vulnerabilities.

### Law

Checked against EUR-Lex: the GPSR as published in the Official Journal
(CELEX 32023R0988) and in the consolidated text of 29.05.2026 (CELEX
02023R0988-20260529, amended by Regulation (EU) 2024/2748), and Regulation
(EU) 2019/1020 in the consolidated text of 12.08.2026. Articles 2(1), 3, 4,
9(5) to (7), 16, 19, 22(9) of the GPSR and Article 4 of Regulation (EU)
2019/1020 were read in full. All 21 quotes in `src/legal/provisions.ts` were
compared with freshly downloaded texts: all verbatim. The element-to-point
mapping (Art. 19(a) to (d), Art. 22(9)(a) to (d)) and the "conditional" flags
(responsible person, warnings) match the text. The consolidated GPSR changes
Art. 2(1)(b) to also exclude the new Chapter IIa; Art. 19 stays in Chapter III
Section 2.

Interpretation choices:

| Choice | Verdict |
| --- | --- |
| A brand alone gives `review` | Defensible. Art. 19(a) accepts a "registered trade mark of the manufacturer", but a brand on a page does not show that it is the manufacturer's registered mark. `review` with medium confidence is the honest answer. |
| A web link is a medium-confidence electronic address | Defensible with a limit. The Regulation does not define "electronic address"; a contact form or a visible web address can plausibly qualify, an email clearly does. Before this review any link in a party block counted, including a link on the name to the shop's own brand page; now only contact links and visible web addresses count (finding D11). |
| Collapsed content counts as found | Defensible as implemented: found with lower confidence and an explanation that "clearly and visibly" (Art. 19) is a judgement; for marketplaces the explanation also quotes "displayed or otherwise made easily accessible" (Art. 22(9)). |
| Importer or authorised representative counts as the responsible person | Defensible. GPSR Art. 16(1) applies Regulation (EU) 2019/1020 Art. 4(2): an importer where the manufacturer is not established in the Union (point (b)) and an authorised representative with a written mandate (point (c)) are the economic operator of Art. 4(1), which Art. 19(b) refers to. A fulfilment service provider (point (d)) is now recognised too (finding L4). |
| EEA establishment is unknown | Correct choice. Whether "established in the Union" covers Iceland, Liechtenstein and Norway depends on the EEA Agreement; the tool does not assess it and says so. |
| A SKU is a medium-confidence identifier | Defensible. Art. 19(c) asks for "any other product identifier"; a SKU may be the shop's own code. The same now applies to an ASIN. |
| No identifier but a type gives `review`; no warnings gives `review` | Defensible: "any other product identifier" and "any warning or safety information ... in accordance with this Regulation or the applicable Union harmonisation legislation" apply only where the product has them (see also Art. 9(7), second sentence). |

Nothing in the README or the reports claims compliance or unsafety. Two
statements claimed slightly more than the text (L1, L2) and were corrected.

### Detection quality

A corpus of 26 product pages written like real shops is now part of the tests
(`test/fixtures/shop/corpus`, hand-labelled truth in `truth.json`,
`test/integration/corpus.test.ts`, scanned through the full scanner): Shopify
(Dawn accordions, metafield rows), WooCommerce (tabs with `aria-controls`,
attribute tables, an empty tab that loads on click), PrestaShop, Magento,
Amazon-, eBay-, Etsy- and Fnac-style marketplace listings, Bootstrap collapse;
in English, German, French, Spanish, Italian, Dutch, Polish, Lithuanian,
Swedish, Czech and Finnish; information in tabs, accordions, `<br>`-separated
lines, definition lists, JSON-LD only, an image, a dialog that loads on click,
a PDF link, and missing; traps: a privacy notice, a stock warning, "Type: Phone
case", "Manufacturer warranty", a seller box and a 6000-item mega menu.

Pages c01 to c20 were written first and the detection was fixed against them.
Pages h21 to h25 were written afterwards, before any further change, as a
held-out check. c26 was added for the mega-menu fix.

- c01 to c20, status per item right (of 200): **189 before**, **199 after**.
  The remaining one is a deliberate `review` (c18: the type is only given as
  "Référence fabricant").
- h21 to h25, held out (of 50): **47** on first run; **50** after fixes D8, D9
  and D10.
- All 26 pages after the review: 259 of 260. With c27 and c28 (added for
  L4): 279 of 280.

"Found" precision and recall per item on all 28 pages after the review (found
or found-not-visible counts as detected; information in an image, a PDF or
loaded on click counts as present, so it shows up as a miss):

| Item | TP | FP | FN | Review | Precision | Recall | Recall on readable text |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Manufacturer name | 21 | 0 | 3 | 3 | 1.00 | 0.88 | 1.00 |
| Manufacturer postal address | 20 | 0 | 3 | 0 | 1.00 | 0.87 | 1.00 |
| Manufacturer electronic address | 20 | 0 | 3 | 0 | 1.00 | 0.87 | 1.00 |
| Responsible person name | 6 | 0 | 3 | 8 | 1.00 | 0.67 | 1.00 |
| Responsible person postal address | 6 | 0 | 3 | 8 | 1.00 | 0.67 | 1.00 |
| Responsible person electronic address | 6 | 0 | 3 | 8 | 1.00 | 0.67 | 1.00 |
| Picture | 28 | 0 | 0 | 0 | 1.00 | 1.00 | 1.00 |
| Type | 16 | 0 | 1 | 12 | 1.00 | 0.94 | 0.94 |
| Other identifier | 23 | 0 | 0 | 0 | 1.00 | 1.00 | 1.00 |
| Warnings | 17 | 0 | 2 | 11 | 1.00 | 0.89 | 0.94 |

The same measure on c01 to c20 with the original code: manufacturer name
P 1.00 / R 0.75, postal and electronic address R 0.81, responsible person name
and electronic address P 0.80 / R 0.57, type P 0.90 / R 0.90, identifier
R 0.80, warnings P 0.86 / R 0.92, plus one visibility error (a JSON-LD-only
manufacturer reported as visible). The misses that remain are the three pages
whose information is not in readable text (image, click-to-load dialog, empty
tab), which the tool reports as not found with a note, and one PDF-only
warning, which is now `review`.

A real Shopify shop (three product pages, through the packed CLI) confirmed
the brand-only `review`, a hidden JSON-LD SKU and the picture evidence issue
fixed in D13. The corpus is small and written by the reviewer; the numbers
show the kinds of errors, not a population rate.

### Findings

Severity: High (wrong or unsafe in normal use), Medium, Low, Info.

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| P1 | Medium | `release.yml` ran `npm run check` (Chromium integration tests) without installing Chromium or allowing user namespaces, so every release run would fail; neither workflow built the package or checked the packed file list. (From a clean clone the package was not empty: `.npmrc` has no `ignore-scripts`, so `prepack` builds; but nothing guarded it.) | Fixed: both workflows install Chromium, set the AppArmor sysctl, run `npm run build`, `npm pack --dry-run --json` and `scripts/check-pack.mjs` (also requires LICENSE-ADDITIONAL-TERMS.md and README.md); tests check the order of the steps and the script. |
| C1 | Medium | README and COMMERCIAL.md offered a hosted dashboard, monitoring, SSO, roles, audit evidence packs, a legal-update feed and SLA support, none of which exists. | Fixed: replaced with the commercial licence, integration, custom connectors and features, and support agreements. |
| D1 | Medium | `<br>`-separated "Label: value" lines in one block were read as one label: later labels (EAN, reference) were lost, and the name after an inline label ran into the address. | Fixed: blocks split at lines that start with a label; values keep their lines; a label alone on its first line takes the following lines. |
| D2 | Medium | A party name followed by " – address" was not cut, so the manufacturer name was not found. | Fixed. |
| D3 | Medium | Structured data counted as shown when the name appeared inside another word ("Ora" in "decorative"), reporting `found` instead of `found-not-visible`. | Fixed: whole-word match. |
| D4 | Medium | Shop notices under "Warning:", "Attenzione:" ("only 3 left in stock", "free delivery over 49 €") were taken for safety information. | Fixed: stock, price, delivery and cookie notices are ignored. |
| D5 | Medium | A privacy notice ("Responsabile del trattamento: ...") was read as the responsible person, with its email. | Fixed: data-protection roles excluded. |
| D6 | Low | "Type: Phone case" (a category) was found as the type. | Fixed: a "Type" label without digits gives `review`. |
| D7 | Low | Amazon-style "Item model number" and "ASIN" were not read. | Fixed. |
| D8 | Low | "EAN-Code", "EAN-koodi", "ean13" were not read (held-out page). | Fixed for identifier labels only ("Type-C:" stays unread). |
| D9 | Low | A warnings tab holding only a link to a PDF was `found`. | Fixed: `review` with a note. |
| D10 | Low | Common countries of origin were missing in most languages ("Turcja", "Chiny"), lowering address scores and leaving establishment unknown. | Fixed for China, Turkey, United Kingdom, United States; the lists still need native review. |
| D11 | Low | Any web link in a party block, including a link on the name to the shop's brand page, counted as the electronic address. | Fixed: contact links and visible web addresses only. |
| D12 | Medium | A large menu before the main content used up the 4000-block cap, so the product information was never read (not found, low confidence). | Fixed: the collector reads the main content first and restores reading order. |
| D13 | Low | Picture evidence showed a wide banner or another product first (real shop). | Fixed: wide banners are medium; pictures named like the product come first. |
| S1 | Medium | REVIEW.md said every control removal was caught, but these survived removal: proxy response budget (unit level), CONNECT budget in both directions, fetcher budget, total deadline against a slow sender, service-worker block, download refusal, WebSocket route, WebRTC and background-networking flags, feed file size and regular-file checks, URL-list file size, screenshot size cap. | Fixed: tests added; each now fails when its control is removed. |
| S2 | Low | Bytes sent in the same packet as a CONNECT request were not charged to the budget. | Fixed. |
| S3 | Low | A symlinked output directory was followed, and an existing hard-linked report file would be overwritten in place. | Fixed: both refused. |
| S4 | Low | A 100 MiB CSV of empty cells used 1.6 GB of memory and produced 104 857 report notes. | Fixed: 30 000 000-cell cap (now 0.8 GB peak, refused); skipped rows and items summarised in one note. |
| S5 | Info | XML and CSV feeds are parsed in memory: about 1.8 GB for a 45 MB XML feed with 2.8 million elements. | Open; documented in README and SECURITY.md (allow about 2 GB; `--memory 3g` in Docker). A streaming reader would remove it. |
| S6 | Info | robots.txt user-agent values matched the product token by prefix (an empty value matched). | Fixed: whole-token match (RFC 9309 2.2.1). |
| S7 | Info | A hostile page with 300 000 elements exceeds the 15 s evaluation deadline, and 20 000-deep nesting crashes the renderer; in both cases that page fails and the scan continues. | Accepted (by design). |
| S8 | Info | JSON-LD arrays are read up to 1000 entries, so a product beyond entry 1000 of an `@graph` is not seen. | Open (hostile pages only). |
| L1 | Low | README and the Art. 2(1) provision note said Art. 19 applies to harmonised products without the first-subparagraph limit (specific Union rules with the same objective prevail). | Fixed. |
| L2 | Low | README summarised Art. 22(9) as "display them", leaving out "or otherwise made easily accessible". | Fixed. |
| L4 | Low | A fulfilment service provider (Regulation (EU) 2019/1020 Art. 4(2)(d)) was not recognised as a responsible-person label. | Fixed: labels in all 24 languages, taken from the defined term of GPSR Art. 3, point (12) (`official-text`, checked against the stored definition in each language; English and spelling variants are `original` or `translation`); the same confidence handling as importer and authorised-representative labels, with a note citing Art. 4(2)(d) and its condition. Because the official terms in several languages are general logistics words ("logisztikai szolgáltató", "prestador de servicios logísticos"), a section counts only when it holds an email or a postal address and is not a delivery notice. Unit tests, feed-column mapping, and corpus pages c27 (provider with details: found, high) and c28 (the word only in delivery text: not found). |
| D14 | Low | Image names were matched against logo and icon words as substrings, so a product picture with "Silicone" in its alt text was dropped (found while adding c28). | Fixed: whole words only. |

### Security controls removed one at a time

Each control below was removed (or weakened), the relevant tests were run,
and the control was restored. All were caught after the tests added above.

Network guard: address check, every DNS answer checked, metadata never
allow-listed, scheme, credentials, internal names, single-label names, IPv4
link-local range, IPv6 unique-local, IPv4-mapped IPv6, AWS IPv6 metadata;
proxy HTTP and CONNECT checks, address pinning in the proxy (HTTP and CONNECT)
and in the fetcher, proxy credentials, WebSocket upgrade refusal, method
allow-list, proxy response cap and budget, CONNECT budget, request-body
budget, fetcher response cap, budget, deadline and decompression cap, header
stripping. Browser: sandbox default and launch option, isolated world, route
check, WebSocket route, service-worker block, download refusal, pop-up
closing, `<-loopback>` proxy bypass rule, WebRTC flags, evaluation deadline,
same-origin crawl, robots.txt. Files and inputs: XML DOCTYPE, unknown
entities, depth, element and text caps; CSV row, column, cell-length and cell
caps; formula neutralisation (including tab); feed file size and regular-file
checks; mapping size and key allow-list; URL-list count and file size;
`--allow-address` validation. Reports: HTML escaping, CSP, http(s)-only links,
screenshot path pattern, real-path containment, JPEG magic bytes, image size
cap, `O_NOFOLLOW`, hard-link refusal, symlinked output and `screenshots`
directories, safe file names, file and directory modes. Action and CLI:
output count validation, control characters in the output path, terminal
control characters, collector selector, link and panel-index validation and
block cap.

Also checked by hand: hostile pages with 300 000 elements, 20 000-deep
nesting, a 50 MB text node with 200 000 text nodes, 200 000-deep JSON-LD
arrays, a reload and pop-up loop (each fails or is read alone; the next page
is checked normally); the Docker image built and run with `--cap-drop=ALL
--security-opt no-new-privileges --read-only --tmpfs /tmp --tmpfs /home/node
--memory 2g --pids-limit 512` as uid 1000 (feed check, a scan of a public shop,
and a refused metadata URL).

### Packaging

From a clean clone: `npm ci --ignore-scripts`, Chromium install, `npm run
check`, `npm run build`, `npm pack --dry-run --json` and
`scripts/check-pack.mjs` (104 files, all 11 entry points), `npm audit
--omit=dev` (0). The packed tarball was installed in an empty directory and
the README quick start was run for real: `npx playwright-core install
chromium-headless-shell`, `npx safeshelf feed products.csv --format
woocommerce` (four report files), and `npx safeshelf scan <public shop>
--sitemap --max-products 3`.

### Repository hygiene

The publish gate's forbidden-word check over every tracked file finds
nothing; every commit is by the configured user, without co-author or
generator lines. No raw bidi,
zero-width or BOM characters (hygiene test). LICENSE references
LICENSE-ADDITIONAL-TERMS.md, which carries the section 7(b) attribution
"Safeshelf by AFKzona Group" with its link; the HTML report footer and
`--help` show it.

### Not verified

- The GitHub Action and the workflows were not run on GitHub (nothing is
  published); the AppArmor step and the Action are covered by unit tests only.
- Commission guidance on "electronic address" and on content behind tabs was
  not consulted; the verdicts above rest on the Regulation's text.
- The label, country, street-word and notice lists in languages other than
  English need native review.
- Windows (where `O_NOFOLLOW` does not exist) was not tested.

## Coordinator review (8 Nov 2026)

Accepted. L4 (fulfilment service provider, Regulation (EU) 2019/1020 Art. 4(2)(d)) was closed at my request before publishing. I added the release-workflow step that skips a version already on npm, as in the other packages. Checked:
- the commercial wording is corrected;
- release and CI build, pack and check the tarball, and install Chromium with the userns sysctl;
- the only author is antonmacius-droid;
- `npm run check` passes with 721 tests.
