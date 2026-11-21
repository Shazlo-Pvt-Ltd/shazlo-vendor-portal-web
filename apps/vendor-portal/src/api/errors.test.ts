import { describe, expect, it } from 'vitest'
import { ApiError, NetworkError, remapFieldErrors } from './errors'

describe('ApiError.fields', () => {
  it('is the same as fieldErrors, for screens written against Build 2', () => {
    const error = new ApiError({ status: 422, code: 'validation_error', message: 'bad', fieldErrors: { email: 'Enter an email' } })
    expect(error.fields).toEqual({ email: 'Enter an email' })
    expect(error.fields).toBe(error.fieldErrors)
  })
})

describe('remapFieldErrors', () => {
  const error = new ApiError({
    status: 422,
    code: 'validation_error',
    message: 'Check the highlighted fields.',
    requestId: 'req-1',
    retryAfter: 3,
    fieldErrors: { fabric: 'Too long', 'variants.0.price_paise': 'Must be above 0', 'variants.1.price_paise': 'Must be above 0', weight_grams: 'x' },
  })

  it('renames keys, keeps the first message per new key and drops keys mapped to null', () => {
    const mapped = remapFieldErrors(error, (key) => {
      if (key === 'fabric') return 'material'
      if (key.endsWith('.price_paise')) return 'price_paise'
      return null
    })
    expect(mapped).toBeInstanceOf(ApiError)
    expect(mapped.fieldErrors).toEqual({ material: 'Too long', price_paise: 'Must be above 0' })
  })

  it('keeps everything else about the error', () => {
    const mapped = remapFieldErrors(error, (key) => key)
    expect(mapped).toMatchObject({ status: 422, code: 'validation_error', message: 'Check the highlighted fields.', requestId: 'req-1', retryAfter: 3 })
  })

  it('passes anything that is not an ApiError through untouched', () => {
    const network = new NetworkError('timeout')
    expect(remapFieldErrors(network, () => 'x')).toBe(network)
    const plain = new Error('boom')
    expect(remapFieldErrors(plain, () => 'x')).toBe(plain)
  })
})
