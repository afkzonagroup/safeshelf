// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A small, non-validating XML reader for product feeds and sitemaps.
 *
 * Safe by construction: document type declarations are refused (no external
 * entities, no entity expansion attacks), only the five predefined entities
 * and numeric character references are decoded, and depth and node counts are
 * capped. Namespaces are kept as prefixes ("g:brand"). Pure.
 */

/** Parse error with a character offset. */
export class XmlError extends Error {
  readonly offset: number;
  constructor(message: string, offset: number) {
    super(`${message} (at character ${String(offset)})`);
    this.name = 'XmlError';
    this.offset = offset;
  }
}

/** An element in the tree. */
export interface XmlElement {
  readonly name: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: XmlElement[];
  text: string;
}

/** Limits for {@link parseXml}. */
export interface XmlLimits {
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxTextChars: number;
}

/** Defaults: depth 64, 3 000 000 elements, 1 000 000 characters of text per element. */
export const DEFAULT_XML_LIMITS: XmlLimits = Object.freeze({ maxDepth: 64, maxNodes: 3_000_000, maxTextChars: 1_000_000 });

const ENTITIES: Readonly<Record<string, string>> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** True for a code point XML 1.0 allows (section 2.2, Char). */
function isXmlChar(code: number): boolean {
  return code === 0x9 || code === 0xa || code === 0xd || (code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff);
}

/** Decode the predefined entities and character references. Throws on anything else. Pure. */
export function decodeEntities(text: string, offset = 0): string {
  return text.replace(/&([^;&\s]{1,12});/g, (_m, name: string) => {
    const hex = name.startsWith('#x') || name.startsWith('#X');
    if (name.startsWith('#')) {
      const digits = name.slice(hex ? 2 : 1);
      const valid = hex ? /^[0-9a-fA-F]{1,6}$/.test(digits) : /^\d{1,7}$/.test(digits);
      const code = valid ? Number.parseInt(digits, hex ? 16 : 10) : -1;
      if (!isXmlChar(code)) throw new XmlError(`Bad character reference &${name};`, offset);
      return String.fromCodePoint(code);
    }
    const value = Object.hasOwn(ENTITIES, name) ? ENTITIES[name] : undefined;
    if (value === undefined) throw new XmlError(`Unknown entity &${name};`, offset);
    return value;
  });
}

const NAME = /^[A-Za-z_][\w.:-]{0,200}/;

/**
 * Parse an XML document into a tree. The root element is returned.
 *
 * @throws XmlError on malformed input, a DOCTYPE, an unknown entity or when a
 *   limit is exceeded.
 */
export function parseXml(text: string, limits: XmlLimits = DEFAULT_XML_LIMITS): XmlElement {
  const src = text.startsWith('\ufeff') ? text.slice(1) : text;
  const root: XmlElement = { name: '#document', attrs: {}, children: [], text: '' };
  const stack: XmlElement[] = [root];
  let nodes = 0;
  let i = 0;
  const top = (): XmlElement => {
    const t = stack[stack.length - 1];
    if (t === undefined) throw new XmlError('Internal error', i);
    return t;
  };
  const appendText = (raw: string, decode: boolean): void => {
    const el = top();
    if (el === root) {
      if (raw.trim() !== '') throw new XmlError('Text outside the root element', i);
      return;
    }
    const value = decode ? decodeEntities(raw, i) : raw;
    if (el.text.length + value.length > limits.maxTextChars) throw new XmlError('Element text too long', i);
    el.text += value;
  };
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) {
      appendText(src.slice(i), true);
      break;
    }
    if (lt > i) appendText(src.slice(i, lt), true);
    i = lt;
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      if (end === -1) throw new XmlError('Unterminated comment', i);
      i = end + 3;
    } else if (src.startsWith('<![CDATA[', i)) {
      const end = src.indexOf(']]>', i + 9);
      if (end === -1) throw new XmlError('Unterminated CDATA section', i);
      appendText(src.slice(i + 9, end), false);
      i = end + 3;
    } else if (src.startsWith('<?', i)) {
      const end = src.indexOf('?>', i + 2);
      if (end === -1) throw new XmlError('Unterminated processing instruction', i);
      i = end + 2;
    } else if (src.startsWith('<!', i)) {
      // DOCTYPE and other declarations can define entities; they are refused.
      throw new XmlError('Document type declarations are not allowed', i);
    } else if (src.startsWith('</', i)) {
      const end = src.indexOf('>', i + 2);
      if (end === -1) throw new XmlError('Unterminated end tag', i);
      const name = src.slice(i + 2, end).trim();
      const el = top();
      if (el === root || el.name !== name) throw new XmlError(`Unexpected end tag </${name.slice(0, 50)}>`, i);
      stack.pop();
      i = end + 1;
    } else {
      const m = NAME.exec(src.slice(i + 1, i + 202));
      if (m === null) throw new XmlError('Bad start tag', i);
      const name = m[0];
      let j = i + 1 + name.length;
      const attrs: Record<string, string> = Object.create(null) as Record<string, string>;
      let selfClosing = false;
      for (;;) {
        while (j < src.length && /\s/.test(src[j] ?? '')) j += 1;
        if (j >= src.length) throw new XmlError('Unterminated start tag', i);
        if (src.startsWith('/>', j)) {
          selfClosing = true;
          j += 2;
          break;
        }
        if (src[j] === '>') {
          j += 1;
          break;
        }
        const an = NAME.exec(src.slice(j, j + 201));
        if (an === null) throw new XmlError('Bad attribute', j);
        j += an[0].length;
        while (/\s/.test(src[j] ?? '')) j += 1;
        if (src[j] !== '=') throw new XmlError('Attribute without value', j);
        j += 1;
        while (/\s/.test(src[j] ?? '')) j += 1;
        const quote = src[j];
        if (quote !== '"' && quote !== "'") throw new XmlError('Unquoted attribute value', j);
        const close = src.indexOf(quote, j + 1);
        if (close === -1) throw new XmlError('Unterminated attribute value', j);
        const raw = src.slice(j + 1, close);
        if (raw.includes('<')) throw new XmlError('"<" in attribute value', j);
        if (Object.keys(attrs).length < 100) attrs[an[0]] = decodeEntities(raw, j);
        j = close + 1;
      }
      nodes += 1;
      if (nodes > limits.maxNodes) throw new XmlError(`More than ${String(limits.maxNodes)} elements`, i);
      const parent = top();
      if (parent === root && root.children.length > 0) throw new XmlError('More than one root element', i);
      const el: XmlElement = { name, attrs, children: [], text: '' };
      parent.children.push(el);
      if (!selfClosing) {
        if (stack.length > limits.maxDepth) throw new XmlError(`Nesting deeper than ${String(limits.maxDepth)}`, i);
        stack.push(el);
      }
      i = j;
    }
  }
  if (stack.length !== 1) throw new XmlError(`Unclosed element <${top().name.slice(0, 50)}>`, src.length);
  const first = root.children[0];
  if (first === undefined) throw new XmlError('No root element', 0);
  return first;
}

/** Local name without namespace prefix ("g:brand" gives "brand"). */
export function localName(name: string): string {
  const colon = name.lastIndexOf(':');
  return colon === -1 ? name : name.slice(colon + 1);
}

/** Children with a local name. */
export function childrenNamed(el: XmlElement, local: string): XmlElement[] {
  return el.children.filter((c) => localName(c.name) === local);
}

/** Text of an element and its descendants, whitespace collapsed. */
export function textOf(el: XmlElement): string {
  const parts: string[] = [el.text];
  for (const c of el.children) parts.push(textOf(c));
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}
