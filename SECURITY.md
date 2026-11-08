# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through **GitHub Security Advisories**
("Report a vulnerability" on the repository's Security tab). Do not open a
public issue. If you cannot use GitHub, email info@afkzonagroup.lt with
"Safeshelf security" in the subject.

We aim to acknowledge reports within 3 working days and to agree a fix and
disclosure date with you. Supported version: the latest 0.x release.

## Threat model

### Assets

- **The machine and network that run the scan**: internal services, cloud
  metadata endpoints, localhost-only admin interfaces. A scanner that fetches
  attacker-chosen URLs is a classic SSRF tool; this is the main asset.
- **The operator's files**: the output directory and anything near it, and
  feed files that may hold unpublished product data.
- **People who open the reports**: the HTML report must not run content from a
  scanned site or a feed; the CSV files must not run formulas in a spreadsheet.
- **CI secrets** when Safeshelf runs as a GitHub Action.
- **Integrity of results**: a hostile page or file should not be able to make
  the report say something other than what Safeshelf read.

### Actors

- **Hostile website**: controls HTML, scripts, redirects, DNS for its own
  domain, response sizes and timing, robots.txt and sitemaps. Assumed to try
  SSRF, DNS rebinding, resource exhaustion, tampering with the in-page
  collector, script injection into reports, and browser exploits.
- **Hostile feed or mapping file**: a product export from a third party (for
  example a supplier or a marketplace), crafted to exhaust memory, exploit the
  XML or CSV reader, or inject formulas or markup into the reports.
- **Untrusted inputs in a shared deployment**: start URLs, URL lists, report
  JSON passed to `renderHtmlReport`.
- **Hostile contributor**: pull requests that weaken a control or add a
  dependency or workflow change.

### Trust boundaries

1. Scanner process and the Chromium renderer running the hostile page.
2. Chromium and the network, crossing the guard (route check, then guard proxy).
3. Plain requests (robots.txt, sitemaps) and the network, crossing the guarded fetcher.
4. Feed, mapping and URL-list files and CLI arguments or action inputs, entering the program.
5. Report files and the person or tool that opens them.

### Mitigations

| Threat | Mitigation | Where | Tested in |
| --- | --- | --- | --- |
| SSRF to private, loopback, link-local, CGNAT, unique-local, multicast, reserved and metadata addresses (169.254.169.254, fd00:ec2::254 and other cloud endpoints) | Every host resolved; every answer checked; one blocked answer blocks the request; allow-list only for exact IPs and never for metadata | `src/net/ip.ts`, `src/net/guard.ts` | `test/unit/ip.test.ts`, `test/unit/guard.test.ts` |
| Alternative IP spellings (decimal, octal, hex, short forms, IPv4-mapped/compatible IPv6, NAT64, 6to4, Teredo, zone ids) | WHATWG URL normalisation plus own inet_aton and IPv6 parsers; embedded IPv4 judged | `src/net/ip.ts` | `test/unit/ip.test.ts` |
| Redirect to an internal address | Browser traffic is forced through the guard proxy, which checks every connection including redirect hops Playwright does not route; robots.txt and sitemap requests follow redirects hop by hop through the guarded fetcher; a sitemap that redirects off-site is not used | `src/net/proxy.ts`, `src/browser/session.ts`, `src/net/get.ts`, `src/crawl/sitemap.ts` | `test/integration/scan.test.ts` ("refuses redirects"), `test/unit/network.test.ts` ("guardedGet") |
| DNS rebinding between check and connect | Proxy and fetcher connect only to the address they checked (custom `lookup`); TLS still verified against the host name | `src/net/proxy.ts`, `src/net/fetcher.ts` | `test/unit/network.test.ts` ("DNS rebinding") |
| Sub-resources, fetch/XHR, iframes, workers, shared workers, beacons, EventSource, form posts, pop-ups, prefetch, prerender, WebSockets, WebRTC, QUIC | Route check on every routed request; the proxy stops what is not routed; WebSockets closed; upgrades and unusual methods refused; QUIC off; WebRTC limited to proxied UDP (none). Each refusal records its stage (`route` or `proxy`) | `src/browser/session.ts`, `src/net/proxy.ts` | `test/integration/scan.test.ts` ("every browser-side SSRF vector", fixture `hostile-ssrf.html`) |
| Proxy abuse by other local processes | Proxy binds 127.0.0.1 on a random port with random credentials, constant-time comparison | `src/net/proxy.ts` | `test/unit/network.test.ts` |
| Non-http(s) schemes, URLs with credentials, internal host names | Refused before any network activity, including the start URL and the first URL of a list | `src/net/guard.ts`, `src/scan.ts` | `test/unit/guard.test.ts`, `test/unit/cli.test.ts` |
| Resource exhaustion by a site | Caps on pages, products, total time, request time, response size, decompressed size (gzip bombs in responses and in `.xml.gz` sitemaps), total bytes in both directions (charged while streaming), redirects, sitemap documents and URLs, collected elements, blocks, JSON-LD size, microdata properties, screenshots | `src/scan.ts`, `src/net/*`, `src/crawl/sitemap.ts`, `src/browser/page-ops.ts` | `test/unit/network.test.ts`, `test/integration/scan.test.ts` |
| Resource exhaustion by a file | Feed files at most 100 MiB; CSV rows, columns, cell length and total cells capped; skipped rows summarised in one note; XML depth, element count and text length capped; DOCTYPE refused (no entity expansion, no external entities); only predefined entities and valid character references; mapping files at most 64 KiB; URL lists at most 1 MiB and 2000 URLs; description HTML read as text with a length cap | `src/feeds/*`, `src/cli/main.ts` | `test/unit/feeds.test.ts`, `test/unit/cli.test.ts` |
| Hostile page tampering with the in-page collector (patched built-ins, wrong types, huge values, endless loops) | The collector runs in an isolated JavaScript world created through the DevTools Protocol, so page scripts cannot replace the built-ins it uses and its caps hold; every value is still re-validated and capped in Node; evaluations have a 15 s deadline after which the page is closed; page-supplied selectors are used only if they are plain CSS. (The Playwright helper uses the page's own world in browsers without the DevTools Protocol; there the page is the user's own.) | `src/browser/page-ops.ts`, `src/browser/sanitize.ts` | `test/integration/scan.test.ts` ("isolated world", "blocks its main thread"), `test/unit/sanitize.test.ts` |
| Credentials leaking to the scanned site | Fresh browser contexts without stored state; `Authorization` and `Proxy-Authorization` stripped by the fetcher; no user cookies or headers accepted | `src/browser/session.ts`, `src/net/fetcher.ts` | `test/unit/network.test.ts` |
| Pop-up floods | Pop-ups closed at once; at most 3 pages per context; every leftover page closed after each checked page | `src/browser/session.ts`, `src/scan.ts` | `test/integration/scan.test.ts` ("closes pop-ups") |
| Script injection into the HTML report | Every value escaped (including numbers and from an untrusted report JSON); only http(s) links; no scripts; CSP `default-src 'none'` with a hashed style; screenshots read only from `screenshots/E0000.jpg` paths inside the report directory, real-path checked, JPEG magic bytes, size caps | `src/report/html.ts` | `test/unit/report.test.ts` |
| Formula injection in CSV output | Every cell quoted; cells starting with `=`, `+`, `-`, `@`, `|`, `%`, tab or carriage return get a leading apostrophe unless they are plain numbers | `src/feeds/csv.ts`, `src/report/csv.ts` | `test/unit/feeds.test.ts` |
| Overwriting files via symlinks or path traversal | Fixed file names, validated; `O_NOFOLLOW`; existing hard-linked report files refused; a symlinked output or `screenshots` directory is refused; directories 0700, files 0600; only the file name of a feed path goes into the report | `src/util/files.ts`, `src/feeds/check.ts` | `test/unit/report.test.ts` |
| Terminal escape sequences from page or file content in CLI output | C0, C1, bidi and zero-width characters replaced in every printed line | `src/cli/main.ts` | `test/unit/cli.test.ts` |
| Browser exploit from a hostile page | Chromium's OS sandbox is on by default and is never turned off silently: if it cannot start, the scan stops with an explanation. Opt-out only by `--no-sandbox` / `SAFESHELF_NO_SANDBOX=1`, meant for containers. In Docker the container is the boundary: non-root user, run with `--cap-drop=ALL --security-opt no-new-privileges --read-only`. The Action keeps the sandbox on and allows unprivileged user namespaces only on GitHub-hosted Linux runners | `src/browser/session.ts`, `src/scan.ts`, `Dockerfile`, `action.yml` | `test/integration/scan.test.ts` (launch errors), `test/unit/cli.test.ts` (action.yml, Dockerfile) |
| Script injection in the GitHub Action | Inputs passed as environment variables to a Node entry point and an argument array; no `${{ }}` inside `run:`; outputs and job summary built from the in-memory report of the current run (a `report.json` in the workspace is never read); outputs are validated integers and the path without control characters; job summary has counts and fixed titles only | `action.yml`, `src/action/entrypoint.ts` | `test/unit/cli.test.ts` |
| Stack traces or internals in CLI output | One-line messages only | `src/cli/main.ts` | `test/unit/cli.test.ts` |
| Code execution from input | No `eval`, `new Function`, dynamic import of input, or child processes with input anywhere; mappings and URL lists are data, validated with allow-lists | all | lint rules in `eslint.config.js` |
| Supply chain | One runtime dependency, pinned; lockfile committed; no install scripts; `files` allow-list; actions pinned by SHA; CI on pull requests and manual runs only, read-only token | `package.json`, `.github/` | `test/unit/hygiene.test.ts`, `npm audit --omit=dev` in CI |

Each network control was removed in turn while writing this file, to confirm
that a test fails without it (see REVIEW.md).

### Residual risks

- Chromium vulnerabilities: keep `playwright-core` updated (Dependabot is configured). Do not run Safeshelf as root outside a container.
- The guard cannot see inside HTTPS tunnels, so per-response size caps apply to plain HTTP, robots.txt and sitemaps; HTTPS traffic is limited by the total byte budget and timeouts.
- `--allow-address` and `allowAddresses` deliberately open a private address, on every port. A scanned page (or a script it loads) can then reach any service on that address. Use them only for your own servers.
- Site cookies set during a scan live in that scan's browser context and are sent back to the same site, as a normal browser would.
- A hostile page can show the scanner different content from what visitors see, which can hide or fake the information; this cannot break out of the controls above.
- Feeds are parsed in memory. A feed near the 100 MiB limit can need about 2 GB (measured: 1.8 GB for a 45 MB XML feed with 2.8 million elements); give the process or container that much, or split very large exports.

## Data flows

Safeshelf sends requests only to the sites you scan (and the resources those
pages load, subject to the guard). Feed checks send nothing anywhere. There is
no telemetry and nothing is sent to AFKzona Group or anyone else. Reports stay
in the output directory you choose. Reports and screenshots can contain
whatever the pages or feeds contain, including names, addresses and email
addresses of manufacturers and responsible persons; treat them as you treat
the source data.
