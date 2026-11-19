import { describe, expect, it } from 'vitest'
import { PAGE_SIZE, filtersFromSearch, hasActiveFilters, pageCount, queryFromFilters, searchFromFilters } from './filters'

const parse = (search: string) => filtersFromSearch(new URLSearchParams(search))

describe('the filters in the address', () => {
  it('round-trips every filter', () => {
    const filters = { status: 'approved', category: 'kurtas', q: 'silk saree', page: 3 } as const
    expect(parse(searchFromFilters(filters).toString())).toEqual(filters)
  })

  it('gives the plain list a plain address', () => {
    expect(searchFromFilters({ status: '', category: '', q: '', page: 1 }).toString()).toBe('')
    expect(parse('')).toEqual({ status: '', category: '', q: '', page: 1 })
  })

  it.each([
    ['status=bogus', { status: '' }],
    ['status=ARCHIVED', { status: '' }],
    ['page=0', { page: 1 }],
    ['page=-4', { page: 1 }],
    ['page=abc', { page: 1 }],
    ['page=1.5', { page: 1 }],
    ['page=99999999', { page: 1 }],
    ['q=%20%20', { q: '' }],
    [`q=${'x'.repeat(500)}`, { q: 'x'.repeat(100) }],
  ])('ignores nonsense in %s so a hand-edited link never breaks the page', (search, expected) => {
    expect(parse(search)).toMatchObject(expected)
  })

  it('trims what was typed', () => {
    expect(parse('q=%20silk%20&category=%20kurtas').q).toBe('silk')
    expect(parse('category=%20kurtas%20').category).toBe('kurtas')
  })

  it('knows when a filter is on, and that the page alone is not one', () => {
    expect(hasActiveFilters(parse(''))).toBe(false)
    expect(hasActiveFilters(parse('page=4'))).toBe(false)
    expect(hasActiveFilters(parse('q=a'))).toBe(true)
    expect(hasActiveFilters(parse('status=draft'))).toBe(true)
  })
})

describe('the list query', () => {
  it('sends only the filters that are set, with the page as a limit and an offset', () => {
    expect(queryFromFilters(parse(''))).toEqual({ limit: PAGE_SIZE, offset: 0 })
    expect(queryFromFilters(parse('status=draft&q=a&category=b&page=3'))).toEqual({ status: 'draft', q: 'a', category: 'b', limit: PAGE_SIZE, offset: 2 * PAGE_SIZE })
  })

  it('counts pages, always at least one', () => {
    expect(pageCount(0)).toBe(1)
    expect(pageCount(PAGE_SIZE)).toBe(1)
    expect(pageCount(PAGE_SIZE + 1)).toBe(2)
  })
})
