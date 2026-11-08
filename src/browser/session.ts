// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { chromium, type Browser, type BrowserContext, type BrowserContextOptions, type LaunchOptions, type Route, type Request } from 'playwright-core';
import { BlockedRequestError, checkUrlSyntax, hostOf, resolveAndCheck, type NetworkPolicy } from '../net/guard.js';
import type { ByteBudget, FetchLimits } from '../net/fetcher.js';
import { startGuardProxy, type BlockedRequest, type GuardProxy } from '../net/proxy.js';

/** Options for a browser session. */
export interface SessionOptions {
  readonly policy: NetworkPolicy;
  readonly limits: FetchLimits;
  readonly budget: ByteBudget;
  readonly maxRedirects: number;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly locale: string;
  /** Run Chromium with its OS sandbox. Turn off only inside a container that isolates the process. */
  readonly chromiumSandbox: boolean;
}

/** Chromium flags that keep traffic inside the guard proxy and cut background networking. */
export const CHROMIUM_ARGS: readonly string[] = Object.freeze([
  '--disable-quic',
  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
  '--webrtc-ip-handling-policy=disable_non_proxied_udp',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-domain-reliability',
  '--disable-sync',
  '--no-pings',
]);

/**
 * Launch options: Playwright's bundled Chromium, headless, all traffic through
 * the guard proxy, and the OS sandbox as given (Playwright itself would pass
 * --no-sandbox unless `chromiumSandbox` is true). Pure.
 */
export function launchOptions(chromiumSandbox: boolean, proxy: Pick<GuardProxy, 'server' | 'username' | 'password'>): LaunchOptions {
  return {
    headless: true,
    chromiumSandbox,
    args: [...CHROMIUM_ARGS],
    proxy: { server: proxy.server, username: proxy.username, password: proxy.password, bypass: '<-loopback>' },
    timeout: 60_000,
  };
}

/**
 * Options for every browser context: no stored state, service workers blocked
 * (their requests would not pass the route check), downloads refused, no
 * permissions, certificate errors and the page's CSP kept. Pure.
 */
export function contextOptions(viewport: { readonly width: number; readonly height: number }, locale: string): BrowserContextOptions {
  return {
    serviceWorkers: 'block',
    acceptDownloads: false,
    viewport: { width: viewport.width, height: viewport.height },
    locale,
    permissions: [],
    ignoreHTTPSErrors: false,
    bypassCSP: false,
    javaScriptEnabled: true,
  };
}

const MAX_ROUTE_BLOCK_LOG = 200;
const MAX_PAGES_PER_CONTEXT = 3;

/**
 * A guarded browser. All traffic goes through the guard proxy; in addition,
 * every request Playwright lets us intercept is checked before it is sent.
 */
export class BrowserSession {
  private readonly routeBlocked: BlockedRequest[] = [];
  private readonly verdicts = new Map<string, string | null>();

  private constructor(
    private readonly browser: Browser,
    private readonly proxy: GuardProxy,
    private readonly options: SessionOptions,
  ) {}

  /** Start the guard proxy and Playwright's bundled Chromium (never a locally installed Chrome). */
  static async start(options: SessionOptions): Promise<BrowserSession> {
    const proxy = await startGuardProxy(options.policy, options.limits, options.budget);
    try {
      const browser = await chromium.launch(launchOptions(options.chromiumSandbox, proxy));
      return new BrowserSession(browser, proxy, options);
    } catch (error) {
      await proxy.close();
      throw error;
    }
  }

  /** Requests refused by the route check or the proxy. */
  get blocked(): readonly BlockedRequest[] {
    return [...this.routeBlocked, ...this.proxy.blocked];
  }

  /** New isolated context: no stored state, no credentials, service workers blocked, WebSockets refused. */
  async newContext(): Promise<BrowserContext> {
    const context = await this.browser.newContext(contextOptions(this.options.viewport, this.options.locale));
    await context.route('**/*', (route, request) => this.handleRoute(route, request));
    // Pages opened by the scanned site (pop-ups) are closed at once, and a context
    // never holds more than a few pages, so a page cannot open hundreds of renderers.
    context.on('page', (opened) => {
      void (async () => {
        const opener = await opened.opener().catch(() => null);
        if (opener !== null || context.pages().length > MAX_PAGES_PER_CONTEXT) {
          this.recordRoute(opened.url(), 'popup');
          await opened.close().catch(() => undefined);
        }
      })();
    });
    await context.routeWebSocket(/.*/, (ws) => {
      this.recordRoute(ws.url(), 'websocket');
      void ws.close({ code: 1008, reason: 'Blocked by Safeshelf network guard' });
    });
    return context;
  }

  async close(): Promise<void> {
    try {
      await this.browser.close();
    } finally {
      await this.proxy.close();
    }
  }

  private recordRoute(url: string, reason: string): void {
    if (this.routeBlocked.length < MAX_ROUTE_BLOCK_LOG) this.routeBlocked.push({ url: url.slice(0, 300), reason, stage: 'route' });
  }

  private async handleRoute(route: Route, request: Request): Promise<void> {
    const url = request.url();
    try {
      let hops = 0;
      for (let r = request.redirectedFrom(); r !== null; r = r.redirectedFrom()) hops += 1;
      if (hops > this.options.maxRedirects) throw new BlockedRequestError('Too many redirects', 'redirects');
      const parsed = checkUrlSyntax(url);
      const host = hostOf(parsed);
      let verdict = this.verdicts.get(host);
      if (verdict === undefined) {
        try {
          await resolveAndCheck(parsed, this.options.policy);
          verdict = null;
        } catch (error) {
          verdict = error instanceof BlockedRequestError ? error.reason : 'error';
        }
        if (this.verdicts.size < 2000) this.verdicts.set(host, verdict);
      }
      if (verdict !== null) throw new BlockedRequestError(`Blocked host ${host}`, verdict);
    } catch (error) {
      this.recordRoute(url, error instanceof BlockedRequestError ? error.reason : 'error');
      await route.abort('blockedbyclient').catch(() => undefined);
      return;
    }
    await route.continue().catch(() => undefined);
  }
}
