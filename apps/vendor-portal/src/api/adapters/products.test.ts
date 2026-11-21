import { describe, expect, it } from 'vitest'
import { ApiError } from '../errors'
import type { ProductOut, ProductSummaryIn, RevisionOut } from '../wire'
import {
  addImage,
  contentFromInput,
  createBodyFromInput,
  hasSummaryFields,
  moveImage,
  productFromApi,
  productInputField,
  removeImage,
  submitErrors,
  summaryFromApi,
  summaryFromProduct,
} from './products'

const T0 = '2026-11-01T10:00:00Z'
const T1 = '2026-11-02T10:00:00Z'
const T2 = '2026-11-03T10:00:00Z'

function revision(overrides: Partial<RevisionOut> = {}): RevisionOut {
  return {
    id: 'rev-1',
    version: 1,
    state: 'editing',
    title: 'Ajrakh Kurta',
    description: 'Block printed.',
    category: 'kurtas',
    subcategory: 'straight',
    gender: 'women',
    fabric: 'Cotton mul',
    weight_grams: 350,
    returnable: true,
    return_window_days: 7,
    main_colour: 'Indigo',
    other_colours: ['Red'],
    variants: [
      { id: 'v-m', sku: 'KS-1-M', size: 'M', color: '', price_paise: 249900, mrp_paise: 299900, is_active: true, stock: 4 },
      { id: 'v-s', sku: 'KS-1-S', size: 'S', color: '', price_paise: 249900, mrp_paise: 299900, is_active: true, stock: 2 },
    ],
    images: [
      { asset_id: 'a-back', url: 'https://res.cloudinary.com/x/back.jpg', position: 2, alt_text: null, angle: 'back' },
      { asset_id: 'a-front', url: 'https://res.cloudinary.com/x/front.jpg', position: 1, alt_text: 'Front', angle: 'front' },
      { asset_id: 'a-try', url: 'https://res.cloudinary.com/x/try.jpg', position: 3, alt_text: null, angle: 'tryon' },
    ],
    submitted_at: null,
    review: null,
    updated_at: T1,
    ...overrides,
  }
}

function product(overrides: Partial<ProductOut> = {}): ProductOut {
  return {
    id: 'p-1',
    sku: 'KS-1',
    status: 'draft',
    version: 1,
    created_at: T0,
    updated_at: T1,
    live: null,
    working: revision(),
    ...overrides,
  }
}

describe('productFromApi', () => {
  it('maps a draft: product type, gender, material, sizes, one price and photos in slot order', () => {
    const p = productFromApi(product())
    expect(p).toMatchObject({
      id: 'p-1',
      sku: 'KS-1',
      status: 'draft',
      title: 'Ajrakh Kurta',
      description: 'Block printed.',
      category: 'Kurtas',
      gender: 'Women',
      material: 'Cotton mul',
      main_colour: 'Indigo',
      other_colours: ['Red'],
      price_paise: 249900,
      mrp_paise: 299900,
      review: { state: 'none' },
      edit_in_review: false,
      updated_at: T1,
    })
    expect(p.variants).toEqual([
      { size: 'S', sku: 'KS-1-S', stock: 2 },
      { size: 'M', sku: 'KS-1-M', stock: 4 },
    ])
    expect(p.images.map((i) => [i.id, i.angle])).toEqual([
      ['a-front', 'front'],
      ['a-back', 'back'],
      ['a-try', 'tryon'],
    ])
    expect(p.history).toEqual([{ at: T0, event: 'created' }])
  })

  it('shows a change to a live product as "changes in review" while the live version stays', () => {
    const live = revision({ id: 'rev-1', state: 'live', title: 'Old title', submitted_at: T0, review: { status: 'approved', reason: null, decided_at: T1 } })
    const working = revision({ id: 'rev-2', version: 2, state: 'in_review', title: 'New title', submitted_at: T2 })
    const p = productFromApi(product({ status: 'approved', live, working }))
    expect(p.status).toBe('approved')
    expect(p.edit_in_review).toBe(true)
    expect(p.title).toBe('New title')
    expect(p.review).toEqual({ state: 'waiting', at: T2 })
  })

  it('carries the reviewer\'s reason when the product was sent back', () => {
    const working = revision({ state: 'rejected', submitted_at: T1, review: { status: 'rejected', reason: 'Back photo is missing.', decided_at: T2 } })
    const p = productFromApi(product({ status: 'rejected', working }))
    expect(p.review).toEqual({ state: 'rejected', reason: 'Back photo is missing.', at: T2 })
    expect(p.history[0]).toEqual({ at: T2, event: 'rejected', note: 'Back photo is missing.' })
    expect(p.history.map((h) => h.event)).toEqual(['rejected', 'submitted', 'created'])
  })

  it('reads an approved product from its live revision', () => {
    const live = revision({ state: 'live', submitted_at: T1, review: { status: 'approved', reason: null, decided_at: T2 } })
    const p = productFromApi(product({ status: 'approved', live, working: null }))
    expect(p.review).toEqual({ state: 'approved', at: T2 })
    expect(p.edit_in_review).toBe(false)
    expect(p.history.map((h) => h.event)).toEqual(['approved', 'submitted', 'created'])
  })

  it('adds an archived entry for an archived product', () => {
    const p = productFromApi(product({ status: 'archived', updated_at: T2 }))
    expect(p.history[0]).toEqual({ at: T2, event: 'archived' })
  })

  it('a draft with sizes but no price yet has no price', () => {
    const working = revision({ variants: [{ id: 'v', sku: 'KS-1-M', size: 'M', color: '', price_paise: null, mrp_paise: null, is_active: true, stock: 1 }] })
    expect(productFromApi(product({ working }))).toMatchObject({ price_paise: null, mrp_paise: null })
  })

  it('leaves out sizes that are switched off', () => {
    const working = revision({
      variants: [
        { id: 'v', sku: 'KS-1-M', size: 'M', color: '', price_paise: 100, mrp_paise: null, is_active: false, stock: 1 },
        { id: 'w', sku: 'KS-1-L', size: 'L', color: '', price_paise: 100, mrp_paise: null, is_active: true, stock: 3 },
      ],
    })
    expect(productFromApi(product({ working })).variants).toEqual([{ size: 'L', sku: 'KS-1-L', stock: 3 }])
  })

  it('copes with a malformed or partial answer instead of crashing a screen', () => {
    const broken = {
      id: 'p-9',
      sku: 'X',
      status: 'quarantined',
      created_at: T0,
      updated_at: T0,
      live: null,
      working: {
        title: null,
        category: 'spacesuits',
        gender: 'kids',
        other_colours: ['Red', 'Blue', 'Green'],
        variants: [{ sku: 'X-M', size: 'M', stock: null, price_paise: 'free' }],
        images: [{ asset_id: 'a', url: 'https://res.cloudinary.com/a.jpg', position: 1, angle: 'sideways' }, null],
      },
    } as unknown as ProductOut
    const p = productFromApi(broken)
    expect(p).toMatchObject({ status: 'draft', title: '', category: null, gender: null, material: '', description: '', price_paise: null })
    expect(p.other_colours).toEqual(['Red', 'Blue'])
    expect(p.variants).toEqual([{ size: 'M', sku: 'X-M', stock: 0 }])
    expect(p.images).toEqual([{ id: 'a', url: 'https://res.cloudinary.com/a.jpg', angle: 'extra' }])
  })

  it('makes an empty product of one with no revision at all', () => {
    const p = productFromApi(product({ working: null, live: null }))
    expect(p).toMatchObject({ title: '', images: [], variants: [], category: null })
  })
})

describe('summaryFromProduct', () => {
  it('adds up stock, picks the front photo and keeps the price', () => {
    const s = summaryFromProduct(productFromApi(product()))
    expect(s).toEqual({
      id: 'p-1',
      title: 'Ajrakh Kurta',
      sku: 'KS-1',
      category: 'Kurtas',
      main_colour: 'Indigo',
      status: 'draft',
      price_paise: 249900,
      mrp_paise: 299900,
      stock: 6,
      thumbnail_url: 'https://res.cloudinary.com/x/front.jpg',
      updated_at: T1,
      edit_in_review: false,
      publishing: false,
    })
  })

  it('has no stock figure before any size is added', () => {
    expect(summaryFromProduct(productFromApi(product({ working: revision({ variants: [], images: [] }) })))).toMatchObject({ stock: null, thumbnail_url: null })
  })
})

describe('contentFromInput', () => {
  const base = product()
  const code = () => 'NEW-CODE'

  it('keeps what the portal does not edit, because a PUT replaces everything', () => {
    const body = contentFromInput({ title: 'Renamed' }, base, code)
    expect(body).toMatchObject({
      title: 'Renamed',
      subcategory: 'straight',
      weight_grams: 350,
      returnable: true,
      return_window_days: 7,
      category: 'kurtas',
      gender: 'women',
      fabric: 'Cotton mul',
    })
    expect(body.images).toEqual([
      { asset_id: 'a-front', alt_text: 'Front', angle: 'front' },
      { asset_id: 'a-back', alt_text: null, angle: 'back' },
      { asset_id: 'a-try', alt_text: null, angle: 'tryon' },
    ])
  })

  it('maps the screen\'s names to vendor-api\'s and turns blank text into null', () => {
    const body = contentFromInput({ category: 'T-shirts', gender: 'Unisex', material: '  ', description: '', main_colour: null, other_colours: [] }, base, code)
    expect(body).toMatchObject({ category: 't-shirts', gender: 'unisex', fabric: null, description: null, main_colour: null, other_colours: [] })
  })

  it('sets the one price on every size', () => {
    const body = contentFromInput({ price_paise: 199900, mrp_paise: null }, base, code)
    expect(body.variants?.map((v) => [v.sku, v.price_paise, v.mrp_paise])).toEqual([
      ['KS-1-M', 199900, null],
      ['KS-1-S', 199900, null],
    ])
  })

  it('keeps the codes of sizes that stay, makes codes for new ones and drops removed ones', () => {
    const body = contentFromInput({ variants: [{ size: 'M', sku: '', stock: 9 }, { size: 'One size', sku: '', stock: 1 }] }, base, code)
    expect(body.variants).toEqual([
      { sku: 'KS-1-M', size: 'M', color: '', is_active: true, price_paise: 249900, mrp_paise: 299900, stock: 9 },
      { sku: 'KS-1-OS', size: 'One size', color: '', is_active: true, price_paise: 249900, mrp_paise: 299900, stock: 1 },
    ])
  })

  it('never sends a negative or fractional stock', () => {
    const body = contentFromInput({ variants: [{ size: 'M', sku: 'KS-1-M', stock: -3 }, { size: 'L', sku: '', stock: 2.7 }] }, base, code)
    expect(body.variants?.map((v) => v.stock)).toEqual([0, 2])
  })

  it('starts a new product from nothing, with a portal-made code', () => {
    const body = createBodyFromInput({ title: 'Kala Overshirt', variants: [{ size: 'L', sku: '', stock: 1 }], price_paise: 120000 }, code)
    expect(body).toEqual({
      sku: 'NEW-CODE',
      title: 'Kala Overshirt',
      category: null,
      gender: null,
      description: null,
      fabric: null,
      main_colour: null,
      other_colours: [],
      variants: [{ sku: 'NEW-CODE-L', size: 'L', color: '', is_active: true, price_paise: 120000, mrp_paise: null, stock: 1 }],
      images: [],
    })
  })
})

describe('photo slots', () => {
  const content = contentFromInput({}, product(), () => 'x')

  it('a named slot holds one photo: adding replaces it', () => {
    const next = addImage(content, { assetId: 'a-new', angle: 'front' })
    expect(next.images?.filter((i) => i.angle === 'front')).toEqual([{ asset_id: 'a-new', alt_text: null, angle: 'front' }])
    expect(next.images).toHaveLength(3)
  })

  it('extra and try-on photos add up', () => {
    const next = addImage(content, { assetId: 'a-try-2', angle: 'tryon' })
    expect(next.images?.filter((i) => i.angle === 'tryon').map((i) => i.asset_id)).toEqual(['a-try', 'a-try-2'])
  })

  it('moving to a taken named slot swaps the two photos', () => {
    const next = moveImage(content, 'a-back', 'front')
    expect(next.images?.find((i) => i.asset_id === 'a-back')?.angle).toBe('front')
    expect(next.images?.find((i) => i.asset_id === 'a-front')?.angle).toBe('back')
  })

  it('moving to an empty slot just moves it', () => {
    const next = moveImage(content, 'a-try', 'detail')
    expect(next.images?.find((i) => i.asset_id === 'a-try')?.angle).toBe('detail')
  })

  it('removes one photo', () => {
    expect(removeImage(content, 'a-back').images?.map((i) => i.asset_id)).toEqual(['a-front', 'a-try'])
  })
})

describe('field names in a 422', () => {
  it('names vendor-api\'s fields the way the editor does', () => {
    expect(productInputField('fabric')).toBe('material')
    expect(productInputField('variants.0.price_paise')).toBe('price_paise')
    expect(productInputField('variants.3.mrp_paise')).toBe('mrp_paise')
    expect(productInputField('variants.1.stock')).toBe('variants')
    expect(productInputField('images.2.asset_id')).toBe('photos')
    expect(productInputField('other_colours.1')).toBe('other_colours')
    expect(productInputField('category')).toBe('category')
    expect(productInputField('weight_grams')).toBeNull()
  })

  it('maps a refused submit to the editor\'s requirement keys', () => {
    const refused = new ApiError({
      status: 422,
      code: 'product_incomplete',
      message: 'Finish the product first.',
      fieldErrors: { fabric: 'Add the material', tryon_photos: 'Add 3 more try-on photos', photos: 'Add the back photo', store_details: 'Finish your store details first' },
    })
    const mapped = submitErrors(refused) as ApiError
    expect(mapped.fieldErrors).toEqual({
      material: 'Add the material',
      tryon: 'Add 3 more try-on photos',
      photos: 'Add the back photo',
      store_details: 'Finish your store details first',
    })
  })

  it('leaves other errors alone', () => {
    const conflict = new ApiError({ status: 409, code: 'product_in_review', message: 'In review' })
    expect((submitErrors(conflict) as ApiError).status).toBe(409)
  })
})

describe('list rows that carry their own fields (proposed)', () => {
  const row: ProductSummaryIn = {
    id: 'p-1',
    sku: 'KS-1',
    status: 'approved',
    version: 4,
    title: 'Ajrakh Kurta',
    category: 'kurtas',
    has_pending_changes: true,
    updated_at: T1,
    price_paise: 249900,
    mrp_paise: 299900,
    stock: 6,
    thumbnail_url: 'https://res.cloudinary.com/x/front.jpg',
    main_colour: 'Indigo',
    gender: 'women',
    working_state: 'in_review',
  }

  it('knows a row with the proposed fields from one vendor-api sends today', () => {
    expect(hasSummaryFields(row)).toBe(true)
    const { price_paise: _p, mrp_paise: _m, stock: _s, thumbnail_url: _t, main_colour: _c, gender: _g, working_state: _w, ...today } = row
    expect(hasSummaryFields(today)).toBe(false)
    expect(hasSummaryFields({ ...today, price_paise: 100 })).toBe(false)
  })

  it('reads a row as the list shows it, the same as from the whole product', () => {
    expect(summaryFromApi(row)).toEqual({
      id: 'p-1',
      title: 'Ajrakh Kurta',
      sku: 'KS-1',
      category: 'Kurtas',
      main_colour: 'Indigo',
      status: 'approved',
      price_paise: 249900,
      mrp_paise: 299900,
      stock: 6,
      thumbnail_url: 'https://res.cloudinary.com/x/front.jpg',
      updated_at: T1,
      edit_in_review: true,
      publishing: false,
    })
  })

  it('a change that is still being edited is not "in review"', () => {
    expect(summaryFromApi({ ...row, working_state: 'editing' }).edit_in_review).toBe(false)
    expect(summaryFromApi({ ...row, status: 'draft' }).edit_in_review).toBe(false)
  })

  it('reads odd values safely', () => {
    expect(summaryFromApi({ ...row, status: 'quarantined', category: 'spacesuits', stock: -3, price_paise: 'free' as never, thumbnail_url: 7 as never })).toMatchObject({
      status: 'draft',
      category: null,
      stock: 0,
      price_paise: null,
      thumbnail_url: null,
    })
    expect(summaryFromApi({ ...row, stock: null }).stock).toBeNull()
  })
})
