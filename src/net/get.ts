// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { guardedFetch, type ByteBudget, type FetchLimits, type FetchedResponse } from './fetcher.js';
import { BlockedRequestError, type NetworkPolicy } from './guard.js';

/** Everything a guarded request needs. */
export interface NetContext {
  readonly policy: NetworkPolicy;
  readonly limits: FetchLimits;
  readonly budget: ByteBudget;
  readonly maxRedirects: number;
}

/** A response after following redirects. */
export interface FollowedResponse extends FetchedResponse {
  /** URL of the last hop. */
  readonly finalUrl: string;
}

/**
 * GET a URL and follow redirects. Every hop goes through {@link guardedFetch},
 * so the SSRF guard checks each new host and address. No cookies or
 * credentials are sent.
 *
 * @throws BlockedRequestError when a hop is refused, a limit is reached or
 *   there are too many redirects.
 */
export async function guardedGet(url: string, ctx: NetContext, headers: Readonly<Record<string, string>>, maxBytes?: number): Promise<FollowedResponse> {
  const limits: FetchLimits = maxBytes === undefined ? ctx.limits : { ...ctx.limits, maxResponseBytes: Math.min(maxBytes, ctx.limits.maxResponseBytes) };
  let current = url;
  for (let hop = 0; hop <= ctx.maxRedirects; hop += 1) {
    const res = await guardedFetch({ url: current, method: 'GET', headers }, ctx.policy, limits, ctx.budget);
    if (res.status >= 300 && res.status < 400 && res.headers.location !== undefined) {
      let next: URL;
      try {
        next = new URL(res.headers.location, current);
      } catch {
        throw new BlockedRequestError('Redirect location does not parse', 'syntax');
      }
      current = next.href;
      continue;
    }
    return { ...res, finalUrl: current };
  }
  throw new BlockedRequestError('Too many redirects', 'redirects');
}
