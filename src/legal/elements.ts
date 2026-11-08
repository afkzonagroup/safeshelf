// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import type { ElementId, SalesContext } from '../types.js';
import type { ProvisionId } from './provisions.js';

/** What Safeshelf checks for one element, and under which provision. */
export interface ElementDefinition {
  readonly id: ElementId;
  /** Short title, for example "Manufacturer name". */
  readonly title: string;
  /** Provision for a shop's own offer (GPSR Art. 19). */
  readonly provision: ProvisionId;
  /** Provision for a product listing on an online marketplace (GPSR Art. 22(9)). */
  readonly marketplaceProvision: ProvisionId;
  /** Related provisions shown for context. */
  readonly related: readonly ProvisionId[];
  /** True if the requirement depends on facts Safeshelf cannot always know. */
  readonly conditional: boolean;
  /** What a merchant adds to fix a missing element. */
  readonly fix: string;
}

const E = (d: ElementDefinition): ElementDefinition => Object.freeze(d);

/** Element catalogue, keyed by id. */
export const ELEMENTS: Readonly<Record<ElementId, ElementDefinition>> = Object.freeze({
  'manufacturer-name': E({
    id: 'manufacturer-name',
    title: 'Manufacturer name',
    provision: 'gpsr-19-a',
    marketplaceProvision: 'gpsr-22-9-a',
    related: ['gpsr-9-6', 'gpsr-3'],
    conditional: false,
    fix: 'Show the manufacturer’s name, registered trade name or registered trade mark in the offer.',
  }),
  'manufacturer-postal-address': E({
    id: 'manufacturer-postal-address',
    title: 'Manufacturer postal address',
    provision: 'gpsr-19-a',
    marketplaceProvision: 'gpsr-22-9-a',
    related: ['gpsr-9-6'],
    conditional: false,
    fix: 'Show the postal address at which the manufacturer can be contacted.',
  }),
  'manufacturer-electronic-address': E({
    id: 'manufacturer-electronic-address',
    title: 'Manufacturer electronic address',
    provision: 'gpsr-19-a',
    marketplaceProvision: 'gpsr-22-9-a',
    related: ['gpsr-9-6'],
    conditional: false,
    fix: 'Show the electronic address (for example an email address) at which the manufacturer can be contacted.',
  }),
  'responsible-person-name': E({
    id: 'responsible-person-name',
    title: 'Responsible person name',
    provision: 'gpsr-19-b',
    marketplaceProvision: 'gpsr-22-9-b',
    related: ['gpsr-16-1', 'gpsr-16-3', 'msr-4-1', 'msr-4-2'],
    conditional: true,
    fix: 'If the manufacturer is not established in the EU, show the name of the responsible person in the EU.',
  }),
  'responsible-person-postal-address': E({
    id: 'responsible-person-postal-address',
    title: 'Responsible person postal address',
    provision: 'gpsr-19-b',
    marketplaceProvision: 'gpsr-22-9-b',
    related: ['gpsr-16-1', 'gpsr-16-3'],
    conditional: true,
    fix: 'If the manufacturer is not established in the EU, show the postal address of the responsible person in the EU.',
  }),
  'responsible-person-electronic-address': E({
    id: 'responsible-person-electronic-address',
    title: 'Responsible person electronic address',
    provision: 'gpsr-19-b',
    marketplaceProvision: 'gpsr-22-9-b',
    related: ['gpsr-16-1', 'gpsr-16-3'],
    conditional: true,
    fix: 'If the manufacturer is not established in the EU, show the electronic address of the responsible person in the EU.',
  }),
  'product-picture': E({
    id: 'product-picture',
    title: 'Picture of the product',
    provision: 'gpsr-19-c',
    marketplaceProvision: 'gpsr-22-9-c',
    related: [],
    conditional: false,
    fix: 'Show a picture of the product in the offer.',
  }),
  'product-type': E({
    id: 'product-type',
    title: 'Product type',
    provision: 'gpsr-19-c',
    marketplaceProvision: 'gpsr-22-9-c',
    related: ['gpsr-9-5'],
    conditional: false,
    fix: 'Show the product’s type (for example the model or type designation printed on the product).',
  }),
  'product-identifier': E({
    id: 'product-identifier',
    title: 'Other product identifier',
    provision: 'gpsr-19-c',
    marketplaceProvision: 'gpsr-22-9-c',
    related: ['gpsr-9-5'],
    conditional: false,
    fix: 'Show any other product identifier, for example a GTIN/EAN, a model, batch or article number.',
  }),
  'safety-information': E({
    id: 'safety-information',
    title: 'Warnings and safety information',
    provision: 'gpsr-19-d',
    marketplaceProvision: 'gpsr-22-9-d',
    related: ['gpsr-9-7'],
    conditional: true,
    fix: 'If the product has warnings or safety information on it, on its packaging or in an accompanying document, show them in the offer in a language the Member State requires.',
  }),
});

/** The provision for an element in a sales context. Pure. */
export function provisionFor(element: ElementId, context: SalesContext): ProvisionId {
  const def = ELEMENTS[element];
  return context === 'marketplace' ? def.marketplaceProvision : def.provision;
}
