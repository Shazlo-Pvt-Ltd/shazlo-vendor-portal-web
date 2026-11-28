import { paths } from '../app/paths'
import { shellCopy as copy } from '../copy/shell'

/** Which of the three setup tasks are done (the `setup` part of useMe()). */
export type Setup = { store_details: boolean; brand_page: boolean; first_product: boolean }

export type SetupStep = { key: keyof Setup; done: boolean; label: string; to: string }

// The three setup tasks (spec §4), in the order a new seller should do them. Store details come
// first because products cannot be sent for review without them.
export function setupSteps(setup: Setup): SetupStep[] {
  return [
    { key: 'store_details', done: setup.store_details, label: copy.setupSteps.store_details, to: paths.storeDetails },
    { key: 'brand_page', done: setup.brand_page, label: copy.setupSteps.brand_page, to: paths.brand },
    { key: 'first_product', done: setup.first_product, label: copy.setupSteps.first_product, to: paths.newProduct },
  ]
}
