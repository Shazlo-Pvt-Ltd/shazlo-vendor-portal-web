import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Writable } from 'node:stream'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server-core'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { v2 as cloudinary } from 'cloudinary'
import app from '../app.js'
import Brand from '../models/Brand.js'
import Product from '../models/Product.js'
import WaitlistUser from '../models/WaitlistUser.js'
import PreRegister from '../models/PreRegister.js'

let mongo
let server
let baseUrl

const brandInput = () => ({
  brand_name: 'Kalki Studio', founder_contact: 'Kiran', product_type: 'clothing',
  phone: '+919876543210', email: 'kiran@example.test', price_range: { min: 500, max: 5000 },
})
const waitlistInput = () => ({ name: 'Asha', email: 'asha@example.test', gender: 'Female', city: 'Delhi' })
const productInput = (overrides = {}) => ({
  productId: 'KS-001', name: 'Cotton shirt', category: 'Shirts', price: 1200, stock: 5, ...overrides,
})

async function request(path, { method = 'GET', body, raw, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...headers },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  })
  return { status: response.status, headers: response.headers, text: await response.text() }
}
const json = (response) => JSON.parse(response.text)
const post = (path, body) => request(path, { method: 'POST', body })

beforeAll(async () => {
  // No DATABASE_URL or MONGODB_URI is consumed: this always owns its own local database.
  mongo = await MongoMemoryServer.create({ binary: { version: '7.0.24' } })
  await mongoose.connect(mongo.getUri(), { dbName: 'shazlo_tests' })
  await Promise.all([Brand.init(), Product.init(), WaitlistUser.init(), PreRegister.init()])
  server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

beforeEach(async () => {
  // Never use locally configured provider credentials if a test forgets its stub.
  vi.spyOn(cloudinary.uploader, 'upload_stream').mockImplementation(() => {
    throw new Error('Unexpected Cloudinary request in test')
  })
  await Promise.all([Brand.deleteMany({}), Product.deleteMany({}), WaitlistUser.deleteMany({}), PreRegister.deleteMany({})])
})

afterEach(() => vi.restoreAllMocks())
afterAll(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  await mongoose.disconnect()
  if (mongo) await mongo.stop()
})

describe('production HTTP application', () => {
  it('boots the actual server entry point against an owned database and serves health', async () => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      import app from './app.js';
      const listen = app.listen;
      app.listen = function (...args) {
        const server = listen.apply(this, args);
        server.once('listening', () => process.send({ port: server.address().port }));
        return server;
      };
      await import('./server.js');
    `], {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      env: { ...process.env, MONGODB_URI: mongo.getUri('bootstrap_tests'), PORT: '0' },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    })
    try {
      const [address] = await once(child, 'message', { signal: AbortSignal.timeout(10_000) })
      const response = await fetch(`http://127.0.0.1:${address.port}/api/health`, { signal: AbortSignal.timeout(5000) })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ status: 'OK' })
    } finally {
      if (child.exitCode === null) {
        child.kill()
        await once(child, 'exit')
      }
    }
  })

  it('serves health through the actual middleware stack', async () => {
    const response = await request('/api/health')
    expect(response.status).toBe(200)
    expect(json(response)).toMatchObject({ status: 'OK', uptime: expect.any(Number) })
    expect(Number.isNaN(Date.parse(json(response).timestamp))).toBe(false)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('returns JSON for unknown routes', async () => {
    const response = await request('/api/does-not-exist')
    expect(response.status).toBe(404)
    expect(json(response)).toEqual({ message: 'Route not found' })
  })

  it('rejects malformed JSON before any waitlist write', async () => {
    const response = await request('/api/waitlist/add', { method: 'POST', raw: '{bad json' })
    expect(response.status).toBe(400)
    expect(await WaitlistUser.countDocuments()).toBe(0)
  })

  it('rejects oversized JSON before any waitlist write', async () => {
    const response = await post('/api/waitlist/add', { ...waitlistInput(), name: 'a'.repeat(10 * 1024 * 1024) })
    expect(response.status).toBe(413)
    expect(await WaitlistUser.countDocuments()).toBe(0)
  })
})

describe('waitlist persistence and duplicates', () => {
  it('persists normalized user fields and timestamps', async () => {
    const response = await post('/api/waitlist/add', { ...waitlistInput(), name: ' Asha ', email: 'ASHA@example.test', city: ' Delhi ' })
    expect(response.status).toBe(201)
    expect(json(response)).toMatchObject({ alreadyAdded: false })
    const saved = await WaitlistUser.findOne().lean()
    expect(saved).toMatchObject({ name: 'Asha', email: 'asha@example.test', city: 'Delhi', gender: 'Female' })
    expect(saved.createdAt).toBeInstanceOf(Date)
  })

  it.each(['name', 'email', 'gender', 'city'])('rejects missing %s without writing', async (field) => {
    const input = waitlistInput()
    delete input[field]
    const response = await post('/api/waitlist/add', input)
    expect(response.status).toBe(400)
    expect(json(response)).toEqual({ error: 'All fields are required' })
    expect(await WaitlistUser.countDocuments()).toBe(0)
  })

  it('makes repeated registration idempotent without overwriting the original name', async () => {
    expect((await post('/api/waitlist/add', waitlistInput())).status).toBe(201)
    const response = await post('/api/waitlist/add', { ...waitlistInput(), name: 'Other' })
    expect(response.status).toBe(200)
    expect(json(response)).toEqual({ message: 'Email already added', alreadyAdded: true })
    expect(await WaitlistUser.countDocuments()).toBe(1)
    expect((await WaitlistUser.findOne().lean()).name).toBe('Asha')
  })

  it('enforces the unique email index across concurrent database writes', async () => {
    const results = await Promise.allSettled([
      WaitlistUser.create(waitlistInput()), WaitlistUser.create(waitlistInput()),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.find((result) => result.status === 'rejected').reason.code).toBe(11000)
    expect(await WaitlistUser.countDocuments()).toBe(1)
  })

  it('returns a generic failure when persistence is unavailable', async () => {
    vi.spyOn(WaitlistUser, 'findOne').mockRejectedValue(new Error('private connection details'))
    const response = await post('/api/waitlist/add', waitlistInput())
    expect(response.status).toBe(500)
    expect(json(response)).toEqual({ error: 'Server error' })
    expect(await WaitlistUser.countDocuments()).toBe(0)
  })
})

describe('brand registration', () => {
  it('creates a pending brand and normalizes contact fields', async () => {
    const response = await post('/api/register-brand', { ...brandInput(), email: ' KIRAN@example.test ' })
    expect(response.status).toBe(201)
    expect(json(response).brand).toMatchObject({ status: 'pending', email: 'kiran@example.test' })
    expect(await Brand.countDocuments()).toBe(1)
  })

  it.each(['brand_name', 'founder_contact', 'product_type', 'phone', 'email', 'price_range'])('rejects missing %s without writing', async (field) => {
    const input = brandInput()
    delete input[field]
    const response = await post('/api/register-brand', input)
    expect(response.status).toBe(400)
    expect(json(response)).toEqual({ message: 'Missing required fields' })
    expect(await Brand.countDocuments()).toBe(0)
  })

  it('does not accept a caller-supplied approval status', async () => {
    const response = await post('/api/register-brand', { ...brandInput(), status: 'approved' })
    expect(response.status).toBe(201)
    expect((await Brand.findOne().lean()).status).toBe('pending')
  })
})

describe('catalog upload and moderation persistence (legacy routes have no authentication)', () => {
  it.each([{ products: [] }, { sellerId: '507f1f77bcf86cd799439011' }])('rejects an incomplete upload without creating products', async (body) => {
    const response = await post('/api/upload/products', body)
    expect(response.status).toBe(400)
    expect(await Product.countDocuments()).toBe(0)
  })

  it('assigns the requested seller to each product and defaults to pending', async () => {
    const seller = await Brand.create(brandInput())
    const response = await post('/api/upload/products', {
      sellerId: seller.id, products: [productInput({ sellerId: new mongoose.Types.ObjectId() }), productInput({ productId: 'KS-002' })],
    })
    expect(response.status).toBe(200)
    expect(json(response).products).toHaveLength(2)
    const saved = await Product.find().lean()
    expect(saved.every((product) => String(product.sellerId) === seller.id && product.status === 'pending')).toBe(true)
  })

  it('cannot bypass moderation by uploading approval fields in the catalog', async () => {
    const seller = await Brand.create(brandInput())
    const response = await post('/api/upload/products', {
      sellerId: seller.id,
      products: [productInput({ status: 'approved', approvedBy: seller.id, approvedAt: '2020-01-01T00:00:00Z' })],
    })
    expect(response.status).toBe(200)
    const saved = await Product.findOne().lean()
    expect(saved.status).toBe('pending')
    expect(saved.approvedBy).toBeUndefined()
    expect(saved.approvedAt).toBeUndefined()
  })

  it('keeps a validation failure from inserting any products in the batch', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const seller = await Brand.create(brandInput())
    const response = await post('/api/upload/products', {
      sellerId: seller.id, products: [productInput(), productInput({ name: undefined })],
    })
    expect(response.status).toBe(500)
    expect(await Product.countDocuments()).toBe(0)
  })

  it('filters products by seller and populates the seller email', async () => {
    const seller = await Brand.create(brandInput())
    const other = await Brand.create({ ...brandInput(), email: 'other@example.test' })
    await Product.create([productInput({ sellerId: seller.id }), productInput({ sellerId: other.id, productId: 'OTHER' })])
    const response = await request(`/api/admin/products/${seller.id}`)
    expect(response.status).toBe(200)
    expect(json(response).products).toHaveLength(1)
    expect(json(response).products[0]).toMatchObject({ productId: 'KS-001', sellerId: { _id: seller.id, email: 'kiran@example.test' } })
  })

  it('lists registered sellers and the complete product catalog', async () => {
    const seller = await Brand.create(brandInput())
    await Product.create(productInput({ sellerId: seller.id }))
    expect(json(await request('/api/admin/sellers')).sellers).toHaveLength(1)
    expect(json(await request('/api/admin/products')).products).toHaveLength(1)
  })

  it('persists approval status, reviewer and decision time, then rejection', async () => {
    const seller = await Brand.create(brandInput())
    const reviewer = new mongoose.Types.ObjectId()
    const product = await Product.create(productInput({ sellerId: seller.id }))
    const earliest = Date.now()
    const response = await request(`/api/admin/products/${product.id}/approve`, { method: 'PUT', body: { adminId: reviewer.toString() } })
    expect(response.status).toBe(200)
    const approved = await Product.findById(product.id).lean()
    expect(approved.status).toBe('approved')
    expect(String(approved.approvedBy)).toBe(reviewer.toString())
    expect(approved.approvedAt.getTime()).toBeGreaterThanOrEqual(earliest)
    expect(approved.approvedAt.getTime()).toBeLessThanOrEqual(Date.now())
    const rejection = await request(`/api/admin/products/${product.id}/reject`, { method: 'PUT' })
    expect(rejection.status).toBe(200)
    expect((await Product.findById(product.id).lean()).status).toBe('rejected')
  })

  it.each(['approve', 'reject'])('returns 404 for %s of a missing product without creating one', async (action) => {
    const response = await request(`/api/admin/products/${new mongoose.Types.ObjectId()}/${action}`, { method: 'PUT', body: {} })
    expect(response.status).toBe(404)
    expect(json(response)).toEqual({ message: 'Product not found' })
    expect(await Product.countDocuments()).toBe(0)
  })

  it('rejects a missing image before contacting Cloudinary', async () => {
    const upload = vi.spyOn(cloudinary.uploader, 'upload_stream')
    const response = await post('/api/upload/images', {})
    expect(response.status).toBe(400)
    expect(upload).not.toHaveBeenCalled()
  })

  it('parses real multipart bytes and returns provider URLs in file order', async () => {
    const bytes = []
    vi.spyOn(cloudinary.uploader, 'upload_stream').mockImplementation((options, callback) => {
      expect(options).toEqual({ folder: 'shazlo_catalog' })
      return new Writable({ write(chunk, _encoding, done) { bytes.push(chunk.toString()); done() }, final(done) {
        callback(null, { secure_url: `https://images.example.test/${bytes.at(-1)}` }); done()
      } })
    })
    const form = new FormData()
    form.append('images', new Blob(['first']), 'first.png')
    form.append('images', new Blob(['second']), 'second.png')
    const response = await fetch(`${baseUrl}/api/upload/images`, { method: 'POST', body: form })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ urls: ['https://images.example.test/first', 'https://images.example.test/second'] })
    expect(bytes).toEqual(['first', 'second'])
  })

  it('returns an upload failure when the provider rejects an image', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(cloudinary.uploader, 'upload_stream').mockImplementation((_options, callback) => new Writable({
      write(_chunk, _encoding, done) { done() }, final(done) { callback(new Error('provider unavailable')); done() },
    }))
    const form = new FormData()
    form.append('images', new Blob(['image']), 'image.png')
    const response = await fetch(`${baseUrl}/api/upload/images`, { method: 'POST', body: form })
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ message: 'Upload failed' })
  })
})
