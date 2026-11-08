// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Self-contained HTML report. No scripts. Every dynamic value is escaped,
 * including numbers: `renderHtmlReport` may be given a report parsed from an
 * untrusted JSON file, where any field can hold any type. Screenshots are
 * embedded as data URIs with per-image and total size caps. A
 * Content-Security-Policy meta tag allows only the inline style (by hash) and
 * data: images.
 */

import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { ELEMENTS, provisionFor } from '../legal/elements.js';
import { PROVISIONS } from '../legal/provisions.js';
import { ELEMENT_IDS, isElementId, type ElementResult, type Evidence, type SalesContext } from '../types.js';
import { DISCLAIMER, type ProductResult, type SafeshelfReport } from './types.js';

/** Attribution required by LICENSE-ADDITIONAL-TERMS.md (AGPL-3.0 section 7(b)). */
export const ATTRIBUTION = Object.freeze({ text: 'Safeshelf by AFKzona Group', url: 'https://afkzonagroup.lt' });

/** Product cards rendered at most; the JSON and CSV reports always list every product. */
export const MAX_HTML_PRODUCTS = 2000;

/** Size caps for embedded images. */
export const IMAGE_LIMITS = Object.freeze({ maxImageBytes: 400 * 1024, maxTotalBytes: 12 * 1024 * 1024 });

/** Escape text for HTML element content and quoted attribute values. */
export function escapeHtml(value: unknown): string {
  // String() keeps a non-string from an untrusted report from throwing or passing through.
  return String(value).replace(/[&<>"'`]/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return '&#96;';
    }
  });
}

/** Return the URL if it is http(s) and parses; otherwise null (rendered as text, not a link). */
export function safeHref(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

const SCREENSHOT_PATH = /^screenshots\/E\d{4,6}\.jpg$/;
const STATUS_CLASS = new Set(['found', 'found-not-visible', 'not-found', 'not-applicable', 'review']);
const STATUS_LABEL: Readonly<Record<string, string>> = {
  found: 'Found',
  'found-not-visible': 'Not visible',
  'not-found': 'Not found',
  'not-applicable': 'Not applicable',
  review: 'Review',
};

const CSS = `
:root{--bg:#fff;--fg:#1b1d21;--muted:#5b616e;--line:#dfe2e7;--card:#f7f8fa;--ok:#17663a;--warn:#8a5300;--bad:#a3142b;--info:#2d5b8a;--na:#5b616e;--link:#1a56b5}
@media (prefers-color-scheme:dark){:root{--bg:#121417;--fg:#e8eaed;--muted:#a3a9b5;--line:#2c3038;--card:#1a1d22;--ok:#7fd6a0;--warn:#ffc266;--bad:#ff8a9a;--info:#8ab8ff;--na:#a3a9b5;--link:#8ab4ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1040px;margin:0 auto;padding:24px 16px 48px}h1{font-size:24px;margin:0 0 4px}h2{font-size:18px;margin:32px 0 12px}h3{font-size:16px;margin:0}
a{color:var(--link)}p{margin:6px 0;overflow-wrap:anywhere}.muted{color:var(--muted)}.summary{display:flex;flex-wrap:wrap;gap:24px;margin:16px 0}
.product{border-top:1px solid var(--line);padding:18px 0}.head{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.st{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap}
.found{color:var(--ok)}.found-not-visible{color:var(--warn)}.not-found{color:var(--bad)}.review{color:var(--info)}.not-applicable{color:var(--na)}
code{font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}
table{border-collapse:collapse;width:100%;table-layout:fixed;margin:8px 0}td,th{border-top:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}
th{font-weight:600}.el td:first-child{width:24%}.el td:nth-child(2){width:16%}.counts td:first-child{width:34%}
ul{margin:4px 0;padding-left:18px}li{margin:2px 0;overflow-wrap:anywhere}img{max-width:100%;height:auto;border:1px solid var(--line);margin-top:6px;display:block}
footer{margin-top:40px;border-top:1px solid var(--line);padding-top:12px;font-size:13px;color:var(--muted)}
@media (max-width:640px){.el td,.el th{display:block;width:auto!important;border:0;padding:2px 0}.el tr{display:block;border-top:1px solid var(--line);padding:8px 0}.el thead{display:none}}
`;

/** Options for rendering. */
export interface HtmlOptions {
  /**
   * Directory the report's screenshot paths are relative to. Only paths of
   * the form `screenshots/E0001.jpg` are read, and only inside this directory.
   */
  readonly baseDir?: string;
}

async function loadImages(products: readonly ProductResult[], baseDir: string | undefined): Promise<Map<string, string>> {
  const images = new Map<string, string>();
  if (baseDir === undefined) return images;
  let realBase: string;
  try {
    realBase = await realpath(baseDir);
  } catch {
    return images;
  }
  let total = 0;
  const paths = new Set<string>();
  for (const p of products) for (const e of p.elements) for (const ev of e.evidence) if (typeof ev.screenshot === 'string') paths.add(ev.screenshot);
  for (const rel of paths) {
    if (!SCREENSHOT_PATH.test(rel)) continue;
    try {
      const file = await realpath(path.join(realBase, rel));
      if (!file.startsWith(realBase + path.sep)) continue;
      const data = await readFile(file);
      if (data.length > IMAGE_LIMITS.maxImageBytes || total + data.length > IMAGE_LIMITS.maxTotalBytes) continue;
      if (data[0] !== 0xff || data[1] !== 0xd8) continue; // JPEG magic bytes only
      total += data.length;
      images.set(rel, `data:image/jpeg;base64,${data.toString('base64')}`);
    } catch {
      // Missing or unreadable screenshot: render without it.
    }
  }
  return images;
}

const e = escapeHtml;

/** True for a non-null, non-array object. Used on values from an untrusted report. */
function isRecord(v: unknown): boolean {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The array if it is one, else empty; only object entries are kept. */
function records<T>(v: readonly T[] | undefined): readonly T[] {
  return Array.isArray(v) ? (v as readonly T[]).filter(isRecord) : [];
}

function link(url: unknown, text: unknown): string {
  const href = safeHref(url);
  return href === null ? e(text) : `<a href="${e(href)}" rel="noopener noreferrer">${e(text)}</a>`;
}

function renderEvidence(ev: Evidence, images: ReadonlyMap<string, string>): string {
  const where = [ev.source, ev.visibility, ev.label === undefined ? '' : `label "${ev.label}" (${ev.labelLanguage ?? '?'}, ${ev.labelSource ?? '?'})`, ev.field, ev.selector]
    .filter((x) => typeof x === 'string' && x !== '')
    .map((x) => e(x));
  const img = typeof ev.screenshot === 'string' ? images.get(ev.screenshot) : undefined;
  return `<li>${e(ev.text)}<br><span class="muted"><code>${where.join(' · ')}</code></span>${img === undefined ? '' : `<img alt="${e('Screenshot of the evidence')}" src="${e(img)}">`}</li>`;
}

function renderElement(r: ElementResult, context: SalesContext, images: ReadonlyMap<string, string>): string {
  const id = typeof r.element === 'string' && isElementId(r.element) ? r.element : null;
  const def = id === null ? undefined : ELEMENTS[id];
  const provision = id === null ? undefined : PROVISIONS[provisionFor(id, context)];
  const status = STATUS_CLASS.has(r.status) ? r.status : '';
  const evidence = records(r.evidence).slice(0, 5);
  return `<tr><td>${e(def?.title ?? r.element)}<br><span class="muted">${provision === undefined ? '' : link(provision.url, provision.citation)}</span></td>
<td><span class="st ${status}">${e(STATUS_LABEL[status] ?? r.status)}</span><br><span class="muted">${e(r.confidence)} confidence</span></td>
<td>${e(r.explanation)}${evidence.length === 0 ? '' : `<ul>${evidence.map((x) => renderEvidence(x, images)).join('')}</ul>`}${status === 'not-found' || status === 'found-not-visible' ? `<p class="muted">${e(def?.fix ?? '')}</p>` : ''}</td></tr>`;
}

function sourceLabel(p: ProductResult): string {
  const s = (isRecord(p.source) ? p.source : {}) as Partial<{ kind: string; url: string; key: string; keyColumn: string; position: number }>;
  if (s.kind === 'page') return link(s.url, s.url);
  return `${e(s.keyColumn ?? 'key')} ${e(s.key ?? '')} <span class="muted">(row ${e(s.position ?? '')})</span>`;
}

function renderProduct(p: ProductResult, context: SalesContext, images: ReadonlyMap<string, string>): string {
  const missing = Array.isArray(p.missing) ? p.missing.length : 0;
  const review = Array.isArray(p.review) ? p.review.length : 0;
  const notes = Array.isArray(p.notes) && p.notes.length > 0 ? `<ul>${p.notes.map((n) => `<li>${e(n)}</li>`).join('')}</ul>` : '';
  return `<section class="product" id="${e(p.id)}">
<div class="head"><h3>${e(p.name === '' ? '(no name)' : p.name)}</h3><span class="muted">${e(p.id)}</span></div>
<p class="muted">${sourceLabel(p)} · ${e(missing)} missing · ${e(review)} to review</p>${notes}
<table class="el"><thead><tr><th>Information</th><th>Result</th><th>Details and evidence</th></tr></thead><tbody>
${records(p.elements).map((r) => renderElement(r, context, images)).join('\n')}
</tbody></table>
</section>`;
}

/**
 * Render a report as one self-contained HTML document.
 *
 * @example
 * ```ts
 * const html = await renderHtmlReport(report, { baseDir: './safeshelf-report' });
 * ```
 */
export async function renderHtmlReport(report: SafeshelfReport, options: HtmlOptions = {}): Promise<string> {
  // The report may come from an untrusted JSON file: every field is checked before use.
  const r: Partial<SafeshelfReport> = report;
  const products = records(r.products);
  const images = await loadImages(products, options.baseDir);
  const styleHash = createHash('sha256').update(CSS).digest('base64');
  const csp = `default-src 'none'; img-src data:; style-src 'sha256-${styleHash}'; base-uri 'none'; form-action 'none'`;
  const context: SalesContext = r.options?.context === 'marketplace' ? 'marketplace' : 'shop';
  const inp = r.input ?? {};
  const input = inp.startUrl !== undefined ? link(inp.startUrl, inp.startUrl) : inp.file !== undefined ? `${e(inp.file)} (${e(inp.format ?? '')})` : `${e(inp.urlCount ?? 0)} URL(s)`;
  const summary: Partial<SafeshelfReport['summary']> = r.summary !== undefined && isRecord(r.summary) ? r.summary : {};
  const byElement: Partial<SafeshelfReport['summary']['byElement']> = summary.byElement !== undefined && isRecord(summary.byElement) ? summary.byElement : {};
  const counts = ELEMENT_IDS.map((id) => {
    const c = byElement[id];
    if (c === undefined || !isRecord(c)) return '';
    return `<tr><td>${e(ELEMENTS[id].title)}</td><td class="found">${e(c.found)}</td><td class="found-not-visible">${e(c['found-not-visible'])}</td><td class="not-found">${e(c['not-found'])}</td><td class="review">${e(c.review)}</td><td class="not-applicable">${e(c['not-applicable'])}</td></tr>`;
  }).join('');
  const pages = records(r.pages)
    .map((p) => `<tr><td>${e(p.url)}</td><td>${e(p.status)}${p.httpStatus === undefined ? '' : ` (${e(p.httpStatus)})`}</td><td>${e(p.reason ?? p.error ?? '')}</td></tr>`)
    .join('');
  const provisions = records(r.provisions)
    .map((p) => `<tr><td>${link(p.url, p.citation)}</td><td>“${e(p.quote)}”<br><span class="muted">${e(p.use)}</span></td></tr>`)
    .join('');
  const notes = (Array.isArray(r.notes) ? r.notes : []).map((n) => `<li>${e(n)}</li>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${e(csp)}">
<meta name="referrer" content="no-referrer">
<title>Safeshelf report</title>
<style>${CSS}</style>
</head>
<body>
<main>
<h1>Safeshelf report</h1>
<p class="muted">${input} · ${e(r.finishedAt)} · ${context === 'marketplace' ? 'marketplace listings (GPSR Art. 22(9))' : 'own offers (GPSR Art. 19)'} · report format ${e(r.schemaVersion)}</p>
<p>${e(DISCLAIMER)}</p>
<div class="summary"><div><strong>${e(summary.products ?? 0)}</strong> products checked</div><div class="not-found"><strong>${e(summary.productsWithMissing ?? 0)}</strong> with information not found or not visible</div><div class="review"><strong>${e(summary.productsWithReview ?? 0)}</strong> with items to review</div></div>
<h2>By item</h2>
<table class="counts"><thead><tr><th>Information</th><th>Found</th><th>Not visible</th><th>Not found</th><th>Review</th><th>Not applicable</th></tr></thead><tbody>${counts}</tbody></table>
<h2>Products</h2>
${products.length === 0 ? '<p>No products were checked.</p>' : products.slice(0, MAX_HTML_PRODUCTS).map((p) => renderProduct(p, context, images)).join('\n')}
${products.length > MAX_HTML_PRODUCTS ? `<p class="muted">Only the first ${e(MAX_HTML_PRODUCTS)} of ${e(products.length)} products are shown here. report.json and missing.csv list all of them.</p>` : ''}
<h2>Provisions</h2>
<table><tbody>${provisions}</tbody></table>
${pages === '' ? '' : `<h2>Pages</h2><table><thead><tr><th>URL</th><th>Status</th><th>Note</th></tr></thead><tbody>${pages}</tbody></table>`}
${notes === '' ? '' : `<h2>Notes</h2><ul>${notes}</ul>`}
<footer><a href="${e(ATTRIBUTION.url)}" rel="noopener noreferrer">${e(ATTRIBUTION.text)}</a> · version ${e(r.tool?.version ?? '')}</footer>
</main>
</body>
</html>
`;
}
