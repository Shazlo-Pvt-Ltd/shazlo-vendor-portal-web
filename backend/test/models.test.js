import { describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import Product from '../models/Product.js'
import PreRegister from '../models/PreRegister.js'

const registration = () => ({ email: 'asha@example.com', name: 'Asha', ipAddress: '127.0.0.1', userAgent: 'test' })
const product = () => ({ productId: 'KS-001', name: 'Shirt', category: 'Shirts', price: 100, stock: 0, sellerId: new mongoose.Types.ObjectId() })

describe('pre-registration model validation (unmounted legacy router)', () => {
  it('normalizes identity and initializes opt-in preferences and pending state', async () => {
    const document = new PreRegister({ ...registration(), email: ' ASHA@example.com ', name: ' Asha ' })
    await expect(document.validate()).resolves.toBeUndefined()
    expect(document.toObject()).toMatchObject({ email: 'asha@example.com', name: 'Asha', status: 'pending', isNotified: false,
      interests: [], referralSource: 'other', notificationPreferences: { email: true, sms: false } })
  })

  it.each(['email', 'name', 'ipAddress', 'userAgent'])('requires %s', async (field) => {
    const input = registration()
    delete input[field]
    await expect(new PreRegister(input).validate()).rejects.toHaveProperty(`errors.${field}`)
  })

  it.each(['a', 'a'.repeat(51)])('rejects a name outside the supported length: %s', async (name) => {
    await expect(new PreRegister({ ...registration(), name }).validate()).rejects.toHaveProperty('errors.name')
  })

  it.each([2, 50])('accepts the name length boundary %i', async (length) => {
    await expect(new PreRegister({ ...registration(), name: 'a'.repeat(length) }).validate()).resolves.toBeUndefined()
  })

  it.each([
    { email: 'not-an-email' }, { phone: '01234' }, { phone: 'abc' },
    { interests: ['not-a-category'] }, { referralSource: 'unknown' }, { status: 'approved' },
  ])('rejects invalid registration fields %j', async (changes) => {
    const field = Object.keys(changes)[0] === 'interests' ? 'interests.0' : Object.keys(changes)[0]
    await expect(new PreRegister({ ...registration(), ...changes }).validate()).rejects.toMatchObject({ errors: { [field]: expect.anything() } })
  })
})

describe('product schema', () => {
  it('accepts zero stock and defaults new catalog entries to pending', async () => {
    const document = new Product(product())
    await expect(document.validate()).resolves.toBeUndefined()
    expect(document.status).toBe('pending')
    expect(document.discount).toBe(0)
    expect(document.uploadedAt).toBeInstanceOf(Date)
  })

  it.each(['productId', 'name', 'category', 'price', 'stock', 'sellerId'])('requires %s', async (field) => {
    const input = product()
    delete input[field]
    await expect(new Product(input).validate()).rejects.toHaveProperty(`errors.${field}`)
  })

  it('rejects unsupported moderation states and malformed seller IDs', async () => {
    await expect(new Product({ ...product(), status: 'live' }).validate()).rejects.toHaveProperty('errors.status')
    await expect(new Product({ ...product(), sellerId: 'invalid' }).validate()).rejects.toHaveProperty('errors.sellerId')
  })
})
