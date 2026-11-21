import { once } from 'node:events'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { gzipSync } from 'node:zlib'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Writable } from 'node:stream'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server-core'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { v2 as cloudinary } from 'cloudinary'
import express from 'express'
import { createApp } from '../app.js'
import { createPreRegisterRouter } from '../routes/preRegister.js'
import Brand from '../models/Brand.js'
import Product from '../models/Product.js'
import WaitlistUser from '../models/WaitlistUser.js'
import PreRegister from '../models/PreRegister.js'

let mongo
let server
let baseUrl

// Every route class with the same budget. The shared server below makes far more requests from
// 127.0.0.1 than any production budget allows; the rate limiting suite builds its own
// applications with tiny budgets.
const budgets = (limit) => ({ publicSubmit: { limit }, preRegistration: { limit }, lookup: { limit }, upload: { limit }, admin: { limit } })
const app = createApp({ rateLimits: budgets(100_000) })

async function listen(application) {
  const instance = application.listen(0, '127.0.0.1')
  await once(instance, 'listening')
  return {
    url: `http://127.0.0.1:${instance.address().port}`,
    close: () => new Promise((resolve, reject) => instance.close((error) => error ? reject(error) : resolve())),
  }
}

// Runs `test` against a fresh application (fresh rate-limit counters) and always closes it.
async function withServer(application, test) {
  const running = await listen(application)
  try {
    await test(running.url)
  } finally {
    await running.close()
  }
}

// routes/preRegister.js is not mounted in app.js; these tests mount it on their own application.
function preRegisterApp(options) {
  const application = express()
  application.use(express.json())
  application.use('/api/preregister', createPreRegisterRouter(options))
  return application
}

const brandInput = () => ({
  brand_name: 'Kalki Studio', founder_contact: 'Kiran', product_type: 'clothing',
  phone: '+919876543210', email: 'kiran@example.test', price_range: { min: 500, max: 5000 },
})
const waitlistInput = () => ({ name: 'Asha', email: 'asha@example.test', gender: 'Female', city: 'Delhi' })
const productInput = (overrides = {}) => ({
  productId: 'KS-001', name: 'Cotton shirt', category: 'Shirts', price: 1200, stock: 5, ...overrides,
})

async function request(path, { method = 'GET', body, raw, headers = {}, base = baseUrl } = {}) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...headers },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  })
  return { status: response.status, headers: response.headers, text: await response.text() }
}
const json = (response) => JSON.parse(response.text)
const post = (path, body, options = {}) => request(path, { method: 'POST', body, ...options })
// Multipart image upload: each file is [contents, name, declared type].
const imageForm = (files) => {
  const form = new FormData()
  for (const [contents, name, type = 'image/png'] of files) form.append('images', new Blob([contents], { type }), name)
  return form
}
// An admin request as a trusted proxy would forward it for the given client address.
const forwardedFrom = (base) => (address) => request('/api/admin/sellers', { base, headers: { 'X-Forwarded-For': address } })
// Cloudinary, the one external service, answers every upload with this URL or this error.
const cloudinaryAnswers = ({ url, error }) => vi.spyOn(cloudinary.uploader, 'upload_stream').mockImplementation((_options, callback) => new Writable({
  write(_chunk, _encoding, done) { done() }, final(done) { error ? callback(error) : callback(null, { secure_url: url }); done() },
}))

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
      env: { ...process.env, MONGODB_URI: mongo.getUri('bootstrap_tests'), PORT: '0', TRUST_PROXY: '' },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    })
    try {
      const [address] = await once(child, 'message', { signal: AbortSignal.timeout(10_000) })
      const response = await fetch(`http://127.0.0.1:${address.port}/api/health`, { signal: AbortSignal.timeout(5000) })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ status: 'OK' })
      // The production composition applies the default budgets (300 admin requests per 900 s).
      const admin = await fetch(`http://127.0.0.1:${address.port}/api/admin/sellers`, { signal: AbortSignal.timeout(5000) })
      expect(admin.status).toBe(200)
      expect(admin.headers.get('ratelimit-policy')).toMatch(/q=300;\s*w=900/)
      expect(admin.headers.get('x-powered-by')).toBeNull()
      // Public forms allow 50 per 15 minutes, so a campus or office network sharing one address
      // is not locked out of the waitlist after a handful of sign-ups.
      const waitlist = await fetch(`http://127.0.0.1:${address.port}/api/waitlist/add`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(5000),
      })
      expect(waitlist.headers.get('ratelimit-policy')).toMatch(/q=50;\s*w=900/)
    } finally {
      if (child.exitCode === null) {
        child.kill()
        await once(child, 'exit')
      }
    }
  })

  // Starts server.js in a scratch directory holding only the given .env, collects stderr, and
  // waits for the process to exit.
  async function startServer({ dotenv, env = {} }) {
    const directory = await mkdtemp(path.join(tmpdir(), 'shazlo-backend-'))
    await writeFile(path.join(directory, '.env'), dotenv)
    const serverModule = new URL('../server.js', import.meta.url).href
    // dotenv never overrides a variable that is already set, even to "", so leave these out.
    const { TRUST_PROXY, RENDER, MONGODB_URI, ...inherited } = process.env
    const child = spawn(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(serverModule)})`], {
      cwd: directory, env: { ...inherited, ...env }, stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
    try {
      const [code] = await once(child, 'exit', { signal: AbortSignal.timeout(10_000) })
      return { code, stderr }
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill()
        await once(child, 'exit')
      }
      // Windows keeps the directory locked for a moment after the process that used it as cwd exits.
      await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    }
  }

  it('reads TRUST_PROXY from .env and refuses to start with an unsafe value', async () => {
    const { code, stderr } = await startServer({ dotenv: `TRUST_PROXY=true\nMONGODB_URI=${mongo.getUri('dotenv_tests')}\n` })
    expect(code).not.toBe(0)
    expect(stderr).toMatch(/TRUST_PROXY=true would trust a client-supplied X-Forwarded-For/)
  })

  it('refuses to start on Render without TRUST_PROXY, rather than give every visitor one budget', async () => {
    const { code, stderr } = await startServer({ dotenv: `MONGODB_URI=${mongo.getUri('dotenv_tests')}\n`, env: { RENDER: 'true' } })
    expect(code).not.toBe(0)
    expect(stderr).toMatch(/TRUST_PROXY is not set/)
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

  it.each([
    ['GET', '/'],
    ['GET', '/api/does/not/exist'],
    ['POST', '/api/does-not-exist'],
    ['DELETE', '/elsewhere/entirely'],
  ])('returns the JSON 404 for %s %s at any depth and for any method', async (method, path) => {
    const response = await request(path, { method })
    expect(response.status).toBe(404)
    expect(json(response)).toEqual({ message: 'Route not found' })
  })

  it('rejects malformed JSON before any waitlist write', async () => {
    const response = await request('/api/waitlist/add', { method: 'POST', raw: '{bad json' })
    expect(response.status).toBe(400)
    // JSON from the application's error handler, not Express's HTML page with a stack trace.
    expect(response.headers.get('content-type')).toMatch(/application\/json/)
    expect(Object.keys(json(response))).toEqual(['message'])
    expect(response.text).not.toMatch(/node_modules|\n\s+at /)
    expect(await WaitlistUser.countDocuments()).toBe(0)
  })

  it('rejects oversized JSON before any waitlist write', async () => {
    const response = await post('/api/waitlist/add', { ...waitlistInput(), name: 'a'.repeat(10 * 1024 * 1024) })
    expect(response.status).toBe(413)
    expect(await WaitlistUser.countDocuments()).toBe(0)
  })
})

describe('request size limits', () => {
  it('limits form bodies to 100 KB', async () => {
    const response = await post('/api/waitlist/add', { ...waitlistInput(), name: 'a'.repeat(101 * 1024) })
    expect(response.status).toBe(413)
    expect(json(response)).toEqual({ message: 'request entity too large' })
    const form = await request('/api/waitlist/add', {
      method: 'POST', raw: `name=${'a'.repeat(101 * 1024)}`, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    expect(form.status).toBe(413)
    expect(await WaitlistUser.countDocuments()).toBe(0)
  })

  it('allows a catalog upload larger than the form limit', async () => {
    const seller = await Brand.create(brandInput())
    const products = Array.from({ length: 300 }, (_, i) => productInput({ productId: `KS-${i}`, description: 'd'.repeat(500) }))
    const body = { sellerId: seller.id, products }
    expect(JSON.stringify(body).length).toBeGreaterThan(100 * 1024)
    const response = await post('/api/upload/products', body)
    expect(response.status).toBe(200)
    expect(await Product.countDocuments()).toBe(300)
  })

  it.each(['image/jpeg', 'image/heic'])('accepts a %s photo', async (type) => {
    cloudinaryAnswers({ url: 'https://images.example.test/photo' })
    const response = await fetch(`${baseUrl}/api/upload/images`, { method: 'POST', body: imageForm([['photo', 'photo', type]]) })
    expect(response.status).toBe(200)
  })

  it.each(['application/octet-stream', ''])('accepts an iPhone photo named .heic that the browser sends as %j', async (type) => {
    cloudinaryAnswers({ url: 'https://images.example.test/photo' })
    const response = await fetch(`${baseUrl}/api/upload/images`, { method: 'POST', body: imageForm([['photo', 'IMG_0001.HEIC', type]]) })
    expect(response.status).toBe(200)
  })

  it('still refuses an unnamed binary that is not a .heic or .heif file', async () => {
    const response = await fetch(`${baseUrl}/api/upload/images`, {
      method: 'POST', body: imageForm([['MZ', 'setup.exe', 'application/octet-stream']]),
    })
    expect(response.status).toBe(415)
  })

  it('refuses an SVG, which can carry script', async () => {
    const response = await fetch(`${baseUrl}/api/upload/images`, {
      method: 'POST', body: imageForm([['<svg onload="alert(1)"/>', 'logo.svg', 'image/svg+xml']]),
    })
    expect(response.status).toBe(415)
  })

  it('rejects a file that does not declare an allowed image type', async () => {
    const upload = vi.spyOn(cloudinary.uploader, 'upload_stream')
    const response = await fetch(`${baseUrl}/api/upload/images`, {
      method: 'POST', body: imageForm([['<script>', 'page.html', 'text/html']]),
    })
    expect(response.status).toBe(415)
    expect((await response.json()).message).toMatch(/image\/jpeg/)
    expect(upload).not.toHaveBeenCalled()
  })

  it('rejects an image over 5 MB', async () => {
    const upload = vi.spyOn(cloudinary.uploader, 'upload_stream')
    const response = await fetch(`${baseUrl}/api/upload/images`, {
      method: 'POST', body: imageForm([[new Uint8Array(5 * 1024 * 1024 + 1), 'large.png']]),
    })
    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ message: 'Each image must be at most 5 MB' })
    expect(upload).not.toHaveBeenCalled()
  })

  it('rejects more than 20 images in one request', async () => {
    const upload = vi.spyOn(cloudinary.uploader, 'upload_stream')
    const files = Array.from({ length: 21 }, (_, i) => [`image ${i}`, `${i}.png`])
    const response = await fetch(`${baseUrl}/api/upload/images`, { method: 'POST', body: imageForm(files) })
    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ message: 'At most 20 images per request' })
    expect(upload).not.toHaveBeenCalled()
  })

  it.each([
    ['more than 10 text fields', Array.from({ length: 11 }, (_, i) => [`note${i}`, 'x'])],
    ['a text field over 100 KB', [['note', 'x'.repeat(100 * 1024 + 1)]]],
  ])('rejects an image upload with %s before contacting Cloudinary', async (_label, fields) => {
    const upload = vi.spyOn(cloudinary.uploader, 'upload_stream')
    const form = imageForm([['image', 'image.png']])
    for (const [name, value] of fields) form.append(name, value)
    const response = await fetch(`${baseUrl}/api/upload/images`, { method: 'POST', body: form })
    expect(response.status).toBe(413)
    expect(upload).not.toHaveBeenCalled()
  })

  it('answers a truncated multipart body with 400, not 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const upload = vi.spyOn(cloudinary.uploader, 'upload_stream')
    const response = await request('/api/upload/images', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=edge' },
      raw: '--edge\r\nContent-Disposition: form-data; name="images"; filename="a.png"\r\nContent-Type: image/png\r\n\r\nabc',
    })
    expect(response.status).toBe(400)
    expect(json(response)).toEqual({ message: 'Malformed multipart body' })
    expect(upload).not.toHaveBeenCalled()
  })

  it('rejects files sent under another field name', async () => {
    const form = new FormData()
    form.append('other', new Blob(['image'], { type: 'image/png' }), 'image.png')
    const response = await fetch(`${baseUrl}/api/upload/images`, { method: 'POST', body: form })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ message: 'Invalid upload: send images in the multipart field "images"' })
  })

  it.each([
    [{ sellerId: { $gt: '' }, products: [{}] }, 'Invalid sellerId'],
    [{ sellerId: 'seller-1', products: [{}] }, 'Invalid sellerId'],
    [{ sellerId: '507f1f77bcf86cd799439011', products: { name: 'Shirt' } }, 'Products must be a list of 1 to 1000 objects'],
    [{ sellerId: '507f1f77bcf86cd799439011', products: ['Shirt'] }, 'Products must be a list of 1 to 1000 objects'],
    [{ sellerId: '507f1f77bcf86cd799439011', products: [null] }, 'Products must be a list of 1 to 1000 objects'],
    [{ sellerId: '507f1f77bcf86cd799439011', products: [] }, 'Products must be a list of 1 to 1000 objects'],
  ])('rejects the catalog upload %j', async (body, message) => {
    const response = await post('/api/upload/products', body)
    expect(response.status).toBe(400)
    expect(json(response)).toEqual({ message })
    expect(await Product.countDocuments()).toBe(0)
  })

  it('rejects a catalog of more than 1000 products', async () => {
    const seller = await Brand.create(brandInput())
    const products = Array.from({ length: 1001 }, (_, i) => ({ productId: `KS-${i}` }))
    const response = await post('/api/upload/products', { sellerId: seller.id, products })
    expect(response.status).toBe(400)
    expect(await Product.countDocuments()).toBe(0)
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
    form.append('images', new Blob(['first'], { type: 'image/png' }), 'first.png')
    form.append('images', new Blob(['second'], { type: 'image/png' }), 'second.png')
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
    form.append('images', new Blob(['image'], { type: 'image/png' }), 'image.png')
    const response = await fetch(`${baseUrl}/api/upload/images`, { method: 'POST', body: form })
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ message: 'Upload failed' })
  })
})

describe('requests without a body (Express 5 leaves req.body undefined)', () => {
  // fetch always sends Content-Length: 0, which body-parser parses to {}. A request with neither
  // Content-Length nor Transfer-Encoding (curl -X POST, for one) is the case that reaches the handler
  // with req.body undefined, so write it by hand.
  async function bodiless(method, path) {
    const { port } = new URL(baseUrl)
    const socket = net.connect(Number(port), '127.0.0.1')
    let raw = ''
    socket.setEncoding('utf8').on('data', (chunk) => { raw += chunk })
    socket.write(`${method} ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`)
    await once(socket, 'end')
    const [head, text] = raw.split('\r\n\r\n')
    return { status: Number(head.split(' ')[1]), text }
  }

  it.each([
    ['POST', '/api/waitlist/add', { error: 'All fields are required' }],
    ['POST', '/api/register-brand', { message: 'Missing required fields' }],
  ])('answers %s %s with 400', async (method, path, body) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await bodiless(method, path)
    expect(response.status).toBe(400)
    expect(json(response)).toEqual(body)
  })

  it('approves a product when the optional approver is left out', async () => {
    const seller = await Brand.create(brandInput())
    const product = await Product.create(productInput({ sellerId: seller.id }))
    const response = await bodiless('PUT', `/api/admin/products/${product.id}/approve`)
    expect(response.status).toBe(200)
    expect((await Product.findById(product.id).lean()).status).toBe('approved')
  })
})

describe('NoSQL injection (CodeQL js/sql-injection)', () => {
  const operators = [{ $gt: '' }, { $ne: null }, { $regex: '.*' }, { $exists: true }]

  it.each(operators)('does not let the waitlist email %j match an existing address', async (email) => {
    await WaitlistUser.create(waitlistInput())
    const response = await post('/api/waitlist/add', { ...waitlistInput(), name: 'Eve', email })
    expect(response.status).toBe(400)
    expect(json(response)).toEqual({ error: 'All fields must be text' })
    expect(await WaitlistUser.countDocuments()).toBe(1)
  })

  it.each(['name', 'gender', 'city'])('rejects a waitlist %s that is not text', async (field) => {
    const response = await post('/api/waitlist/add', { ...waitlistInput(), [field]: ['Asha'] })
    expect(response.status).toBe(400)
    expect(json(response)).toEqual({ error: 'All fields must be text' })
    expect(await WaitlistUser.countDocuments()).toBe(0)
  })

  it('rejects an array email and an operator sent as a urlencoded form', async () => {
    await WaitlistUser.create(waitlistInput())
    expect((await post('/api/waitlist/add', { ...waitlistInput(), email: ['asha@example.test'] })).status).toBe(400)
    const form = await request('/api/waitlist/add', {
      method: 'POST', raw: 'name=Eve&email[$ne]=x&gender=Female&city=Delhi',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    expect(form.status).toBe(400)
    expect(json(form)).toEqual({ error: 'All fields must be text' })
    expect(await WaitlistUser.countDocuments()).toBe(1)
  })

  it('rejects a malformed waitlist email', async () => {
    const response = await post('/api/waitlist/add', { ...waitlistInput(), email: 'not-an-email' })
    expect(response.status).toBe(400)
    expect(json(response)).toEqual({ error: 'Please provide a valid email address' })
    expect(await WaitlistUser.countDocuments()).toBe(0)
  })

  it.each([...operators, 'admin123', ['507f1f77bcf86cd799439011']])('rejects the approver id %j and leaves the product pending', async (adminId) => {
    const seller = await Brand.create(brandInput())
    const product = await Product.create(productInput({ sellerId: seller.id }))
    const response = await request(`/api/admin/products/${product.id}/approve`, { method: 'PUT', body: { adminId } })
    expect(response.status).toBe(400)
    expect(json(response)).toEqual({ message: 'Invalid admin id' })
    expect(await Product.findById(product.id).lean()).toMatchObject({ status: 'pending' })
  })

  it.each([
    ['PUT', '/api/admin/products/not-an-id/approve', 'Invalid product id'],
    ['PUT', '/api/admin/products/not-an-id/reject', 'Invalid product id'],
    ['GET', '/api/admin/products/not-an-id', 'Invalid seller id'],
    ['GET', '/api/admin/products/aaaaaaaaaaaa', 'Invalid seller id'],
  ])('answers %s %s with 400 instead of a cast failure', async (method, path, message) => {
    const response = await request(path, { method, body: method === 'PUT' ? {} : undefined })
    expect(response.status).toBe(400)
    expect(json(response)).toEqual({ message })
  })

  it.each([{ $gt: '' }, ['asha@example.com'], { $ne: 'x' }])('rejects the pre-registration email %j, so it cannot match an existing one', async (email) => {
    await PreRegister.create({ email: 'asha@example.com', name: 'Asha', ipAddress: '127.0.0.1', userAgent: 'test' })
    await withServer(preRegisterApp(), async (base) => {
      const response = await post('/api/preregister/register', { email, name: 'Eve' }, { base })
      expect(response.status).toBe(400)
      expect(json(response)).toMatchObject({ success: false, message: 'Validation failed' })
    })
    expect(await PreRegister.countDocuments()).toBe(1)
  })

  it('still registers and detects a duplicate pre-registration', async () => {
    await withServer(preRegisterApp(), async (base) => {
      expect((await post('/api/preregister/register', { email: 'asha@example.com', name: 'Asha' }, { base })).status).toBe(201)
      expect((await post('/api/preregister/register', { email: 'asha@example.com', name: 'Asha' }, { base })).status).toBe(409)
    })
    expect(await PreRegister.countDocuments()).toBe(1)
  })

  it('matches operator objects literally in any query, as defence in depth behind the checks above', async () => {
    await WaitlistUser.create(waitlistInput())
    // Without Mongoose's sanitizeFilter this returns every user; with it the operator is wrapped in
    // $eq and fails to cast to a string.
    await expect(WaitlistUser.find({ email: { $gt: '' } })).rejects.toThrow(/Cast to string failed/)
    // Population still works, because Mongoose marks the $in filters it builds itself as trusted.
    const seller = await Brand.create(brandInput())
    await Product.create(productInput({ sellerId: seller.id }))
    const response = await request('/api/admin/products')
    expect(json(response).products[0].sellerId.email).toBe('kiran@example.test')
  })

  // Mongoose before 8.24.7 left these shapes unsanitized (GHSA-wpg9-53fq-2r8h, GHSA-pcrw-h46h-c93h).
  it('sanitizes operators inside $nor and in countDocuments too', async () => {
    await WaitlistUser.create(waitlistInput())
    await expect(WaitlistUser.find({ $nor: [{ email: { $exists: false } }] })).rejects.toThrow(/Cast to string failed/)
    await expect(WaitlistUser.countDocuments({ email: { $gt: '' } })).rejects.toThrow(/Cast to string failed/)
  })

  it('treats a differently cased or padded address as the same waitlist entry', async () => {
    expect((await post('/api/waitlist/add', waitlistInput())).status).toBe(201)
    const response = await post('/api/waitlist/add', { ...waitlistInput(), email: '  ASHA@Example.test ' })
    expect(response.status).toBe(200)
    expect(json(response)).toMatchObject({ alreadyAdded: true })
    expect(await WaitlistUser.countDocuments()).toBe(1)
  })
})

describe('rate limiting (CodeQL js/missing-rate-limiting)', () => {
  const limited = () => createApp({ rateLimits: budgets(2) })
  const expectLimited = (response, limit = 2) => {
    expect(response.status).toBe(429)
    expect(json(response)).toEqual({ message: 'Too many requests, please try again later.' })
    expect(response.headers.get('ratelimit-policy')).toMatch(new RegExp(`q=${limit};`))
  }

  it('stops the third waitlist submission before it is stored', async () => {
    await withServer(limited(), async (base) => {
      expect((await post('/api/waitlist/add', waitlistInput(), { base })).status).toBe(201)
      expect((await post('/api/waitlist/add', { ...waitlistInput(), email: 'b@example.test' }, { base })).status).toBe(201)
      expectLimited(await post('/api/waitlist/add', { ...waitlistInput(), email: 'c@example.test' }, { base }))
      expect(await WaitlistUser.countDocuments()).toBe(2)
    })
  })

  it('stops the third brand registration', async () => {
    await withServer(limited(), async (base) => {
      for (let i = 0; i < 2; i += 1) expect((await post('/api/register-brand', brandInput(), { base })).status).toBe(201)
      expectLimited(await post('/api/register-brand', brandInput(), { base }))
      expect(await Brand.countDocuments()).toBe(2)
    })
  })

  it('shares one budget across catalog and image uploads', async () => {
    const upload = vi.spyOn(cloudinary.uploader, 'upload_stream')
    const seller = await Brand.create(brandInput())
    await withServer(limited(), async (base) => {
      for (let i = 0; i < 2; i += 1) {
        expect((await post('/api/upload/products', { sellerId: seller.id, products: [productInput()] }, { base })).status).toBe(200)
      }
      expectLimited(await post('/api/upload/products', { sellerId: seller.id, products: [productInput()] }, { base }))
      const images = await fetch(`${base}/api/upload/images`, { method: 'POST', body: imageForm([['image', 'image.png']]) })
      expect(images.status).toBe(429)
      expect(upload).not.toHaveBeenCalled()
      expect(await Product.countDocuments()).toBe(2)
    })
  })

  it('shares one budget across the admin endpoints, so a third call cannot approve', async () => {
    const seller = await Brand.create(brandInput())
    const product = await Product.create(productInput({ sellerId: seller.id }))
    await withServer(limited(), async (base) => {
      expect((await request('/api/admin/sellers', { base })).status).toBe(200)
      expect((await request(`/api/admin/products/${seller.id}`, { base })).status).toBe(200)
      expectLimited(await request(`/api/admin/products/${product.id}/approve`, { method: 'PUT', body: {}, base }))
      expectLimited(await request(`/api/admin/products/${product.id}/reject`, { method: 'PUT', base }))
      expectLimited(await request('/api/admin/products', { base }))
      expect((await Product.findById(product.id).lean()).status).toBe('pending')
    })
  })

  it('limits the unmounted pre-registration router as well', async () => {
    await withServer(preRegisterApp({ rateLimits: budgets(2) }), async (base) => {
      for (let i = 0; i < 2; i += 1) expect((await request('/api/preregister/check/asha%40example.com', { base })).status).toBe(200)
      expectLimited(await request('/api/preregister/check/asha%40example.com', { base }))
      expectLimited(await request('/api/preregister/confirm/token', { base }))
      expectLimited(await request('/api/preregister/stats', { base }))
    })
  })

  it('keys budgets on the client address the trusted proxy reports', async () => {
    await withServer(createApp({ rateLimits: budgets(1), trustProxy: 1 }), async (base) => {
      const from = forwardedFrom(base)
      expect((await from('203.0.113.1')).status).toBe(200)
      expect((await from('203.0.113.1')).status).toBe(429)
      expect((await from('203.0.113.2')).status).toBe(200)
    })
  })

  it('ignores X-Forwarded-For when no proxy is trusted, so a client cannot pick a fresh budget', async () => {
    // express-rate-limit reports the unexpected header once through console.error.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await withServer(createApp({ rateLimits: budgets(1), trustProxy: false }), async (base) => {
      const from = forwardedFrom(base)
      expect((await from('203.0.113.1')).status).toBe(200)
      expect((await from('203.0.113.2')).status).toBe(429)
    })
  })

  it('reads TRUST_PROXY from the environment it is given', async () => {
    await withServer(createApp({ rateLimits: budgets(1), env: { TRUST_PROXY: '1' } }), async (base) => {
      const from = forwardedFrom(base)
      expect((await from('203.0.113.1')).status).toBe(200)
      expect((await from('203.0.113.2')).status).toBe(200)
    })
  })

  it('gives one budget to an IPv6 /56, so a client cannot rotate through its own addresses', async () => {
    await withServer(createApp({ rateLimits: budgets(1), trustProxy: 1 }), async (base) => {
      const from = forwardedFrom(base)
      expect((await from('2001:db8:0:1::1')).status).toBe(200)
      expect((await from('2001:db8:0:1:ffff::2')).status).toBe(429)
      expect((await from('2001:db8:0:ff00::1')).status).toBe(200)
    })
  })

  it('refuses an over-budget catalog upload before reading its body', async () => {
    const seller = await Brand.create(brandInput())
    await withServer(createApp({ rateLimits: budgets(1) }), async (base) => {
      expect((await post('/api/upload/products', { sellerId: seller.id, products: [productInput()] }, { base })).status).toBe(200)
      // A parser running first would answer this malformed body with 400; the limiter answers first.
      const response = await request('/api/upload/products', { method: 'POST', raw: `{${'x'.repeat(1024 * 1024)}`, base })
      expect(response.status).toBe(429)
    })
  })

  it('keeps pre-registration at 5 attempts per 15 minutes by default', async () => {
    await withServer(preRegisterApp(), async (base) => {
      for (let i = 0; i < 5; i += 1) {
        expect((await post('/api/preregister/register', { email: `pre${i}@example.com`, name: 'Asha' }, { base })).status).toBe(201)
      }
      expectLimited(await post('/api/preregister/register', { email: 'pre5@example.com', name: 'Asha' }, { base }), 5)
    })
    expect(await PreRegister.countDocuments()).toBe(5)
  })

  it('does not limit the health check, which touches no database', async () => {
    await withServer(limited(), async (base) => {
      for (let i = 0; i < 5; i += 1) expect((await request('/api/health', { base })).status).toBe(200)
    })
  })
})

describe('responses do not leak internals', () => {
  it('does not announce the framework', async () => {
    const response = await request('/api/health')
    expect(response.headers.get('x-powered-by')).toBeNull()
  })

  it.each([
    ['GET', '/api/admin/sellers', Brand, 'find', 'Failed to fetch sellers'],
    ['GET', '/api/admin/products', Product, 'find', 'Failed to fetch products'],
    ['GET', '/api/admin/products/507f1f77bcf86cd799439011', Product, 'find', 'Failed to fetch products'],
    ['PUT', '/api/admin/products/507f1f77bcf86cd799439011/approve', Product, 'findByIdAndUpdate', 'Failed to approve product'],
    ['PUT', '/api/admin/products/507f1f77bcf86cd799439011/reject', Product, 'findByIdAndUpdate', 'Failed to reject product'],
  ])('answers a failed %s %s with a fixed message', async (method, path, model, operation, message) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(model, operation).mockImplementation(() => { throw new Error('private connection details') })
    const response = await request(path, { method, body: method === 'PUT' ? {} : undefined })
    expect(response.status).toBe(500)
    expect(json(response)).toEqual({ message })
  })

  it('answers a failed catalog save without the validation details', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const seller = await Brand.create(brandInput())
    const response = await post('/api/upload/products', { sellerId: seller.id, products: [productInput({ price: 'free' })] })
    expect(response.status).toBe(500)
    expect(json(response)).toEqual({ message: 'Failed to save products' })
  })

  it('answers a provider failure without the provider message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    cloudinaryAnswers({ error: new Error('api_secret mismatch for key 1234') })
    const response = await fetch(`${baseUrl}/api/upload/images`, { method: 'POST', body: imageForm([['image', 'image.png']]) })
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ message: 'Upload failed' })
  })
})

describe('attempts to get around the limits', () => {
  it('lets exactly the budget through when requests arrive at once', async () => {
    await withServer(createApp({ rateLimits: budgets(2) }), async (base) => {
      const statuses = await Promise.all(Array.from({ length: 10 }, (_, i) =>
        post('/api/waitlist/add', { ...waitlistInput(), email: `burst${i}@example.test` }, { base }).then((response) => response.status)))
      expect(statuses.filter((status) => status === 201)).toHaveLength(2)
      expect(statuses.filter((status) => status === 429)).toHaveLength(8)
    })
    expect(await WaitlistUser.countDocuments()).toBe(2)
  })

  it('does not give a fresh budget to a client that prepends addresses to X-Forwarded-For', async () => {
    await withServer(createApp({ rateLimits: budgets(1), trustProxy: 1 }), async (base) => {
      const from = forwardedFrom(base)
      expect((await from('198.51.100.7')).status).toBe(200)
      expect((await from('203.0.113.9, 198.51.100.7')).status).toBe(429)
      expect((await from('::ffff:198.51.100.7')).status).toBe(429)
    })
  })

  it.each(['/api/upload/products', '/API/UPLOAD/PRODUCTS', '/api/upload/products/'])(
    'parses a catalog larger than the form limit at %s, as Express routes it', async (path) => {
      const seller = await Brand.create(brandInput())
      const products = Array.from({ length: 200 }, (_, i) => productInput({ productId: `KS-${i}`, description: 'd'.repeat(1000) }))
      const response = await post(path, { sellerId: seller.id, products })
      expect(response.status).toBe(200)
      expect(await Product.countDocuments()).toBe(200)
    })

  it.each(['/api/waitlist/add', '/api/upload/products'])('cuts off a gzip bomb at %s once it inflates past the limit', async (path) => {
    const bomb = gzipSync(Buffer.from(JSON.stringify({ name: 'a'.repeat(20 * 1024 * 1024) })))
    expect(bomb.length).toBeLessThan(100 * 1024)
    const response = await request(path, { method: 'POST', raw: bomb, headers: { 'Content-Encoding': 'gzip' } })
    expect(response.status).toBe(413)
    expect(json(response)).toEqual({ message: 'request entity too large' })
  })
})
