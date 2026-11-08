// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { guardedGet, type NetContext } from './get.js';
import { ALLOW_ALL, parseRobots, type RobotsRules } from './robots.js';

/** Product token used for robots.txt matching and the User-Agent of plain requests. */
export const ROBOTS_TOKEN = 'Safeshelf';

/** User-Agent sent with robots.txt and sitemap requests. */
export const PLAIN_USER_AGENT = 'Safeshelf/0.1 (+https://github.com/afkzonagroup/safeshelf)';

const DISALLOW_ALL: RobotsRules = Object.freeze({ isAllowed: () => false, sitemaps: [] });

/**
 * Fetch and parse robots.txt for an origin through the SSRF guard. Every
 * redirect hop is checked again. Per RFC 9309: a 4xx or unreadable file
 * allows everything (2.3.1.3); a 5xx disallows everything (2.3.1.4).
 */
export async function fetchRobots(origin: string, ctx: NetContext): Promise<RobotsRules> {
  let res;
  try {
    res = await guardedGet(new URL('/robots.txt', origin).href, ctx, { 'user-agent': PLAIN_USER_AGENT, accept: 'text/plain' }, 512 * 1024);
  } catch {
    return ALLOW_ALL;
  }
  if (res.status >= 500) return DISALLOW_ALL;
  if (res.status !== 200) return ALLOW_ALL;
  return parseRobots(res.body.toString('utf8'), ROBOTS_TOKEN);
}
