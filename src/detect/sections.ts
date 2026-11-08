// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Labelled sections: a label ("Manufacturer:", "Hersteller", "Warnings") and
 * the text that belongs to it, found in an ordered list of text units from a
 * page or from a feed's description HTML. Pure functions.
 */

import type { BlockVisibility } from '../browser/snapshot.js';
import type { LabelCategory } from '../data/labels.js';
import type { EvidenceSource, Visibility } from '../types.js';
import { matchLabel, type LabelMatch } from './text.js';

/** One unit of text in reading order. */
export interface TextUnit {
  readonly selector: string;
  readonly text: string;
  readonly tag: string;
  readonly headingLike: boolean;
  readonly level: number;
  readonly lead: string;
  readonly visibility: BlockVisibility | 'n/a';
  readonly links: readonly { readonly href: string; readonly text: string }[];
  /** Indices of the units shown by this tab or button (from `aria-controls`). */
  readonly panel?: readonly number[];
  /** Where the unit came from; default `text`. */
  readonly source?: EvidenceSource;
  /** Feed column or structured-data path, if any. */
  readonly field?: string;
}

/** A label and its content. */
export interface Section {
  readonly category: LabelCategory;
  readonly match: LabelMatch;
  /** The label's unit. */
  readonly labelUnit: TextUnit;
  /** Units that hold the content (the label unit itself when the value is inline). */
  readonly content: readonly TextUnit[];
  /** Content text, lines joined with "\n" (at most 1500 characters). */
  readonly body: string;
  /** Best visibility among the content units. */
  readonly visibility: Visibility;
}

const VIS_ORDER: readonly Visibility[] = ['visible', 'n/a', 'collapsed', 'hidden'];

/** Most visible of a list of visibilities. Pure. */
export function bestVisibility(values: readonly Visibility[]): Visibility {
  let best: Visibility = 'hidden';
  for (const v of values) if (VIS_ORDER.indexOf(v) < VIS_ORDER.indexOf(best)) best = v;
  return best;
}

/** The label at the start of a unit, if any. Pure. */
export function labelOf(unit: TextUnit): LabelMatch | null {
  const at = unit.lead === '' ? -1 : unit.text.indexOf(unit.lead);
  if (at !== -1 && unit.lead.length < unit.text.length) {
    const lead = matchLabel(unit.lead, { headingLike: true });
    if (lead !== null) {
      const rest = unit.text.slice(at + unit.lead.length).replace(/^\s*[:：\-–—|]?\s*/u, '');
      return { phrase: lead.phrase, value: lead.value !== '' ? `${lead.value} ${rest}`.trim() : rest };
    }
  }
  return matchLabel(unit.text, { headingLike: unit.headingLike });
}

const MAX_BODY = 1500;

function stopsSection(label: TextUnit, next: TextUnit, labels: (u: TextUnit) => LabelMatch | null): boolean {
  if (labels(next) !== null) return true;
  if (next.level > 0) return label.level === 0 || next.level <= label.level;
  // An inline label ("Manufacturer: ACME") ends at the next heading-like unit.
  return next.headingLike && label.level === 0;
}

/** Lines of a unit read for labels, at most. */
const MAX_SPLIT_LINES = 60;

/**
 * Split units whose later lines start with a label of their own, so that
 * "Model: K1<br>EAN: 4006381333931<br>Manufacturer: ACME" gives three units.
 * Lines that are not labels stay with the label line before them (the
 * address lines of "Manufacturer: ACME<br>Main Street 5"). Panel indices are
 * mapped to the new positions. Pure.
 */
export function splitAtLabels(units: readonly TextUnit[]): TextUnit[] {
  const out: TextUnit[] = [];
  const first: number[] = [];
  const count: number[] = [];
  const pending: { readonly at: number; readonly panel: readonly number[] }[] = [];
  for (const unit of units) {
    first.push(out.length);
    const lines = unit.text.includes('\n') ? unit.text.split('\n') : [unit.text];
    const starts = [0];
    for (let i = 1; i < Math.min(lines.length, MAX_SPLIT_LINES); i += 1) {
      if (matchLabel(lines[i] ?? '', { headingLike: false }) !== null) starts.push(i);
    }
    if (starts.length === 1) {
      if (unit.panel !== undefined && unit.panel.length > 0) pending.push({ at: out.length, panel: unit.panel });
      out.push(unit);
      count.push(1);
      continue;
    }
    const segments = starts.map((s, k) => lines.slice(s, starts[k + 1] ?? lines.length).join('\n'));
    const linkHome = (text: string): number => {
      const k = segments.findIndex((seg) => text !== '' && seg.includes(text));
      return k === -1 ? 0 : k;
    };
    segments.forEach((text, k) => {
      if (k === 0 && unit.panel !== undefined && unit.panel.length > 0) pending.push({ at: out.length, panel: unit.panel });
      out.push({
        ...unit,
        text,
        headingLike: k === 0 ? unit.headingLike : false,
        level: k === 0 ? unit.level : 0,
        lead: k === 0 ? unit.lead : '',
        links: unit.links.filter((l) => linkHome(l.text) === k),
        panel: [],
      });
    });
    count.push(segments.length);
  }
  for (const { at, panel } of pending) {
    const mapped: number[] = [];
    for (const j of panel) {
      const f = first[j];
      const n = count[j] ?? 0;
      if (f === undefined) continue;
      for (let k = 0; k < n; k += 1) mapped.push(f + k);
    }
    const target = out[at];
    if (target !== undefined) out[at] = { ...target, panel: mapped };
  }
  return out;
}

/**
 * Find labelled sections. A section is the label's inline value plus the
 * following units, up to the next label or heading, at most 4 units after an
 * inline value and 10 after a heading-style label, and at most 1500
 * characters. A tab or button that controls a panel takes the panel's units.
 *
 * @example
 * ```ts
 * findSections([{ text: 'Manufacturer: ACME GmbH', ... }])[0]?.category; // "manufacturer"
 * ```
 */
export function findSections(input: readonly TextUnit[]): Section[] {
  const units = splitAtLabels(input);
  const sections: Section[] = [];
  // Each unit's label is computed once; following units are looked at again for every section.
  const cache = new Map<TextUnit, LabelMatch | null>();
  const labels = (u: TextUnit): LabelMatch | null => {
    let m = cache.get(u);
    if (m === undefined) {
      m = labelOf(u);
      cache.set(u, m);
    }
    return m;
  };
  for (let i = 0; i < units.length; i += 1) {
    const unit = units[i];
    if (unit === undefined) continue;
    const match = labels(unit);
    if (match === null || match.phrase.category === 'stop') continue;
    const content: TextUnit[] = [];
    const lines: string[] = [];
    if (match.value !== '') {
      content.push(unit);
      lines.push(match.value);
    }
    let length = match.value.length;
    const panel = unit.panel ?? [];
    if (panel.length > 0) {
      for (const index of panel) {
        const u = units[index];
        if (u === undefined || u === unit || length > MAX_BODY) continue;
        // A panel with its own labelled parts is a container: those parts form their own sections.
        if (labels(u) !== null) break;
        content.push(u);
        lines.push(u.text);
        length += u.text.length;
      }
    } else {
      const maxFollow = match.value === '' ? 10 : 4;
      for (let j = i + 1; j < units.length && j <= i + maxFollow && length <= MAX_BODY; j += 1) {
        const next = units[j];
        if (next === undefined || stopsSection(unit, next, labels)) break;
        content.push(next);
        lines.push(next.text);
        length += next.text.length;
      }
    }
    const body = lines.join('\n').slice(0, MAX_BODY);
    sections.push({
      category: match.phrase.category,
      match,
      labelUnit: unit,
      content,
      body,
      visibility: content.length === 0 ? (unit.visibility === 'n/a' ? 'n/a' : unit.visibility) : bestVisibility(content.map((c) => c.visibility)),
    });
  }
  return sections;
}
