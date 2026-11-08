// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/** Data collected from a product page (after validation in Node). */

/** Visibility of a text block. */
export type BlockVisibility = 'visible' | 'collapsed' | 'hidden';

/** A block of text with its own content (child blocks are separate). */
export interface TextBlock {
  readonly selector: string;
  /** Text with line breaks kept as "\n" (at most 2000 characters). */
  readonly text: string;
  /** Lower-case tag name, or "tr" / "dl" for a joined table row or term-description pair. */
  readonly tag: string;
  /** Heading, term, header cell, summary, tab, or bold short text. */
  readonly headingLike: boolean;
  /** Heading level 1 to 6, or 0. */
  readonly level: number;
  /** Text of a leading label-like child element ("Manufacturer" in `<span>Manufacturer</span> ACME`), or empty. */
  readonly lead: string;
  readonly visibility: BlockVisibility;
  /** Links inside the block (mailto: and http(s) only). */
  readonly links: readonly BlockLink[];
  /** Indices of the blocks inside the element this tab or button controls (aria-controls). */
  readonly panel: readonly number[];
}

/** A link inside a text block. */
export interface BlockLink {
  readonly href: string;
  readonly text: string;
}

/** A microdata item. */
export interface MicroItem {
  readonly types: readonly string[];
  readonly props: readonly MicroProp[];
}

/** A microdata property; `item` is set for nested items. */
export interface MicroProp {
  readonly name: string;
  readonly value: string;
  readonly item?: MicroItem;
  readonly selector: string;
}

/** A rendered image. */
export interface ImageInfo {
  readonly selector: string;
  readonly src: string;
  readonly alt: string;
  readonly width: number;
  readonly height: number;
  /** Inside main content (main, article, [role=main] or an element with "product" in its class or id). */
  readonly inMain: boolean;
}

/** Everything collected from one page. */
export interface PageSnapshot {
  readonly url: string;
  readonly title: string;
  readonly lang: string;
  readonly blocks: readonly TextBlock[];
  /** Raw JSON-LD script contents. */
  readonly jsonLd: readonly string[];
  readonly microdata: readonly MicroItem[];
  /** Open Graph and product meta tags: property and content. */
  readonly meta: readonly { readonly property: string; readonly content: string }[];
  readonly images: readonly ImageInfo[];
  /** Elements with a large CSS background image (pictures Safeshelf cannot inspect). */
  readonly backgroundImages: number;
  /** Visible iframes (their content is not read). */
  readonly iframes: number;
  /** A visible add-to-cart control was found. */
  readonly addToCart: boolean;
  /** Collection caps were reached. */
  readonly truncated: boolean;
}
