import { describe, expect, it } from 'vitest'
import {
  asArray,
  genderFromApi,
  genderToApi,
  newProductCode,
  oneOf,
  productStatusFromApi,
  productTypeFromApi,
  productTypeToApi,
  textOrNull,
} from './common'

describe('enum mapping', () => {
  it('reads the product type in any case and writes it in lower case', () => {
    expect(productTypeFromApi('kurtas')).toBe('Kurtas')
    expect(productTypeFromApi('T-SHIRTS')).toBe('T-shirts')
    expect(productTypeFromApi('co-ords')).toBe('Co-ords')
    expect(productTypeToApi('Co-ords')).toBe('co-ords')
    expect(productTypeToApi(null)).toBeNull()
  })

  it('understands the singular a seller may have typed in main portal', () => {
    expect(productTypeFromApi('kurta')).toBe('Kurtas')
  })

  it('turns a product type it does not know into null instead of guessing', () => {
    expect(productTypeFromApi('spacesuits')).toBeNull()
    expect(productTypeFromApi(null)).toBeNull()
    expect(productTypeFromApi(42)).toBeNull()
  })

  it('maps genders both ways and drops unknown ones', () => {
    expect(genderFromApi('women')).toBe('Women')
    expect(genderFromApi('unisex')).toBe('Unisex')
    expect(genderFromApi('kids')).toBeNull()
    expect(genderToApi('Men')).toBe('men')
    expect(genderToApi(null)).toBeNull()
  })

  it('reads an unknown product status as a draft', () => {
    expect(productStatusFromApi('approved')).toBe('approved')
    expect(productStatusFromApi('suspended_by_admin')).toBe('draft')
    expect(productStatusFromApi(undefined)).toBe('draft')
  })

  it('oneOf accepts only listed values', () => {
    expect(oneOf(['a', 'b'] as const, 'b')).toBe('b')
    expect(oneOf(['a', 'b'] as const, 'c')).toBeUndefined()
    expect(oneOf([0, 7] as const, 7)).toBe(7)
  })
})

describe('defensive readers', () => {
  it('asArray gives an empty list for anything that is not a list', () => {
    expect(asArray(null)).toEqual([])
    expect(asArray({ length: 2 })).toEqual([])
    expect(asArray([1, 2])).toEqual([1, 2])
  })

  it('textOrNull trims and turns blank text into null', () => {
    expect(textOrNull('  Cotton ')).toBe('Cotton')
    expect(textOrNull('   ')).toBeNull()
    expect(textOrNull(undefined)).toBeNull()
  })
})

describe('newProductCode', () => {
  it('makes a short code without the letters people misread', () => {
    const code = newProductCode()
    expect(code).toMatch(/^P-[0-9A-HJKMNP-TV-Z]{8}$/)
  })

  it('makes a different code each time', () => {
    const codes = new Set(Array.from({ length: 50 }, () => newProductCode()))
    expect(codes.size).toBe(50)
  })
})
