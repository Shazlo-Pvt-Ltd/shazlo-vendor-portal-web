import { describe, expect, it } from 'vitest'
import { activeFilterCount, MAX_PAGE, PAGE_SIZE, parseListParams, patchSearch, toFilters, type ListParams } from './useListParams'

// The list's address (V-06): main's filters.ts rules on Build 2's parameters. Everything the list
// shows is in the URL, and a hand-edited link never breaks the page.

const parse = (search: string) => parseListParams(new URLSearchParams(search))
const PLAIN: ListParams = { status: undefined, q: '', category: '', gender: '', stock: undefined, sort: 'updated_desc', page: 1 }

describe('the list in the address', () => {
  it('round-trips every filter', () => {
    const all = { status: 'approved', q: 'silk saree', category: 'Kurtas', gender: 'Women', stock: 'low', sort: 'price_asc', page: 3 } as const
    expect(parse(patchSearch(new URLSearchParams(), all).toString())).toEqual(all)
  })

  it('gives the plain list a plain address', () => {
    expect(parse('')).toEqual(PLAIN)
    expect(patchSearch(new URLSearchParams(), { ...PLAIN }).toString()).toBe('')
  })

  it.each([
    ['status=bogus', { status: undefined }],
    ['status=ARCHIVED', { status: undefined }],
    ['page=0', { page: 1 }],
    ['page=-4', { page: 1 }],
    ['page=abc', { page: 1 }],
    ['page=1.5', { page: 1 }],
    ['page=99999999', { page: 1 }],
    ['q=%20%20', { q: '' }],
    [`q=${'x'.repeat(500)}`, { q: 'x'.repeat(100) }],
    ['category=spacesuits', { category: '' }],
    ['gender=kids', { gender: '' }],
    ['stock=plenty', { stock: undefined }],
    ['sort=random', { sort: 'updated_desc' }],
  ])('ignores nonsense in %s so a hand-edited link never breaks the page', (search, expected) => {
    expect(parse(search)).toMatchObject(expected)
  })

  it('keeps the last page that can exist', () => {
    expect(parse(`page=${MAX_PAGE}`).page).toBe(MAX_PAGE)
    expect(parse(`page=${MAX_PAGE + 1}`).page).toBe(1)
  })

  it('trims what was typed and reads a product type in any case', () => {
    expect(parse('q=%20silk%20').q).toBe('silk')
    expect(parse('category=%20kurtas%20').category).toBe('Kurtas')
    expect(parse('gender=women').gender).toBe('Women')
  })

  it('counts the filters that are on; search and the page alone are not filters', () => {
    expect(activeFilterCount(parse(''))).toBe(0)
    expect(activeFilterCount(parse('page=4&q=silk'))).toBe(0)
    expect(activeFilterCount(parse('category=Kurtas&stock=out&gender=Men'))).toBe(3)
  })
})

describe('changing the address', () => {
  it('starts again from page 1 when anything but the page changes', () => {
    const next = patchSearch(new URLSearchParams('status=draft&page=3'), { q: 'ikat' })
    expect(next.toString()).toBe('status=draft&q=ikat')
    expect(patchSearch(new URLSearchParams('status=draft&page=3'), { page: 4 }).toString()).toBe('status=draft&page=4')
  })

  it('leaves defaults and empty values out', () => {
    expect(patchSearch(new URLSearchParams('q=a&sort=price_asc'), { q: '', sort: 'updated_desc' }).toString()).toBe('')
    expect(patchSearch(new URLSearchParams('page=2'), { page: 1 }).toString()).toBe('')
  })

  it('keeps parameters it does not own', () => {
    expect(patchSearch(new URLSearchParams('ref=home'), { status: 'draft' }).toString()).toBe('ref=home&status=draft')
  })
})

describe('the request', () => {
  it('asks only for what is set, with the page as an offset', () => {
    expect(toFilters(parse(''))).toEqual({ status: undefined, q: undefined, category: undefined, gender: undefined, stock: undefined, sort: 'updated_desc', cursor: undefined, limit: PAGE_SIZE })
    expect(toFilters(parse('status=draft&q=a&category=Kurtas&page=3'))).toMatchObject({ status: 'draft', q: 'a', category: 'Kurtas', cursor: String(2 * PAGE_SIZE), limit: PAGE_SIZE })
  })
})
