import { describe, expect, expectTypeOf, it } from 'vitest'
import type { ApiPaths } from './client'
import type { paths as Proposed } from './proposed'
import type { paths as Real } from './schema'

type JsonOf<T> = T extends { content: { 'application/json': infer B } } ? B : never

describe('the client is typed with the real and the proposed routes', () => {
  it('keeps the real routes the proposal does not touch', () => {
    expectTypeOf<ApiPaths['/v1/vendor/users']['get']>().toEqualTypeOf<Real['/v1/vendor/users']['get']>()
    expectTypeOf<ApiPaths['/v1/vendor/assets/sign']['post']>().toEqualTypeOf<Real['/v1/vendor/assets/sign']['post']>()
  })

  it('keeps the methods of a path that the proposal leaves alone', () => {
    // The proposal changes GET and PUT of one product; DELETE is still the real one.
    expectTypeOf<ApiPaths['/v1/vendor/products/{product_id}']['delete']>().toEqualTypeOf<Real['/v1/vendor/products/{product_id}']['delete']>()
    expectTypeOf<ApiPaths['/v1/vendor/users/{user_id}']['patch']>().toEqualTypeOf<Real['/v1/vendor/users/{user_id}']['patch']>()
  })

  it('takes the proposed method where both define it', () => {
    expectTypeOf<ApiPaths['/v1/vendor/products/{product_id}']['put']>().toEqualTypeOf<Proposed['/v1/vendor/products/{product_id}']['put']>()
    type Product = JsonOf<ApiPaths['/v1/vendor/products/{product_id}']['get']['responses'][200]>
    expectTypeOf<NonNullable<Product['working']>['main_colour']>().toEqualTypeOf<string | null>()
  })

  it('uses the real routes vendor-api shipped (PR #281), with nothing proposed on top', () => {
    expectTypeOf<ApiPaths['/v1/vendor/me']>().toEqualTypeOf<Real['/v1/vendor/me']>()
    expectTypeOf<ApiPaths['/v1/auth/login']>().toEqualTypeOf<Real['/v1/auth/login']>()
    expectTypeOf<ApiPaths['/v1/vendor/store-details']>().toEqualTypeOf<Real['/v1/vendor/store-details']>()
    expectTypeOf<ApiPaths['/v1/vendor/store-details/payout']>().toEqualTypeOf<Real['/v1/vendor/store-details/payout']>()
    expectTypeOf<ApiPaths['/v1/vendor/commission']>().toEqualTypeOf<Real['/v1/vendor/commission']>()
    expectTypeOf<ApiPaths['/v1/vendor/commission/proposal']>().toEqualTypeOf<Real['/v1/vendor/commission/proposal']>()
    expectTypeOf<ApiPaths['/v1/vendor/size-charts/{group}']>().toEqualTypeOf<Real['/v1/vendor/size-charts/{group}']>()
    expectTypeOf<ApiPaths['/v1/public/ifsc/{code}']>().toEqualTypeOf<Real['/v1/public/ifsc/{code}']>()
  })

  it('takes the proposed list and submissions, with their new fields and filters', () => {
    expectTypeOf<ApiPaths['/v1/vendor/products']['get']>().toEqualTypeOf<Proposed['/v1/vendor/products']['get']>()
    expectTypeOf<ApiPaths['/v1/vendor/submissions']['get']>().toEqualTypeOf<Proposed['/v1/vendor/submissions']['get']>()
    type Row = JsonOf<ApiPaths['/v1/vendor/products']['get']['responses'][200]>['items'][number]
    expectTypeOf<Row['thumbnail_url']>().toEqualTypeOf<string | null>()
    type Body = NonNullable<ApiPaths['/v1/vendor/products/{product_id}']['put']['requestBody']>['content']['application/json']
    expectTypeOf<Body['version']>().toEqualTypeOf<number | undefined>()
  })

  it('is a type-only module at run time', () => {
    expect(true).toBe(true)
  })
})
