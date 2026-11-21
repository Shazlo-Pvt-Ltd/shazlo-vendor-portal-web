import { describe, expect, it } from 'vitest'
import type { Schemas } from '../api/model'
import { catalogCopy } from '../copy/catalog'
import {
  ALL_SIZES,
  closestColour,
  closestProductType,
  COLOURS,
  isValidMeasurement,
  matchColour,
  matchGender,
  matchPhotoFile,
  matchProductType,
  MEASUREMENTS,
  PRODUCT_TYPES,
  productProblems,
  productTypesInGroup,
  parseSizesStock,
  SIZE_CHART_GROUP,
  sizeChartGroupFor,
  sizesForType,
  sortSizes,
  SUBMIT_REQUIREMENTS,
  type ProductForSubmit,
} from './catalog'

describe('product types and size charts', () => {
  it('gives every product type a size-chart group, except unstitched pieces', () => {
    expect(PRODUCT_TYPES).toHaveLength(17)
    expect(Object.keys(SIZE_CHART_GROUP).sort()).toEqual([...PRODUCT_TYPES].sort())
    expect(PRODUCT_TYPES.filter((t) => sizeChartGroupFor(t) === null)).toEqual(['Sarees', 'Dupattas', 'Stoles'])
    expect(sizeChartGroupFor('Kurtas')).toBe('dresses')
    expect(sizeChartGroupFor('Jeans')).toBe('bottoms')
    expect(sizeChartGroupFor('Shirts')).toBe('tops')
    expect(sizeChartGroupFor('Blazers')).toBe('jackets')
    expect(sizeChartGroupFor(null)).toBeNull()
  })

  it('lists the measurements of each group and who shares a chart', () => {
    expect(MEASUREMENTS).toEqual({
      bottoms: ['waist', 'hip', 'inseam', 'length'],
      tops: ['chest', 'shoulder', 'sleeve', 'length'],
      dresses: ['bust', 'waist', 'hip', 'length'],
      jackets: ['chest', 'shoulder', 'sleeve', 'length'],
    })
    expect(productTypesInGroup('tops')).toEqual(['Shirts', 'T-shirts', 'Tops'])
    expect(catalogCopy.sizeChart.usedFor(productTypesInGroup('tops'))).toBe('Used for all your shirts, T-shirts and tops')
  })

  it('takes centimetres above 0, up to 300, with one decimal place', () => {
    for (const ok of [96, 96.5, 0.5, 300, 1.1]) expect(isValidMeasurement(ok)).toBe(true)
    for (const bad of [0, -1, 301, 96.55, Number.NaN, '96', null]) expect(isValidMeasurement(bad)).toBe(false)
  })
})

describe('sizes', () => {
  it('offers waist sizes 26–40 for jeans and trousers, and one size for sarees, dupattas and stoles', () => {
    expect(sizesForType('Jeans')).toEqual(['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '26', '27', '28', '29', '30', '31', '32', '33', '34', '35', '36', '37', '38', '39', '40'])
    expect(sizesForType('Sarees')).toEqual(['One size'])
    expect(sizesForType('Kurtas')).toEqual(['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', 'One size'])
    expect(sizesForType(null)).toBe(ALL_SIZES)
  })

  it('sorts sizes in list order', () => {
    expect(sortSizes(['L', '30', 'XS', 'One size', 'M'], (s) => s)).toEqual(['XS', 'M', 'L', 'One size', '30'])
  })

  it('reads "S:4, M:6, L:3, XL:0" into sizes with stock', () => {
    expect(parseSizesStock('S:4, M:6, L:3, XL:0')).toEqual({ ok: true, sizes: [{ size: 'S', stock: 4 }, { size: 'M', stock: 6 }, { size: 'L', stock: 3 }, { size: 'XL', stock: 0 }] })
    expect(parseSizesStock('xl = 2; s-1')).toEqual({ ok: true, sizes: [{ size: 'S', stock: 1 }, { size: 'XL', stock: 2 }] })
    expect(parseSizesStock('30:5, 28:3')).toEqual({ ok: true, sizes: [{ size: '28', stock: 3 }, { size: '30', stock: 5 }] })
    expect(parseSizesStock('Free size:7')).toEqual({ ok: true, sizes: [{ size: 'One size', stock: 7 }] })
    expect(parseSizesStock('')).toMatchObject({ ok: false, problem: 'empty' })
    expect(parseSizesStock('M 6')).toEqual({ ok: false, problem: 'format', value: 'M 6' })
    expect(parseSizesStock('S:4, Kids 8:2')).toEqual({ ok: false, problem: 'size', value: 'Kids 8' })
    expect(parseSizesStock('S:4, s:2')).toEqual({ ok: false, problem: 'duplicate', value: 'S' })
  })
})

describe('colours', () => {
  it('names each colour once, with a swatch, including Multicolour', () => {
    const names = COLOURS.map((c) => c.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toContain('Multicolour')
    for (const c of COLOURS) {
      expect(c.swatch).toBeTruthy()
      if (c.hex !== null) expect(c.hex).toMatch(/^#[0-9A-F]{6}$/)
    }
    expect(COLOURS.find((c) => c.name === 'White')?.border).toBe(true)
  })

  it('matches what sellers type to a named colour', () => {
    expect(matchColour('indigo')).toBe('Indigo')
    expect(matchColour('Off-white')).toBe('Ivory')
    expect(matchColour('multicolor')).toBe('Multicolour')
    expect(matchColour('Navy blue shade')).toBeNull()
    expect(closestColour('Navy blue shade')).toBe('Navy')
  })
})

describe('matching typed text', () => {
  it('matches product types in singular, plural or other common words', () => {
    expect(matchProductType('kurta')).toBe('Kurtas')
    expect(matchProductType('KURTIS')).toBe('Kurtis')
    expect(matchProductType('T shirt')).toBe('T-shirts')
    expect(matchProductType('co-ord set')).toBe('Co-ords')
    expect(matchProductType('Saree')).toBe('Sarees')
    expect(matchProductType('Shawls & wraps')).toBeNull()
    expect(closestProductType('Shawls & wraps')).toBe('Stoles')
    expect(closestProductType('Kurta sets for festive')).toBe('Kurtas')
  })

  it('matches genders', () => {
    expect(matchGender("women's")).toBe('Women')
    expect(matchGender('Male')).toBe('Men')
    expect(matchGender('unisex')).toBe('Unisex')
    expect(matchGender('kids')).toBeNull()
  })

  it('matches photo files to products by name, with the slot when the name ends with one', () => {
    const products = [{ id: 'p_1', title: 'Ajrakh Cotton Kurta' }, { id: 'p_2', title: 'Tie Back Top' }, { id: 'p_3', title: 'Handloom Cotton Shirt — Rust' }]
    expect(matchPhotoFile('Ajrakh Cotton Kurta - back.jpg', products)).toEqual({ product: products[0], angle: 'back' })
    expect(matchPhotoFile('ajrakh-cotton-kurta_tryon2.jpeg', products)).toEqual({ product: products[0], angle: 'tryon' })
    expect(matchPhotoFile('Ajrakh Cotton Kurta front 1.PNG', products)).toEqual({ product: products[0], angle: 'front' })
    expect(matchPhotoFile('Ajrakh Cotton Kurta.jpg', products)).toEqual({ product: products[0], angle: null })
    expect(matchPhotoFile('Tie Back Top.webp', products)).toEqual({ product: products[1], angle: null })
    expect(matchPhotoFile('Handloom Cotton Shirt Rust detail.jpg', products)).toEqual({ product: products[2], angle: 'detail' })
    expect(matchPhotoFile('Something else.jpg', products)).toBeNull()
  })
})

describe('productProblems', () => {
  const image = (angle: Schemas['PhotoAngle'], n = 0) => ({ id: `${angle}-${n}`, url: 'x', angle })
  const ready: ProductForSubmit = {
    title: 'Ajrakh Cotton Kurta',
    gender: 'Women',
    category: 'Kurtas',
    main_colour: 'Indigo',
    material: 'Cotton mul',
    description: 'Hand block-printed.',
    images: [image('front'), image('back'), image('detail'), image('worn'), ...[1, 2, 3, 4, 5].map((n) => image('tryon', n))],
    variants: [{ size: 'M', sku: 'KS-1-M', stock: 0 }],
    price_paise: 249_900,
    mrp_paise: null,
  }

  it('passes a complete product: sold-out sizes count and MRP is optional', () => {
    expect(productProblems(ready, { storeDetailsComplete: true })).toEqual({})
  })

  it('lists every missing requirement in order, with stable keys', () => {
    const empty: ProductForSubmit = { title: ' ', gender: null, category: null, main_colour: null, material: '', description: '', images: [], variants: [], price_paise: null, mrp_paise: null }
    const problems = productProblems(empty, { storeDetailsComplete: false })
    expect(Object.keys(problems)).toEqual([...SUBMIT_REQUIREMENTS])
    expect(problems.photos).toBe('Add the front, back, detail and worn photos.')
    expect(problems.tryon).toBe('Add 5 more try-on photos. We need 5 photos of real people wearing it.')
    expect(problems.store_details).toBe('Finish your store details first.')
  })

  it('names only the photos that are missing, and how many try-on photos are left', () => {
    const problems = productProblems({ ...ready, images: ready.images.filter((i) => i.angle !== 'back').slice(0, 5) }, { storeDetailsComplete: true })
    expect(problems).toEqual({ photos: 'Add the back photo.', tryon: 'Add 3 more try-on photos. We need 5 photos of real people wearing it.' })
  })

  it('still refuses a selling price above the MRP', () => {
    expect(productProblems({ ...ready, mrp_paise: 199_900 }, { storeDetailsComplete: true })).toEqual({ price_paise: 'Selling price cannot be above the MRP.' })
  })
})
