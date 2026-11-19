import { describe, expect, it } from 'vitest'
import { paiseToRupees, rupeesToPaise } from '../signup/money'
import { editingState } from './editing'
import {
  describeMissing,
  emptyVariant,
  hasErrors,
  missingForSubmit,
  move,
  newProductValues,
  sameContent,
  serverErrorsToFields,
  toBody,
  toCreateBody,
  toValues,
  validateProduct,
  type ProductValues,
  type VariantValues,
} from './form'
import { detail, fullRevision as revision } from './testing'

const variant = (overrides: Partial<VariantValues> = {}): VariantValues => ({ ...emptyVariant(), sku: 'K-M', size: 'M', color: 'Indigo', price: '1499', ...overrides })

const values = (overrides: Partial<ProductValues> = {}): ProductValues => ({
  ...newProductValues(),
  sku: 'KURTA-001',
  title: 'Block-print kurta',
  category: 'kurtas',
  gender: 'women',
  variants: [variant()],
  images: [{ assetId: 'a1', url: 'https://res.cloudinary.com/x/a1.jpg', alt: 'Front' }],
  ...overrides,
})

describe('money', () => {
  it.each([
    ['0.10', 10],
    ['1999.99', 199999],
    ['0.01', 1],
    ['99.90', 9990],
    ['1,000', 100000],
    ['1000.5', 100050],
  ])('turns ₹%s into %i paise exactly, and back', (rupees, paise) => {
    expect(rupeesToPaise(rupees)).toBe(paise)
    expect(rupeesToPaise(paiseToRupees(paise))).toBe(paise)
  })

  it('shows paise as the rupees a vendor would type', () => {
    expect(paiseToRupees(10)).toBe('0.10')
    expect(paiseToRupees(199999)).toBe('1999.99')
    expect(paiseToRupees(149900)).toBe('1499')
  })

  it('sends prices as whole paise, and an empty MRP as the price', () => {
    const body = toBody(values({ variants: [variant({ price: '0.10', mrp: '' }), variant({ sku: 'K-L', size: 'L', price: '1999.99', mrp: '2,499.50' })] }))
    expect(body.variants).toEqual([
      { sku: 'K-M', size: 'M', color: 'Indigo', price_paise: 10, mrp_paise: 10, is_active: true },
      { sku: 'K-L', size: 'L', color: 'Indigo', price_paise: 199999, mrp_paise: 249950, is_active: true },
    ])
  })

  it('round-trips a revision through the form without changing a paisa', () => {
    const rev = revision({
      variants: [
        { id: 'v1', sku: 'A', size: 'S', color: '', price_paise: 10, mrp_paise: 10, is_active: true },
        { id: 'v2', sku: 'B', size: 'M', color: '', price_paise: 199999, mrp_paise: 200000, is_active: false },
      ],
    })
    const form = toValues('SKU', rev)
    expect(form.variants.map((v) => [v.price, v.mrp])).toEqual([['0.10', '0.10'], ['1999.99', '2000']])
    expect((toBody(form).variants ?? []).map((v) => [v.price_paise, v.mrp_paise, v.is_active])).toEqual([[10, 10, true], [199999, 200000, false]])
  })
})

describe('validateProduct', () => {
  it('accepts a complete product', () => {
    expect(hasErrors(validateProduct(values(), { forSubmit: true, creating: true }))).toBe(false)
  })

  it('needs a title, a category, who it is for, and a SKU when creating', () => {
    const { fields } = validateProduct(values({ sku: ' ', title: '', category: '', gender: '' }), { creating: true })
    expect(Object.keys(fields).sort()).toEqual(['category', 'gender', 'sku', 'title'])
  })

  it('checks SKUs like the API does', () => {
    expect(validateProduct(values({ sku: '-starts-with-dash' }), { creating: true }).fields.sku).toMatch(/starting with a letter or digit/)
    expect(validateProduct(values({ sku: 'OK 1/2_x.y-z' }), { creating: true }).fields.sku).toBeUndefined()
    const bad = variant({ sku: 'bad*sku' })
    expect(validateProduct(values({ variants: [bad] })).variants[bad.key]?.sku).toMatch(/Use letters/)
  })

  it('does not let the MRP be below the price', () => {
    const v = variant({ price: '1000', mrp: '999.99' })
    expect(validateProduct(values({ variants: [v] })).variants[v.key]?.mrp).toBe('The MRP cannot be below the price.')
    const same = variant({ price: '1000', mrp: '1000.00' })
    expect(validateProduct(values({ variants: [same] })).variants[same.key]).toBeUndefined()
  })

  it('needs a price above zero, with at most two decimals', () => {
    const zero = variant({ price: '0' })
    const tooPrecise = variant({ sku: 'X', size: 'L', price: '10.999' })
    const missing = variant({ sku: 'Y', size: 'XL', price: '' })
    const { variants } = validateProduct(values({ variants: [zero, tooPrecise, missing] }))
    expect(variants[zero.key]?.price).toMatch(/more than ₹0/)
    expect(variants[tooPrecise.key]?.price).toMatch(/two decimals/)
    expect(variants[missing.key]?.price).toBe('Enter the price.')
  })

  it('finds a SKU used twice in the product, ignoring letter case', () => {
    const first = variant({ sku: 'k-m' })
    const second = variant({ sku: 'K-M', size: 'L' })
    const { variants } = validateProduct(values({ variants: [first, second] }))
    expect(variants[first.key]).toBeUndefined()
    expect(variants[second.key]?.sku).toMatch(/Another variant of this product has this SKU/)
  })

  it('finds two variants with the same size and colour', () => {
    const first = variant({ sku: 'A' })
    const second = variant({ sku: 'B', size: 'm', color: 'indigo' })
    expect(validateProduct(values({ variants: [first, second] })).variants[second.key]?.row).toMatch(/same size and colour/)
  })

  it('needs a return window only when the product can be returned', () => {
    expect(validateProduct(values({ returnable: true, returnDays: '' })).fields.returnDays).toMatch(/how many days/)
    expect(validateProduct(values({ returnable: true, returnDays: '31' })).fields.returnDays).toMatch(/0 to 30/)
    expect(validateProduct(values({ returnable: true, returnDays: '0' })).fields.returnDays).toBeUndefined()
    expect(validateProduct(values({ returnable: false, returnDays: 'x' })).fields.returnDays).toBeUndefined()
    expect(toBody(values({ returnable: false, returnDays: '7' })).return_window_days).toBeNull()
    expect(toBody(values({ returnable: true, returnDays: '7' })).return_window_days).toBe(7)
  })

  it('takes the weight in whole grams', () => {
    expect(validateProduct(values({ weight: '350.5' })).fields.weight).toMatch(/whole grams/)
    expect(validateProduct(values({ weight: '0' })).fields.weight).toMatch(/whole grams/)
    expect(toBody(values({ weight: ' 350 ' })).weight_grams).toBe(350)
    expect(toBody(values({ weight: '' })).weight_grams).toBeNull()
  })

  it('lets a draft be saved without variants or images, but not submitted', () => {
    const empty = values({ variants: [], images: [] })
    expect(hasErrors(validateProduct(empty))).toBe(false)
    const { fields } = validateProduct(empty, { forSubmit: true })
    expect(fields.variants).toMatch(/active variant/)
    expect(fields.images).toMatch(/image/)
    expect(describeMissing(missingForSubmit(empty))).toBe('an active variant and an image')
    expect(describeMissing(missingForSubmit(values({ variants: [variant({ isActive: false })] })))).toBe('an active variant')
  })
})

describe('the request body', () => {
  it('trims text and sends empty optional text as null', () => {
    const body = toCreateBody(values({ sku: ' KURTA-001 ', title: '  Kurta ', description: '  ', fabric: ' cotton ', subcategory: '' }))
    expect(body).toMatchObject({ sku: 'KURTA-001', title: 'Kurta', description: null, fabric: 'cotton', subcategory: null })
  })

  it('sends images in their order, with empty descriptions as null', () => {
    const body = toBody(values({ images: [{ assetId: 'b', url: '', alt: '' }, { assetId: 'a', url: '', alt: ' Back ' }] }))
    expect(body.images).toEqual([{ asset_id: 'b', alt_text: null }, { asset_id: 'a', alt_text: 'Back' }])
  })

  it('compares what would be saved, not keys or picture addresses', () => {
    const a = values()
    expect(sameContent(a, { ...a, variants: a.variants.map((v) => ({ ...v, key: 'other' })) })).toBe(true)
    expect(sameContent(a, { ...a, images: a.images.map((i) => ({ ...i, url: 'https://elsewhere' })) })).toBe(true)
    expect(sameContent(a, { ...a, title: 'Another' })).toBe(false)
    expect(sameContent(a, { ...a, variants: [{ ...a.variants[0]!, price: '1499.5' }] })).toBe(false)
    // A half-typed price is still a change.
    expect(sameContent(a, { ...a, variants: [{ ...a.variants[0]!, price: '14x' }] })).toBe(false)
  })
})

describe('server errors', () => {
  it("puts a 422's messages next to the field, the variant and the image", () => {
    const form = values({ images: [{ assetId: 'a1', url: '', alt: '' }] })
    const key = form.variants[0]!.key
    const { errors, form: message } = serverErrorsToFields(
      {
        title: 'Too long',
        weight_grams: 'Must be positive',
        'variants.0.price_paise': 'Too large',
        'images.0.alt_text': 'Too long',
        _form: 'Value error: two variants cannot have the same size and colour',
      },
      form,
      'fallback',
    )
    expect(errors.fields).toEqual({ title: 'Too long', weight: 'Must be positive' })
    expect(errors.variants[key]).toEqual({ price: 'Too large' })
    expect(errors.images).toEqual({ a1: 'Too long' })
    expect(message).toMatch(/same size and colour/)
  })

  it("words the API's MRP rule for the vendor and puts it on the MRP", () => {
    const form = values()
    const { errors } = serverErrorsToFields({ 'variants.0': 'mrp_paise must not be below price_paise' }, form, 'x')
    expect(errors.variants[form.variants[0]!.key]).toEqual({ mrp: 'The MRP cannot be below the price.' })
  })

  it('falls back to the message when nothing is about a field', () => {
    expect(serverErrorsToFields({}, values(), 'Every image must be one of your uploaded product images').form).toBe(
      'Every image must be one of your uploaded product images',
    )
  })
})

describe('move', () => {
  it('moves an item and leaves the original alone', () => {
    const items = ['a', 'b', 'c']
    expect(move(items, 2, 0)).toEqual(['c', 'a', 'b'])
    expect(move(items, 0, 1)).toEqual(['b', 'a', 'c'])
    expect(move(items, 0, 5)).toEqual(items)
    expect(items).toEqual(['a', 'b', 'c'])
  })
})

describe('editingState', () => {
  it('starts a new draft from its working revision', () => {
    const state = editingState(detail('p1', { working: revision() }))
    expect(state).toMatchObject({ readOnly: false, inReview: false, unsubmitted: true, rejected: null, live: null })
    expect(state.source?.id).toBe('r1')
  })

  it('starts from the live revision when nothing is being edited', () => {
    const live = revision({ id: 'live', state: 'approved' })
    const state = editingState(detail('p1', { status: 'approved', live, working: null }))
    expect(state.source?.id).toBe('live')
    expect(state.unsubmitted).toBe(false)
  })

  it('is read-only while a version is in review, and when archived', () => {
    expect(editingState(detail('p1', { status: 'pending_review', working: revision({ state: 'in_review' }) })).readOnly).toBe(true)
    expect(editingState(detail('p1', { status: 'archived', live: revision() })).readOnly).toBe(true)
  })

  it("gives a rejected version's reason", () => {
    const working = revision({ version: 2, state: 'rejected', review: { status: 'rejected', reason: 'Blurry photos', decided_at: null } })
    expect(editingState(detail('p1', { status: 'rejected', working })).rejected).toEqual({ version: 2, reason: 'Blurry photos' })
  })
})
