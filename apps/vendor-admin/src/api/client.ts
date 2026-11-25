import type { paths as LegacyPaths } from './legacy'
import type { paths as ProposedPaths } from './proposed'
import type { paths as RealPaths } from './schema'

type HttpMethod = 'get' | 'put' | 'post' | 'delete' | 'options' | 'head' | 'patch' | 'trace'

/** The methods a path item defines; openapi-typescript writes the others as `method?: never`. */
type DefinedMethods<Item> = {
  [M in HttpMethod & keyof Item]-?: [Exclude<Item[M], undefined>] extends [never] ? never : M
}[HttpMethod & keyof Item]

type MergeItem<Real, Proposed> = Omit<Real, DefinedMethods<Proposed>> & Pick<Proposed, DefinedMethods<Proposed>>

/**
 * vendor-api's real routes (`schema.d.ts`, from `services/vendor-api/openapi.json`) with the ones it
 * still has to build (`proposed.d.ts`, from `openapi/proposed.yaml`). A method in the proposal
 * replaces the same method of the same path; the path's other methods stay real.
 */
export type VendorApiPaths = {
  [P in keyof RealPaths | keyof ProposedPaths]: P extends keyof ProposedPaths
    ? P extends keyof RealPaths
      ? MergeItem<RealPaths[P], ProposedPaths[P]>
      : ProposedPaths[P]
    : P extends keyof RealPaths
      ? RealPaths[P]
      : never
}

/**
 * Every route the admin may call. `/api/v1/admin/*` is the screens' original hand-written API
 * (`legacy.d.ts`, served by `packages/mock-vendor-api`). Each area moves to `/v1/admin/*` through an
 * adapter in #294 to #298; when the last one has moved, delete `legacy.d.ts`, `openapi/vendor-admin.yaml`
 * and the `LegacyPaths` line below.
 */
export type ApiPaths = VendorApiPaths & LegacyPaths
