import { describe, expect, it } from 'vitest'
import { baseOf, changedInput, LIMITS, parseRupees, priceIssues, priceWaitsForSize, toInput, type EditorValues } from './form'

const values: EditorValues = {
  title: 'Kala Cotton Overshirt',
  gender: 'Men',
  category: 'Shirts',
  mainColour: 'Indigo',
  otherColours: [],
  material: 'Kala cotton',
  description: 'Hand-spun.',
  sizes: [{ size: 'M', stock: '3' }],
  price: '1,499',
  mrp: '',
}
const base = { sku: 'KS-KAL-011', title: 'Kala Cotton Overshirt', price: 149900, mrp: null, live: false }

describe('parseRupees', () => {
  it.each([
    ['2,499', 249900],
    ['₹ 2,499.50', 249950],
    ['2499', 249900],
    ['', null],
  ])('reads %s', (text, paise) => {
    expect(parseRupees(text)).toEqual({ ok: true, paise })
  })

  it.each(['-5', '12345678', '2.999', 'abc', '1e3', '٢٤٩٩'])('refuses %s', (text) => {
    expect(parseRupees(text)).toEqual({ ok: false })
  })
})

describe('priceIssues', () => {
  it('wants a selling price above 0, not above the MRP, and an MRP above 0', () => {
    expect(priceIssues({ price: '0', mrp: '' }, false).price).toBe('Enter a selling price above ₹0.')
    expect(priceIssues({ price: '3,000', mrp: '2,999' }, false).price).toBe('Selling price cannot be above the MRP.')
    expect(priceIssues({ price: '2,999', mrp: '2,999' }, false)).toEqual({})
    expect(priceIssues({ price: '', mrp: '0' }, false).mrp).toBe('Enter an MRP above ₹0.')
    expect(priceIssues({ price: '', mrp: '' }, true).price).toBe('This product is live, so it needs a selling price.')
  })
})

describe('toInput', () => {
  it('sends what the seller sees, trimmed', () => {
    expect(toInput({ ...values, title: '  Overshirt  ' }, base)).toMatchObject({ title: 'Overshirt', price_paise: 149900, variants: [{ size: 'M', sku: 'KS-KAL-011-M', stock: 3 }] })
  })

  it('keeps the saved name when the name is emptied (vendor-api needs one)', () => {
    expect(toInput({ ...values, title: '   ' }, base).title).toBe('Kala Cotton Overshirt')
  })

  it('keeps the saved price while the typed one is wrong', () => {
    expect(toInput({ ...values, price: '3,000', mrp: '2,000' }, base)).toMatchObject({ price_paise: 149900, mrp_paise: null })
  })

  it('caps stock at 99,999', () => {
    expect(toInput({ ...values, sizes: [{ size: 'M', stock: '9999999' }] }, base).variants).toEqual([{ size: 'M', sku: 'KS-KAL-011-M', stock: 99_999 }])
  })

  it('reads the base from a product', () => {
    expect(baseOf(null)).toEqual({ sku: null, title: '', price: null, mrp: null, live: false })
  })
})

describe('changedInput', () => {
  it('sends only what changed since the last save, so another tab\'s other changes survive', () => {
    const before = toInput(values, base)
    const after = toInput({ ...values, description: 'Hand-spun, hand-woven.' }, base)
    expect(changedInput(after, before)).toEqual({ description: 'Hand-spun, hand-woven.' })
  })

  it('sends a size change with its price, which vendor-api keeps on every size', () => {
    const before = toInput(values, base)
    const after = toInput({ ...values, sizes: [...values.sizes, { size: 'L', stock: '1' }] }, base)
    expect(Object.keys(changedInput(after, before)).sort()).toEqual(['mrp_paise', 'price_paise', 'variants'])
  })

  it('sends the price and the MRP together, so a change to one never loses the other', () => {
    const before = toInput(values, base)
    const after = toInput({ ...values, price: '1,299' }, base)
    expect(changedInput(after, before)).toEqual({ price_paise: 129900, mrp_paise: null })
    const mrpOnly = toInput({ ...values, mrp: '1,999' }, base)
    expect(changedInput(mrpOnly, before)).toEqual({ price_paise: 149900, mrp_paise: 199900 })
  })

  it('sends everything when there is nothing to compare with', () => {
    const after = toInput(values, base)
    expect(changedInput(after, null)).toEqual(after)
  })
})

describe('priceWaitsForSize', () => {
  it('is true while a good price has no size to be saved on', () => {
    expect(priceWaitsForSize({ ...values, sizes: [] })).toBe(true)
    expect(priceWaitsForSize({ ...values, sizes: [], price: '' })).toBe(false)
    expect(priceWaitsForSize({ ...values, sizes: [], price: 'abc' })).toBe(false)
    expect(priceWaitsForSize(values)).toBe(false)
  })
})

describe('LIMITS', () => {
  it('match vendor-api', () => {
    expect(LIMITS).toEqual({ title: 200, material: 80, description: 4000 })
  })
})
