import { describe, expect, it } from 'vitest'
import { safeReturnTo } from './returnTo'

describe('safeReturnTo', () => {
  it.each([
    ['/products', '/products'],
    ['/products/123', '/products/123'],
    ['/products?page=2#top', '/products?page=2#top'],
    ['/brand', '/brand'],
    // Build 2's pages.
    ['/review', '/review'],
    ['/products/import', '/products/import'],
    ['/products/new', '/products/new'],
    ['/store', '/store'],
    ['/store/details#commission', '/store/details#commission'],
    ['/store/details/payout', '/store/details/payout'],
    ['/account/password', '/account/password'],
    ['/help', '/help'],
    // Owner-only, but a page: the role guard decides when it opens.
    ['/team', '/team'],
  ])('keeps %s', (value, expected) => expect(safeReturnTo(value)).toBe(expected))

  it.each([
    [null],
    [undefined],
    [''],
    ['https://evil.example/products'],
    ['//evil.example'],
    ['//evil.com/products'],
    ['/\\evil.example'],
    ['\\\\evil.example'],
    ['javascript:alert(1)'],
    ['JavaScript:alert(document.cookie)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['%2F%2Fevil.example'],
    ['/%2F%2Fevil.example'],
    ['/products/../..//evil.example'],
    [' /products'],
    ['/products\n/brand'],
    ['/products\t'],
    ['products'],
    ['/login'],
    ['/signup'],
    ['/sign-in'],
    ['/verify-email'],
    ['/reset-password#token=abc'],
    ['/accept-invite'],
    ['/set-password'],
    ['/no/such/page'],
    ['/' + 'a'.repeat(3000)],
  ])('sends %j to the dashboard', (value) => expect(safeReturnTo(value as string | null)).toBe('/'))
})
