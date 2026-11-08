// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * "Add to cart" wording, used only to recognise product pages that have no
 * structured data. English is the maintainers' (`original`); the other
 * languages are translations that need native review.
 */

import type { SourcedPhrase } from '../types.js';

const T = (lang: string, text: string): SourcedPhrase => Object.freeze({ lang, text, source: lang === 'en' ? 'original' : 'translation' });

/** Add-to-cart phrases. */
export const CART_PHRASES: readonly SourcedPhrase[] = Object.freeze([
  T('en', 'add to cart'),
  T('en', 'add to basket'),
  T('en', 'add to bag'),
  T('en', 'buy now'),
  T('de', 'in den warenkorb'),
  T('de', 'jetzt kaufen'),
  T('fr', 'ajouter au panier'),
  T('es', 'añadir al carrito'),
  T('es', 'añadir a la cesta'),
  T('it', 'aggiungi al carrello'),
  T('nl', 'in winkelwagen'),
  T('nl', 'toevoegen aan winkelwagen'),
  T('pl', 'dodaj do koszyka'),
  T('pt', 'adicionar ao carrinho'),
  T('lt', 'į krepšelį'),
  T('lv', 'pievienot grozam'),
  T('et', 'lisa ostukorvi'),
  T('fi', 'lisää ostoskoriin'),
  T('sv', 'lägg i varukorgen'),
  T('da', 'læg i kurv'),
  T('cs', 'přidat do košíku'),
  T('sk', 'pridať do košíka'),
  T('sl', 'dodaj v košarico'),
  T('hr', 'dodaj u košaricu'),
  T('hu', 'kosárba'),
  T('ro', 'adaugă în coș'),
  T('bg', 'добави в количката'),
  T('el', 'προσθήκη στο καλάθι'),
]);

/** Regular expression source matching any add-to-cart phrase (case-insensitive, Unicode). */
export const CART_SOURCE = CART_PHRASES.map((p) => p.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
