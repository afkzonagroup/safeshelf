// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Sitemaps (sitemaps.org protocol): sitemap index files and URL sets, plain
 * or gzip-compressed. Every request goes through the SSRF guard; sizes,
 * counts and decompressed sizes are capped.
 */

import zlib from 'node:zlib';
import { BlockedRequestError } from '../net/guard.js';
import { guardedGet, type NetContext } from '../net/get.js';
import { PLAIN_USER_AGENT } from '../net/robots-fetch.js';
import { childrenNamed, localName, parseXml, textOf } from '../feeds/xml.js';

/** Limits for sitemap reading. */
export interface SitemapLimits {
  /** Sitemap documents fetched, at most. */
  readonly maxDocuments: number;
  /** URLs collected, at most. */
  readonly maxUrls: number;
  /** Size of one sitemap after decompression, in bytes. */
  readonly maxBytes: number;
}

/** Defaults: 20 documents, 50 000 URLs, 20 MiB per document. */
export const DEFAULT_SITEMAP_LIMITS: SitemapLimits = Object.freeze({ maxDocuments: 20, maxUrls: 50_000, maxBytes: 20 * 1024 * 1024 });

/** A parsed sitemap document. */
export interface ParsedSitemap {
  readonly kind: 'index' | 'urlset';
  readonly locations: readonly string[];
}

/** Parse a sitemap or sitemap index. Returns null for anything else. Pure. */
export function parseSitemap(xml: string, maxLocations: number): ParsedSitemap | null {
  let root;
  try {
    root = parseXml(xml);
  } catch {
    return null;
  }
  const kind = localName(root.name);
  if (kind !== 'sitemapindex' && kind !== 'urlset') return null;
  const entries = childrenNamed(root, kind === 'sitemapindex' ? 'sitemap' : 'url');
  const locations: string[] = [];
  for (const e of entries) {
    if (locations.length >= maxLocations) break;
    const loc = childrenNamed(e, 'loc')[0];
    if (loc === undefined) continue;
    const value = textOf(loc);
    if (/^https?:\/\//i.test(value) && value.length <= 2048) locations.push(value);
  }
  return { kind: kind === 'sitemapindex' ? 'index' : 'urlset', locations };
}

/** Decompress gzip data with an output cap. */
export function gunzipCapped(data: Buffer, maxBytes: number): Buffer {
  try {
    return zlib.gunzipSync(data, { maxOutputLength: maxBytes });
  } catch (error) {
    if (error instanceof RangeError) throw new BlockedRequestError(`Decompressed sitemap exceeds ${String(maxBytes)} bytes`, 'size');
    throw new BlockedRequestError('Sitemap could not be decompressed', 'encoding');
  }
}

const PRODUCT_HINT = /product|produkt|produit|producto|prodotto|artikel|item|shop/i;

/** True if a URL is on the given origin. Pure. */
export function sameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

/**
 * Collect same-origin page URLs from sitemaps. Starts from the given sitemap
 * URLs (from robots.txt) or `/sitemap.xml`. Sitemaps whose URL suggests
 * products are read first. Errors on single documents are reported as notes.
 */
export async function collectSitemapUrls(origin: string, starts: readonly string[], ctx: NetContext, limits: SitemapLimits = DEFAULT_SITEMAP_LIMITS): Promise<{ urls: string[]; notes: string[] }> {
  const queue = [...new Set([...starts.filter((s) => sameOrigin(s, origin)), `${origin}/sitemap.xml`])];
  const seen = new Set<string>();
  const urls = new Set<string>();
  const notes: string[] = [];
  let documents = 0;
  while (queue.length > 0 && documents < limits.maxDocuments && urls.size < limits.maxUrls) {
    queue.sort((a, b) => Number(PRODUCT_HINT.test(b)) - Number(PRODUCT_HINT.test(a)));
    const next = queue.shift();
    if (next === undefined || seen.has(next)) continue;
    seen.add(next);
    documents += 1;
    let body: Buffer;
    try {
      const res = await guardedGet(next, ctx, { 'user-agent': PLAIN_USER_AGENT, accept: 'application/xml, text/xml;q=0.9, */*;q=0.1' }, limits.maxBytes);
      if (res.status !== 200) {
        notes.push(`Sitemap ${next.slice(0, 200)} returned HTTP ${String(res.status)}.`);
        continue;
      }
      if (!sameOrigin(res.finalUrl, origin)) {
        notes.push(`Sitemap ${next.slice(0, 200)} redirected to another site and was not used.`);
        continue;
      }
      body = res.body[0] === 0x1f && res.body[1] === 0x8b ? gunzipCapped(res.body, limits.maxBytes) : res.body;
    } catch (error) {
      notes.push(`Sitemap ${next.slice(0, 200)} could not be read (${error instanceof BlockedRequestError ? error.reason : 'error'}).`);
      continue;
    }
    const parsed = parseSitemap(body.toString('utf8'), limits.maxUrls);
    if (parsed === null) {
      notes.push(`Sitemap ${next.slice(0, 200)} is not a sitemap document.`);
      continue;
    }
    for (const loc of parsed.locations) {
      if (!sameOrigin(loc, origin)) continue;
      if (parsed.kind === 'index') {
        if (!seen.has(loc) && queue.length < 1000) queue.push(loc);
      } else if (urls.size < limits.maxUrls) urls.add(loc);
    }
  }
  if (queue.length > 0 && documents >= limits.maxDocuments) notes.push(`Only the first ${String(limits.maxDocuments)} sitemap documents were read.`);
  return { urls: [...urls], notes };
}
