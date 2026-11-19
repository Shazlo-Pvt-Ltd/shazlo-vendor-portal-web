import { createHmac } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { URL } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'

const contract = new URL('../../docs/adr/0003-contract/', import.meta.url)
const read = (path) => readFileSync(new URL(path, contract), 'utf8')
const ajv = new Ajv2020({ allErrors: true })
addFormats(ajv)
for (const file of readdirSync(new URL('schemas/', contract)).filter((name) => name.endsWith('.json'))) {
  ajv.addSchema(JSON.parse(read(`schemas/${file}`)))
}
const cases = readdirSync(new URL('examples/', contract)).filter((name) => name.endsWith('.json')).map((name) => ({
  name: name.replace('.json', ''), example: JSON.parse(read(`examples/${name}`)),
  validate: ajv.getSchema(`https://schemas.shazlo.store/central-ingest/v1/${name.replace('.json', '.schema.json')}`),
}))
const eventSchemas = readdirSync(new URL('schemas/', contract))
  .filter((name) => name.endsWith('.schema.json') && name !== 'envelope.schema.json')
  .map((name) => name.replace('.schema.json', ''))

// The suites below are generated from the examples, so an event schema without an example would
// silently go untested; and an example whose `type` disagrees with its file name would be checked
// against the wrong schema.
describe('the contract files', () => {
  it('has one example for every event schema, and no example without a schema', () => {
    expect(eventSchemas.length).toBeGreaterThan(0)
    expect(cases.map(({ name }) => name).sort()).toEqual([...eventSchemas].sort())
  })

  it.each(cases)('names $name after the event type it holds', ({ name, example }) => {
    expect(example.type).toBe(name)
    expect(name.startsWith(`${example.aggregate.type}.`)).toBe(true)
  })

  it('lists every event type in the envelope, and only those', () => {
    const envelope = JSON.parse(read('schemas/envelope.schema.json'))
    expect([...envelope.properties.type.enum].sort()).toEqual([...eventSchemas].sort())
  })
})

describe.each(cases)('$name publishing contract', ({ example, validate }) => {
  it('validates the checked-in example, including UUID and timestamp formats', () => {
    expect(validate, 'example must have a matching schema').toBeTypeOf('function')
    expect(validate(example), JSON.stringify(validate.errors)).toBe(true)
  })

  it.each(['event_id', 'type', 'version', 'occurred_at', 'producer', 'aggregate', 'payload'])('requires envelope field %s', (field) => {
    const invalid = structuredClone(example)
    delete invalid[field]
    expect(validate(invalid)).toBe(false)
  })

  it.each([
    ['invalid UUID', { event_id: 'not-a-uuid' }],
    ['invalid timestamp', { occurred_at: 'yesterday' }],
    ['zero version', { version: 0 }],
    ['fractional version', { version: 1.5 }],
    ['wrong producer', { producer: 'unknown-service' }],
    ['extra envelope field', { email: 'private@example.test' }],
    ['wrong aggregate type', { aggregate: { type: 'unknown', id: example.aggregate.id } }],
  ])('rejects %s', (_reason, changes) => {
    expect(validate({ ...example, ...changes })).toBe(false)
  })

  it.each(['email', 'phone', 'founder_contact', 'stock'])('rejects private or central-owned payload field %s', (field) => {
    const invalid = structuredClone(example)
    invalid.payload[field] = field === 'stock' ? 1 : 'private'
    expect(validate(invalid)).toBe(false)
  })

  it('rejects the example of every other event type', () => {
    for (const other of cases.filter((c) => c.example.type !== example.type)) {
      expect(validate(other.example), other.name).toBe(false)
    }
  })

  it('rejects its own payload under another event type', () => {
    for (const { name } of cases.filter((c) => c.example.type !== example.type)) {
      expect(validate({ ...example, type: name }), name).toBe(false)
    }
  })
})

const exampleFor = (type) => structuredClone(cases.find(({ name }) => name === type).example)
const validateEvent = (event) => cases.find(({ name }) => name === event.type).validate(event)

describe('published product constraints', () => {
  it.each([0, -1, 1.5, '1200'])('rejects invalid paise amount %j', (amount) => {
    const event = exampleFor('product.published')
    event.payload.variants[0].price_paise = amount
    expect(validateEvent(event)).toBe(false)
  })

  it.each([0, -1, 1.5, '1599', null])('rejects invalid MRP amount %j', (amount) => {
    const event = exampleFor('product.published')
    event.payload.variants[0].mrp_paise = amount
    expect(validateEvent(event)).toBe(false)
  })

  it.each(['price_paise', 'mrp_paise', 'variant_id', 'sku'])('requires variant field %s', (field) => {
    const event = exampleFor('product.published')
    delete event.payload.variants[0][field]
    expect(validateEvent(event)).toBe(false)
  })

  it('accepts one paise, the smallest price', () => {
    const event = exampleFor('product.published')
    Object.assign(event.payload.variants[0], { price_paise: 1, mrp_paise: 1 })
    expect(validateEvent(event)).toBe(true)
  })

  it.each([0, 11])('rejects %i images outside the 1–10 boundary', (length) => {
    const event = exampleFor('product.published')
    event.payload.images = Array.from({ length }, () => event.payload.images[0])
    expect(validateEvent(event)).toBe(false)
  })

  it('requires a variant and prevents stock from leaking inside a variant', () => {
    const event = exampleFor('product.published')
    event.payload.variants[0].stock = 12
    expect(validateEvent(event)).toBe(false)
    event.payload.variants = []
    expect(validateEvent(event)).toBe(false)
  })

  it('allows non-returnable products without a return window', () => {
    const event = exampleFor('product.published')
    event.payload.returnable = false
    delete event.payload.return_window_days
    expect(validateEvent(event)).toBe(true)
  })

  it.each([undefined, -1, 31, 1.5])('rejects returnable products with return window %j', (days) => {
    const event = exampleFor('product.published')
    event.payload.returnable = true
    event.payload.return_window_days = days
    expect(validateEvent(event)).toBe(false)
  })

  it.each([0, 30])('accepts a return window of %i days', (days) => {
    const event = exampleFor('product.published')
    event.payload.returnable = true
    event.payload.return_window_days = days
    expect(validateEvent(event)).toBe(true)
  })

  it('rejects HTTP images and zero-based image positions', () => {
    const event = exampleFor('product.published')
    event.payload.images[0].url = 'http://images.example.test/image.jpg'
    expect(validateEvent(event)).toBe(false)
    event.payload.images[0].url = 'https://images.example.test/image.jpg'
    event.payload.images[0].position = 0
    expect(validateEvent(event)).toBe(false)
  })
})

describe('brand and lifecycle constraints', () => {
  it.each(['UPPERCASE', '-leading', 'trailing-', 'two--hyphens', 'with spaces'])('rejects invalid brand slug %j', (slug) => {
    const event = exampleFor('brand_profile.published')
    event.payload.slug = slug
    expect(validateEvent(event)).toBe(false)
  })

  it.each([
    ['min_paise', -1],
    ['min_paise', 1.5],
    ['min_paise', '79900'],
    ['max_paise', -1],
    ['max_paise', 2999.5],
    ['max_paise', null],
  ])('rejects a price range with %s %j', (field, amount) => {
    const event = exampleFor('brand_profile.published')
    event.payload.price_range[field] = amount
    expect(validateEvent(event)).toBe(false)
  })

  it.each(['min_paise', 'max_paise'])('requires price range field %s and nothing more', (field) => {
    const event = exampleFor('brand_profile.published')
    delete event.payload.price_range[field]
    expect(validateEvent(event)).toBe(false)
    const extra = exampleFor('brand_profile.published')
    extra.payload.price_range.currency = 'INR'
    expect(validateEvent(extra)).toBe(false)
  })

  it.each(['http://indigolane.example', 'javascript:alert(1)'])('rejects a website that is not https: %s', (url) => {
    const event = exampleFor('brand_profile.published')
    event.payload.website_url = url
    expect(validateEvent(event)).toBe(false)
  })

  it('requires at least one unique category', () => {
    const event = exampleFor('brand_profile.published')
    event.payload.categories = []
    expect(validateEvent(event)).toBe(false)
    event.payload.categories = ['shirts', 'shirts']
    expect(validateEvent(event)).toBe(false)
  })

  it.each(['brand_profile.unpublished', 'product.unpublished'])('rejects unknown unpublish reasons for %s', (type) => {
    const event = exampleFor(type)
    event.payload.reason = 'unknown'
    expect(validateEvent(event)).toBe(false)
  })

  it.each(['approved', 'rejected', 'suspended'])('accepts vendor status %s', (status) => {
    const event = exampleFor('vendor.status_changed')
    event.payload.status = status
    expect(validateEvent(event)).toBe(true)
  })

  it.each(['pending', 'deleted'])('rejects unpublished vendor status %s', (status) => {
    const event = exampleFor('vendor.status_changed')
    event.payload.status = status
    expect(validateEvent(event)).toBe(false)
  })
})

it('keeps the documented HMAC test vector reproducible from the exact body bytes', () => {
  const documentation = read('README.md')
  const body = /body \(371 bytes, exactly\):\r?\n([^\r\n]+)/.exec(documentation)?.[1]
  expect(body).toBeDefined()
  const signature = createHmac('sha256', 'shazlo-contract-test-secret-not-for-production')
    .update(`1792750800.${body}`).digest('hex')
  expect(signature).toBe('634f5e1066ac490d1e347ddf886c874a5083ec5f01b38c706c069e3056470785')
})
