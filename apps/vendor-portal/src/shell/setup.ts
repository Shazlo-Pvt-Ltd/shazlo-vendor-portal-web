import type { Schemas } from '../api/client'
import { paths } from '../app/paths'
import { shellCopy as copy } from '../copy/shell'

type Setup = Schemas['Me']['setup']

export type SetupStep = { key: 'store_details' | 'brand_page' | 'first_product'; done: boolean; label: string; to: string }

// The three setup tasks (spec §4), in the order a new seller should do them. Store details come
// first because products cannot be sent for review without them.
export function setupSteps(setup: Setup): SetupStep[] {
  return [
    { key: 'store_details', done: setup.store_details, label: copy.setupSteps.store_details, to: paths.storeDetails },
    { key: 'brand_page', done: setup.brand_page, label: copy.setupSteps.brand_page, to: paths.brand },
    { key: 'first_product', done: setup.first_product, label: copy.setupSteps.first_product, to: paths.newProduct },
  ]
}
