import { describe, expect, it } from 'vitest'
import {
  EMPTY_BRAND,
  normaliseInstagram,
  paiseToRupees,
  sameContent,
  serverErrorsToFields,
  toBody,
  toValues,
  validateBrand,
  type BrandDraft,
  type BrandValues,
} from './rules'

const valid: BrandValues = {
  ...EMPTY_BRAND,
  brandName: 'Atelier Rao',
  categories: ['kurtas'],
  priceMin: '999',
  priceMax: '9,999.50',
}

describe('prices in rupees and paise', () => {
  it('converts exactly, with no floating-point drift', () => {
    expect(toBody({ ...valid, priceMin: '99.90', priceMax: '1,000' })).toMatchObject({ price_min_paise: 9990, price_max_paise: 100000 })
    expect(toBody({ ...valid, priceMin: '0.10', priceMax: '0.30' })).toMatchObject({ price_min_paise: 10, price_max_paise: 30 })
    expect(toBody({ ...valid, priceMin: '19.99', priceMax: '1.15' })).toMatchObject({ price_min_paise: 1999, price_max_paise: 115 })
  })

  it('shows saved paise as the rupees a vendor would type', () => {
    expect(paiseToRupees(99900)).toBe('999')
    expect(paiseToRupees(99950)).toBe('999.50')
    expect(paiseToRupees(5)).toBe('0.05')
    expect(paiseToRupees(0)).toBe('0')
  })

  it('round-trips through the form', () => {
    const body = toBody({ ...valid, priceMin: '12.34', priceMax: '56' })
    expect([paiseToRupees(body.price_min_paise), paiseToRupees(body.price_max_paise)]).toEqual(['12.34', '56'])
  })

  it('refuses amounts that are not plain rupees, and a highest price below the lowest', () => {
    expect(validateBrand({ ...valid, priceMin: '12.345' }).priceMin).toBeTruthy()
    expect(validateBrand({ ...valid, priceMin: 'abc' }).priceMin).toBeTruthy()
    expect(validateBrand({ ...valid, priceMin: '', priceMax: '' })).toMatchObject({ priceMin: 'Enter your lowest price.', priceMax: 'Enter your highest price.' })
    expect(validateBrand({ ...valid, priceMin: '500', priceMax: '100' }).priceMax).toMatch(/cannot be below/)
    expect(validateBrand({ ...valid, priceMin: '10000000000.01' }).priceMin).toBeTruthy()
  })
})

describe('the Instagram handle', () => {
  it.each([
    ['@atelier.rao', 'atelier.rao'],
    ['atelier_rao', 'atelier_rao'],
    ['  @brand  ', 'brand'],
    ['instagram.com/atelier.rao/', 'atelier.rao'],
    ['https://www.instagram.com/atelier.rao?igsh=abc', 'atelier.rao'],
    ['http://instagram.com/Brand_1#top', 'Brand_1'],
    ['', ''],
  ])('reads %j as %j', (typed, handle) => {
    expect(normaliseInstagram(typed)).toBe(handle)
  })

  it.each(['two words', 'a'.repeat(31), 'https://example.com/brand', 'bad!name', '@@x'])('refuses %j', (typed) => {
    expect(normaliseInstagram(typed)).toBeUndefined()
    expect(validateBrand({ ...valid, instagram: typed }).instagram).toBeTruthy()
  })

  it('sends the normalised handle, or null when empty', () => {
    expect(toBody({ ...valid, instagram: 'https://instagram.com/atelier.rao/' }).instagram_handle).toBe('atelier.rao')
    expect(toBody({ ...valid, instagram: '' }).instagram_handle).toBeNull()
  })
})

describe('validation', () => {
  it('accepts a complete page', () => {
    expect(validateBrand(valid, { forSubmit: true })).toEqual({})
  })

  it('needs a category only to submit, so a draft can be saved without one', () => {
    const none = { ...valid, categories: [] }
    expect(validateBrand(none)).toEqual({})
    expect(validateBrand(none, { forSubmit: true }).categories).toMatch(/at least one category/)
  })

  it('checks the length limits and the https address', () => {
    expect(validateBrand({ ...valid, brandName: '  ' }).brandName).toBeTruthy()
    expect(validateBrand({ ...valid, brandName: 'x'.repeat(121) }).brandName).toBeTruthy()
    expect(validateBrand({ ...valid, tagline: 'x'.repeat(161) }).tagline).toBeTruthy()
    expect(validateBrand({ ...valid, about: 'x'.repeat(4001) }).about).toBeTruthy()
    expect(validateBrand({ ...valid, website: 'http://atelier.example' }).website).toBeTruthy()
    expect(validateBrand({ ...valid, website: 'https://atelier .example' }).website).toBeTruthy()
    expect(validateBrand({ ...valid, website: 'https://atelier.example' }).website).toBeUndefined()
    expect(validateBrand({ ...valid, categories: Array.from({ length: 21 }, (_, i) => `c${i}`) }).categories).toBeTruthy()
    expect(validateBrand({ ...valid, categories: ['x'.repeat(81)] }).categories).toBeTruthy()
  })
})

describe('the body sent to the API', () => {
  it('sends every field, with empty optional text as null and categories trimmed and unique', () => {
    expect(toBody({ ...valid, categories: [' kurtas ', 'kurtas', 'dupattas', ' '], logoAssetId: 'logo-1' })).toEqual({
      brand_name: 'Atelier Rao',
      tagline: null,
      about: null,
      logo_asset_id: 'logo-1',
      banner_asset_id: null,
      website_url: null,
      instagram_handle: null,
      categories: ['kurtas', 'dupattas'],
      price_min_paise: 99900,
      price_max_paise: 999950,
    })
  })

  it('compares what would be saved, not how it was typed', () => {
    expect(sameContent(valid, { ...valid, brandName: ' Atelier Rao ', priceMax: '9999.5', instagram: '' })).toBe(true)
    expect(sameContent(valid, { ...valid, tagline: 'New' })).toBe(false)
    expect(sameContent(valid, { ...valid, logoAssetId: 'x' })).toBe(false)
    expect(sameContent(valid, { ...valid, logoUrl: 'https://img.example/x.png' })).toBe(true)
  })

  it('starts the form from a draft', () => {
    const draft = {
      brand_name: 'A', tagline: null, about: null, logo_asset_id: null, logo_url: null, banner_asset_id: 'b', banner_url: 'https://img/b.png',
      website_url: 'https://a.example', instagram_handle: 'a', categories: ['x'], price_min_paise: 150, price_max_paise: 2000,
    } as unknown as BrandDraft
    expect(toValues(draft)).toMatchObject({ brandName: 'A', tagline: '', priceMin: '1.50', priceMax: '20', instagram: 'a', bannerAssetId: 'b' })
  })
})

describe('field errors from the server', () => {
  it('puts each message next to its input and the rest in the form', () => {
    expect(serverErrorsToFields({ brand_name: 'too long', 'categories.2': 'bad', price_max_paise: 'low', other: 'odd' }, 'fallback')).toEqual({
      fields: { brandName: 'too long', categories: 'bad', priceMax: 'low' },
      form: 'odd',
    })
  })

  it('uses the fallback when there is nothing to point at', () => {
    expect(serverErrorsToFields({}, 'Please check the form')).toEqual({ fields: {}, form: 'Please check the form' })
  })
})
