// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Functions that run inside the scanned page via `page.evaluate`.
 *
 * They are constant code from this package (never user input), take only
 * plain-data arguments and must be self-contained: no references to module
 * scope, because Playwright serialises the function source. The page shares
 * their JavaScript world and can tamper with the result, so everything they
 * return is validated again in Node (`sanitize.ts`).
 */

/** Arguments for {@link collectPage}. */
export interface CollectArgs {
  readonly maxElements: number;
  readonly maxBlocks: number;
  readonly maxBlockChars: number;
  readonly maxJsonLd: number;
  readonly maxJsonLdChars: number;
  readonly maxMicroItems: number;
  readonly maxMicroProps: number;
  readonly maxImages: number;
  /** Regular expression source for add-to-cart wording. */
  readonly cartSource: string;
}

/** In-page collector. The return value is untrusted; see `sanitizeSnapshot`. */
export function collectPage(args: CollectArgs): unknown {
  let truncated = false;
  const norm = (s: string | null | undefined): string => (s ?? '').replace(/[ \t\r\f\v\u00a0]+/g, ' ').replace(/ *\n+ */g, '\n').trim();
  const cap = (s: string, n: number): string => (s.length > n ? s.slice(0, n) : s);

  const cssPath = (el: Element): string => {
    if (el.id !== '' && el.getRootNode() === document && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) {
      return `#${CSS.escape(el.id)}`;
    }
    const parts: string[] = [];
    let node: Element = el;
    for (let depth = 0; depth < 25; depth += 1) {
      const tag = node.tagName.toLowerCase();
      if (node.id !== '' && node.getRootNode() === document && document.querySelectorAll(`#${CSS.escape(node.id)}`).length === 1) {
        parts.unshift(`#${CSS.escape(node.id)}`);
        break;
      }
      const parent: Element | null = node.parentElement;
      if (parent === null) {
        parts.unshift(tag);
        break;
      }
      const current: Element = node;
      const same = Array.from(parent.children).filter((c) => c.tagName === current.tagName);
      parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${String(same.indexOf(current) + 1)})` : tag);
      node = parent;
    }
    return parts.join(' > ');
  };

  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'IFRAME', 'OBJECT', 'EMBED', 'VIDEO', 'AUDIO', 'SELECT', 'OPTION', 'HEAD']);
  const INLINE = new Set(['inline', 'inline-block', 'inline-flex', 'inline-grid', 'contents', 'ruby']);

  const rendered = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    return el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true });
  };

  // Controls that label a section (accordion buttons, tabs, summaries) are their own blocks even when inline.
  const isControlLabel = (el: Element): boolean =>
    el.tagName === 'BUTTON' || el.tagName === 'SUMMARY' || el.getAttribute('role') === 'tab' || el.hasAttribute('aria-controls') || el.hasAttribute('aria-expanded');

  const isBlockLevel = (el: Element): boolean => {
    if (el.tagName === 'BR') return false;
    if (isControlLabel(el)) return true;
    const display = getComputedStyle(el).display;
    return display === 'none' ? true : !INLINE.has(display);
  };

  const collapsedContainer = (el: Element): boolean => {
    for (let n: Element | null = el; n !== null; n = n.parentElement) {
      if (n instanceof HTMLDetailsElement && !n.open && !(el.closest('summary') !== null && n.contains(el.closest('summary')))) return true;
      const role = n.getAttribute('role');
      if (role === 'tabpanel') return true;
      if (n.id !== '' && document.querySelector(`[aria-controls~="${CSS.escape(n.id)}"]`) !== null) return true;
      const cls = typeof n.className === 'string' ? n.className : '';
      if (/accordion|collaps|tab-?pane|tab-?content|disclosure|toggle-content|drawer/i.test(`${cls} ${n.id}`) && !rendered(n)) return true;
    }
    return false;
  };

  const visibilityOf = (el: Element): 'visible' | 'collapsed' | 'hidden' => {
    if (rendered(el)) return 'visible';
    return collapsedContainer(el) ? 'collapsed' : 'hidden';
  };

  // Own text of a block: text nodes and inline elements, stopping at nested blocks.
  const ownText = (el: Element): { text: string; lead: string; links: { href: string; text: string }[] } => {
    let text = '';
    let lead = '';
    let firstElementSeen = false;
    const links: { href: string; text: string }[] = [];
    const walk = (node: Node, depth: number): void => {
      if (depth > 30 || text.length > args.maxBlockChars) return;
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === 3) {
          text += child.textContent ?? '';
        } else if (child instanceof Element) {
          if (SKIP.has(child.tagName.toUpperCase())) continue;
          if (child.tagName === 'BR') {
            text += '\n';
            continue;
          }
          if (isBlockLevel(child)) {
            text += '\n';
            continue;
          }
          const before = text;
          if (child instanceof HTMLAnchorElement && links.length < 5) {
            const href = child.href;
            if (/^(?:mailto:|https?:)/i.test(href)) links.push({ href: cap(href, 2048), text: cap(norm(child.textContent), 200) });
          }
          walk(child, depth + 1);
          text += ' ';
          if (!firstElementSeen && norm(before) === '') {
            firstElementSeen = true;
            const t = norm(text);
            if (/^(?:SPAN|STRONG|B|EM|LABEL|DT|TH|DIV|P)$/.test(child.tagName) && t.length > 0 && t.length <= 60) lead = t;
          }
        }
      }
    };
    walk(el, 0);
    return { text: cap(norm(text), args.maxBlockChars), lead, links };
  };

  const headingLevel = (el: Element): number => {
    const m = /^H([1-6])$/.exec(el.tagName);
    if (m !== null) return Number(m[1]);
    if (el.getAttribute('role') === 'heading') {
      const level = Number(el.getAttribute('aria-level') ?? '2');
      return Number.isInteger(level) && level >= 1 && level <= 6 ? level : 2;
    }
    return 0;
  };

  const isHeadingLike = (el: Element, text: string): boolean => {
    if (headingLevel(el) > 0) return true;
    const tag = el.tagName;
    if (tag === 'DT' || tag === 'TH' || tag === 'SUMMARY' || tag === 'LEGEND' || tag === 'CAPTION' || tag === 'LABEL') return true;
    const role = el.getAttribute('role');
    if (role === 'tab' || role === 'button' || el.hasAttribute('aria-controls') || el.hasAttribute('aria-expanded')) return text.length <= 80;
    if (text.length <= 60) {
      const weight = Number(getComputedStyle(el).fontWeight);
      if (weight >= 600) return true;
      const only = el.children.length === 1 ? el.children[0] : undefined;
      if (only !== undefined && /^(?:STRONG|B|H[1-6])$/.test(only.tagName) && norm(only.textContent) === norm(el.textContent)) return true;
    }
    return false;
  };

  // Walk the document and open shadow roots in order. The main content is
  // walked first, so a very large menu or footer cannot use up the caps before
  // the product information is read; blocks are put back in reading order below.
  const elements: Element[] = [];
  const main = document.querySelector('main, [role="main"]');
  const visit = (root: Element | ShadowRoot, skip: Element | null): void => {
    const filter = skip === null ? null : { acceptNode: (n: Node): number => (n === skip ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) };
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, filter);
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      if (elements.length >= args.maxElements) {
        truncated = true;
        return;
      }
      const el = n as Element;
      elements.push(el);
      if (el.shadowRoot !== null) visit(el.shadowRoot, null);
    }
  };
  if (main !== null && main !== document.body && document.body.contains(main)) {
    elements.push(main);
    visit(main, null);
    visit(document.body, main);
  } else {
    visit(document.body, null);
  }

  const owners: Element[] = [];
  const ownerSet = new Set<Element>();
  for (const el of elements) {
    if (SKIP.has(el.tagName.toUpperCase()) || el.closest('script,style,noscript,template,select') !== null) continue;
    const hasOwnText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim() !== '');
    if (!hasOwnText) continue;
    let owner: Element = el;
    while (!isBlockLevel(owner) && owner.parentElement !== null) owner = owner.parentElement;
    if (ownerSet.has(owner)) continue;
    ownerSet.add(owner);
    owners.push(owner);
  }

  const blocks: { selector: string; text: string; tag: string; headingLike: boolean; level: number; lead: string; visibility: string; links: { href: string; text: string }[]; panel: number[] }[] = [];
  const blockOwners: Element[] = [];
  const consumed = new Set<Element>();
  for (const owner of owners) {
    if (blocks.length >= args.maxBlocks) {
      truncated = true;
      break;
    }
    if (consumed.has(owner)) continue;
    // Table rows with two cells and term/description pairs become one "label: value" block.
    const cell = owner.closest('th,td');
    const row = cell?.parentElement;
    if (cell !== null && row instanceof HTMLTableRowElement && row.cells.length === 2) {
      const [a, b] = [row.cells[0], row.cells[1]];
      if (a !== undefined && b !== undefined && !consumed.has(a)) {
        consumed.add(a);
        consumed.add(b);
        for (const o of owners) if (a.contains(o) || b.contains(o)) consumed.add(o);
        const left = norm(a.textContent);
        const right = norm(b.textContent);
        blocks.push({
          selector: cssPath(row),
          text: cap(`${left}${/[:：]$/.test(left) ? '' : ':'} ${right}`, args.maxBlockChars),
          tag: 'tr',
          headingLike: false,
          level: 0,
          lead: '',
          visibility: visibilityOf(row),
          panel: [],
          links: Array.from(b.querySelectorAll('a[href]'))
            .slice(0, 5)
            .map((x) => ({ href: cap((x as HTMLAnchorElement).href, 2048), text: cap(norm(x.textContent), 200) }))
            .filter((l) => /^(?:mailto:|https?:)/i.test(l.href)),
        });
        blockOwners.push(row);
        continue;
      }
    }
    const dt = owner.closest('dt');
    if (dt !== null) {
      const dd = dt.nextElementSibling;
      if (dd !== null && dd.tagName === 'DD' && !consumed.has(dt)) {
        consumed.add(dt);
        consumed.add(dd);
        for (const o of owners) if (dt.contains(o) || dd.contains(o)) consumed.add(o);
        const left = norm(dt.textContent);
        blocks.push({
          selector: cssPath(dt),
          text: cap(`${left}${/[:：]$/.test(left) ? '' : ':'} ${norm((dd as HTMLElement).innerText || dd.textContent)}`, args.maxBlockChars),
          tag: 'dl',
          headingLike: false,
          level: 0,
          lead: '',
          visibility: visibilityOf(dd),
          panel: [],
          links: Array.from(dd.querySelectorAll('a[href]'))
            .slice(0, 5)
            .map((x) => ({ href: cap((x as HTMLAnchorElement).href, 2048), text: cap(norm(x.textContent), 200) }))
            .filter((l) => /^(?:mailto:|https?:)/i.test(l.href)),
        });
        blockOwners.push(dt);
        continue;
      }
    }
    const own = ownText(owner);
    if (own.text === '') continue;
    blocks.push({
      selector: cssPath(owner),
      text: own.text,
      tag: owner.tagName.toLowerCase(),
      headingLike: isHeadingLike(owner, own.text),
      level: headingLevel(owner),
      lead: own.lead,
      visibility: visibilityOf(owner),
      links: own.links,
      panel: [],
    });
    blockOwners.push(owner);
  }

  // Back to reading order: blocks before the main content, in it, and after it.
  if (main !== null && blockOwners.length > 0) {
    const rank = (o: Element): number => (main.contains(o) ? 1 : (main.compareDocumentPosition(o) & Node.DOCUMENT_POSITION_PRECEDING) !== 0 ? 0 : 2);
    const order = blockOwners.map((o, i) => ({ i, r: rank(o) })).sort((a, b) => a.r - b.r || a.i - b.i);
    const sortedBlocks = order.map((x) => blocks[x.i]);
    const sortedOwners = order.map((x) => blockOwners[x.i]);
    blocks.length = 0;
    blockOwners.length = 0;
    for (const b of sortedBlocks) if (b !== undefined) blocks.push(b);
    for (const o of sortedOwners) if (o !== undefined) blockOwners.push(o);
  }

  // Tabs and accordion buttons: the blocks inside the element they control (aria-controls).
  blockOwners.forEach((owner, index) => {
    const control = isControlLabel(owner) ? owner : owner.closest('[aria-controls]');
    const ids = (control?.getAttribute('aria-controls') ?? '').split(/\s+/).filter((id) => id !== '').slice(0, 3);
    const block = blocks[index];
    if (block === undefined) return;
    for (const id of ids) {
      const target = document.getElementById(id);
      if (target === null || target.contains(owner)) continue;
      blockOwners.forEach((o, j) => {
        if (block.panel.length < 40 && j !== index && target.contains(o)) block.panel.push(j);
      });
    }
  });

  // JSON-LD
  const jsonLd: string[] = [];
  for (const s of Array.from(document.querySelectorAll('script[type="application/ld+json" i]'))) {
    if (jsonLd.length >= args.maxJsonLd) {
      truncated = true;
      break;
    }
    const text = s.textContent;
    if (text.length > args.maxJsonLdChars) {
      truncated = true;
      continue;
    }
    jsonLd.push(text);
  }

  // Microdata
  let propCount = 0;
  const propValue = (el: Element): string => {
    const tag = el.tagName;
    if (tag === 'META') return el.getAttribute('content') ?? '';
    if (tag === 'A' || tag === 'LINK' || tag === 'AREA') return (el as HTMLAnchorElement).href || (el.getAttribute('href') ?? '');
    if (tag === 'IMG' || tag === 'SOURCE' || tag === 'VIDEO' || tag === 'AUDIO' || tag === 'IFRAME' || tag === 'EMBED' || tag === 'TRACK') return (el as HTMLImageElement).src || (el.getAttribute('src') ?? '');
    if (tag === 'OBJECT') return el.getAttribute('data') ?? '';
    if (tag === 'DATA' || tag === 'METER') return el.getAttribute('value') ?? '';
    if (tag === 'TIME') return el.getAttribute('datetime') ?? norm(el.textContent);
    if (el.hasAttribute('content')) return el.getAttribute('content') ?? '';
    return norm(el.textContent);
  };
  type Item = { types: string[]; props: { name: string; value: string; item?: Item; selector: string }[] };
  const readItem = (scope: Element, depth: number): Item => {
    const item: Item = { types: (scope.getAttribute('itemtype') ?? '').split(/\s+/).filter((t) => t !== '').slice(0, 5), props: [] };
    const stack: Element[] = Array.from(scope.children).reverse();
    while (stack.length > 0) {
      const el = stack.pop();
      if (el === undefined) break;
      if (propCount >= args.maxMicroProps) {
        truncated = true;
        break;
      }
      const names = (el.getAttribute('itemprop') ?? '').split(/\s+/).filter((n) => n !== '');
      const nested = el.hasAttribute('itemscope');
      if (names.length > 0) {
        for (const name of names.slice(0, 3)) {
          propCount += 1;
          if (nested && depth < 5) item.props.push({ name, value: '', item: readItem(el, depth + 1), selector: cssPath(el) });
          else item.props.push({ name, value: cap(propValue(el), 2000), selector: cssPath(el) });
        }
      }
      if (nested) continue;
      for (const c of Array.from(el.children).reverse()) stack.push(c);
    }
    return item;
  };
  const microdata: Item[] = [];
  for (const scope of Array.from(document.querySelectorAll('[itemscope]:not([itemprop])'))) {
    if (microdata.length >= args.maxMicroItems) {
      truncated = true;
      break;
    }
    microdata.push(readItem(scope, 0));
  }

  // Meta tags
  const meta: { property: string; content: string }[] = [];
  for (const m of Array.from(document.querySelectorAll('meta[property],meta[name]')).slice(0, 300)) {
    const property = (m.getAttribute('property') ?? m.getAttribute('name') ?? '').toLowerCase();
    if (!/^(?:og:|product:)/.test(property)) continue;
    meta.push({ property: cap(property, 100), content: cap(m.getAttribute('content') ?? '', 2048) });
    if (meta.length >= 100) break;
  }

  // Images
  const imgs: { selector: string; src: string; alt: string; width: number; height: number; inMain: boolean; area: number }[] = [];
  for (const img of Array.from(document.images).slice(0, 2000)) {
    const r = img.getBoundingClientRect();
    if (r.width < 150 || r.height < 150 || !rendered(img)) continue;
    const main = img.closest('main,article,[role="main"],[class*="product" i],[id*="product" i]') !== null;
    imgs.push({ selector: cssPath(img), src: cap(img.currentSrc || img.src, 2048), alt: cap(img.alt, 200), width: Math.round(r.width), height: Math.round(r.height), inMain: main, area: r.width * r.height });
  }
  imgs.sort((a, b) => b.area - a.area);
  let backgroundImages = 0;
  for (const el of elements.slice(0, 3000)) {
    if (el instanceof HTMLImageElement) continue;
    const bg = getComputedStyle(el).backgroundImage;
    if (bg === 'none' || !bg.includes('url(')) continue;
    const r = el.getBoundingClientRect();
    if (r.width >= 150 && r.height >= 150) backgroundImages += 1;
  }

  const cart = new RegExp(args.cartSource, 'iu');
  const addToCart = Array.from(document.querySelectorAll('button,input[type="submit"],[role="button"],form[action]'))
    .slice(0, 500)
    .some((el) => {
      if (el instanceof HTMLFormElement) return /\/cart(?:\/add)?\b|add-to-cart|basket/i.test(el.getAttribute('action') ?? '');
      if (!rendered(el)) return false;
      const label = el instanceof HTMLInputElement ? el.value : norm(el.textContent);
      return cart.test(label) || /add-to-cart/i.test(el.getAttribute('name') ?? '');
    });

  const iframes = Array.from(document.querySelectorAll('iframe')).filter(rendered).length;

  return {
    url: location.href,
    title: cap(document.title, 300),
    lang: cap(document.documentElement.lang, 20),
    blocks,
    jsonLd,
    microdata,
    meta,
    images: imgs.slice(0, args.maxImages),
    backgroundImages,
    iframes,
    addToCart,
    truncated,
  };
}
