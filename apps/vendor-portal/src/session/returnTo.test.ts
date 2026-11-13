import { describe, expect, it } from 'vitest'
import { safeReturnTo } from './returnTo'

describe('safeReturnTo', () => {
  it.each([
    ['/products', '/products'],
    ['/products/123', '/products/123'],
    ['/products?page=2#top', '/products?page=2#top'],
    ['/brand', '/brand'],
  ])('keeps %s', (value, expected) => expect(safeReturnTo(value)).toBe(expected))

  it.each([
    [null],
    [undefined],
    [''],
    ['https://evil.example/products'],
    ['//evil.example'],
    ['/\\evil.example'],
    ['javascript:alert(1)'],
    ['/products\n/brand'],
    ['products'],
    ['/login'],
    ['/no/such/page'],
    ['/' + 'a'.repeat(3000)],
  ])('sends %s to the dashboard', (value) => expect(safeReturnTo(value as string | null)).toBe('/'))
})
