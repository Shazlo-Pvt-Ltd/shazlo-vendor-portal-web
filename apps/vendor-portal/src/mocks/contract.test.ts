// @vitest-environment node
import { parseYaml } from '@redocly/openapi-core'
import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import { getResponse, type RequestHandler } from 'msw'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createDb, DEMO_INVITED, DEMO_LOGIN, DEMO_STAFF, type MockDb } from './db'
import { createHandlers } from './handlers'

// Every answer the mock API gives must be what vendor-api documents: the real routes in
// services/vendor-api/openapi.json, the proposed ones in openapi/proposed.yaml (which wins where
// both define a method). Errors must be vendor-api's envelope. The scenario below calls every mock
// route at least once with success, and the main error answers.

type Doc = { paths: Record<string, Record<string, { responses?: Record<string, { content?: Record<string, { schema?: unknown }> }> }>> }

const REAL_REF = '../../../services/vendor-api/openapi.json#'
const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
const real = JSON.parse(read('../../../../services/vendor-api/openapi.json')) as Doc
const proposed = parseYaml(read('../../openapi/proposed.yaml').split(REAL_REF).join('openapi.json#')) as Doc

const ajv = new Ajv2020({ strict: false, allErrors: true })
addFormats(ajv)
ajv.addSchema({ ...real, $id: 'openapi.json' })
ajv.addSchema({ ...proposed, $id: 'proposed.yaml' })

const METHODS = ['get', 'put', 'post', 'delete', 'patch']
const templateRegex = (template: string) => new RegExp(`^${template.replace(/\{[^}]+\}/g, '[^/]+')}$`)

/** The operation that documents a request: the proposal's, else the real one. */
function operation(method: string, path: string): { doc: 'proposed.yaml' | 'openapi.json'; template: string } | null {
  for (const [name, doc] of [['proposed.yaml', proposed], ['openapi.json', real]] as const) {
    for (const [template, item] of Object.entries(doc.paths)) {
      if (templateRegex(template).test(path) && item[method]) return { doc: name, template }
    }
  }
  return null
}

const pointer = (...parts: string[]) => parts.map((p) => p.replace(/~/g, '~0').replace(/\//g, '~1')).join('/')

interface Exchange {
  method: string
  path: string
  status: number
  contentType: string
  body: unknown
  requestId: string | null
}

function problems(x: Exchange): string[] {
  const out: string[] = []
  if (x.status >= 400) {
    const validate = ajv.getSchema('proposed.yaml#/components/schemas/ErrorEnvelope')!
    if (!validate(x.body)) out.push(`error envelope: ${ajv.errorsText(validate.errors)}`)
    const id = (x.body as { error?: { request_id?: unknown } } | null)?.error?.request_id
    if (!x.requestId || x.requestId !== id) out.push('X-Request-ID must be sent and equal error.request_id')
    return out
  }
  const op = operation(x.method, x.path)
  if (!op) return [`no documented operation for ${x.method.toUpperCase()} ${x.path}`]
  const doc = op.doc === 'proposed.yaml' ? proposed : real
  const responses = doc.paths[op.template]![x.method]!.responses ?? {}
  const documented = responses[String(x.status)]
  if (!documented) return [`status ${x.status} is not documented in ${op.doc} for ${x.method.toUpperCase()} ${op.template}`]
  if (x.status === 204) return x.body === null ? [] : ['a 204 must have no body']
  const type = x.contentType.split(';')[0]!.trim()
  const content = documented.content?.[type]
  if (!content) return [`content type ${type} is not documented for ${x.method.toUpperCase()} ${op.template} ${x.status}`]
  if (type !== 'application/json') return []
  const ref = `${op.doc}#/${pointer('paths', op.template, x.method, 'responses', String(x.status), 'content', type, 'schema')}`
  const validate = ajv.getSchema(ref)
  if (!validate) return [`no schema at ${ref}`]
  if (!validate(x.body)) out.push(`${x.method.toUpperCase()} ${x.path} ${x.status}: ${ajv.errorsText(validate.errors)}`)
  return out
}

/** Calls the handlers directly (no server, no network) and records every exchange. */
function harness(db: MockDb) {
  const handlers: RequestHandler[] = createHandlers(() => db)
  const exchanges: Exchange[] = []
  let token: string | null = null
  async function send(method: string, path: string, options: { body?: unknown; raw?: BodyInit; type?: string; auth?: boolean; origin?: string } = {}) {
    const headers = new Headers()
    if (options.auth !== false && token) headers.set('Authorization', `Bearer ${token}`)
    if (options.body !== undefined) headers.set('Content-Type', 'application/json')
    if (options.type) headers.set('Content-Type', options.type)
    const request = new Request(`${options.origin ?? 'https://api.test'}${path}`, {
      method: method.toUpperCase(),
      headers,
      body: options.raw ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
    })
    const response = await getResponse(handlers, request)
    if (!response) throw new Error(`no mock answers ${method.toUpperCase()} ${path}`)
    const contentType = response.headers.get('Content-Type') ?? ''
    const text = await response.text()
    const body: unknown = text === '' ? null : contentType.includes('json') ? JSON.parse(text) : text
    if (!options.origin) exchanges.push({ method, path: path.split('?')[0]!, status: response.status, contentType, body, requestId: response.headers.get('X-Request-ID') })
    return { status: response.status, body: body as Record<string, unknown> & Record<string, never> }
  }
  return { send, exchanges, handlers, setToken: (next: string | null) => (token = next) }
}

describe('the mock API against the contract', () => {
  it('answers every route as openapi.json or proposed.yaml says', async () => {
    const db = createDb({ now: () => new Date('2026-11-21T10:00:00Z') })
    const { send, exchanges, handlers, setToken } = harness(db)
    const ok = (status: number) => expect(status).toBeLessThan(300)

    // Signed out.
    expect((await send('post', '/v1/auth/login', { body: { email: DEMO_LOGIN.email, password: 'wrong-password' } })).status).toBe(401)
    expect((await send('post', '/v1/auth/login', { body: { email: 'x' } })).status).toBe(422)
    expect((await send('get', '/v1/vendor/me')).status).toBe(401)
    ok((await send('get', '/v1/public/ifsc/HDFC0001234')).status)
    expect((await send('get', '/v1/public/ifsc/NOPE')).status).toBe(422)
    expect((await send('get', '/v1/public/ifsc/ZZZZ0001234')).status).toBe(404)
    const signup = {
      brand_name: 'Neel Threads', contact_name: 'Asha Patel', email: 'asha@neelthreads.in', phone: '+91 98765 43210', password: 'indigo-and-madder-26',
      terms_accepted: true, price_rule_accepted: true, sells: 'both', city: 'Surat', website_or_instagram: '@neel.threads', proposed_commission_bps: 1000,
      store_details: {
        delivery: { mode: 'own', areas: { all_india: false, places: ['Surat'] }, delivery_days: '2_3' },
        returns: { window_days: 0, condition: null, refund_days: null },
        payment: { cash: true, upi: true },
        payout: { method: 'upi', upi_id: 'neel@okhdfcbank' },
        business: { legal_name: null, gstin: null },
      },
    }
    expect((await send('post', '/v1/auth/signup', { body: { ...signup, city: '' } })).status).toBe(422)
    ok((await send('post', '/v1/auth/signup', { body: signup })).status)
    const verify = db.emails.find((e) => e.kind === 'verify')!.token!
    ok((await send('post', '/v1/auth/verify-email', { body: { token: verify } })).status)
    expect((await send('post', '/v1/auth/verify-email', { body: { token: verify } })).status).toBe(400)
    ok((await send('post', '/v1/auth/resend-verification', { body: { email: 'asha@neelthreads.in' } })).status)
    ok((await send('post', '/v1/auth/forgot-password', { body: { email: DEMO_STAFF.email } })).status)
    const reset = db.emails.find((e) => e.kind === 'reset')!.token!
    expect((await send('post', '/v1/auth/set-password', { body: { token: reset, password: 'short' } })).status).toBe(422)
    ok((await send('post', '/v1/auth/set-password', { body: { token: reset, password: 'a-new-staff-password' } })).status)

    // Signed in as the owner.
    const login = await send('post', '/v1/auth/login', { body: DEMO_LOGIN })
    setToken(login.body.access_token as unknown as string)
    ok((await send('post', '/v1/auth/refresh')).status)
    setToken((await send('post', '/v1/auth/refresh')).body.access_token as unknown as string)
    ok((await send('get', '/v1/vendor/me')).status)

    ok((await send('get', '/v1/vendor/store-details')).status)
    ok((await send('put', '/v1/vendor/store-details/brand', { body: { sells: 'women', city: 'Ahmedabad', instagram_or_website: '@kalki.studio' } })).status)
    ok((await send('put', '/v1/vendor/store-details/contact', { body: { name: 'Kiran Shah', phone: '9825012345', email: DEMO_LOGIN.email } })).status)
    expect((await send('put', '/v1/vendor/store-details/contact', { body: { name: '', phone: '12', email: 'x' } })).status).toBe(422)
    ok((await send('put', '/v1/vendor/store-details/delivery', { body: { mode: 'shazlo', pickup_address: { line1: '14 Sahjanand Society', area: 'Ambawadi', city: 'Ahmedabad', pin: '380015' } } })).status)
    ok((await send('put', '/v1/vendor/store-details/returns', { body: { window_days: 7, condition: 'unworn_with_tags', refund_days: 5 } })).status)
    ok((await send('put', '/v1/vendor/store-details/payment', { body: { cash: true, upi: false } })).status)
    ok((await send('put', '/v1/vendor/store-details/payout', { body: { method: 'bank', holder_name: 'Kalki Studio LLP', account_number: '50100123454821', ifsc: 'HDFC0001234' } })).status)
    ok((await send('put', '/v1/vendor/store-details/business', { body: { legal_name: 'Kalki Studio LLP', gstin: null } })).status)
    ok((await send('post', '/v1/vendor/commission/proposal', { body: { rate_bps: 1000 } })).status)
    expect((await send('post', '/v1/vendor/commission/proposal', { body: { rate_bps: 99999 } })).status).toBe(422)

    ok((await send('get', '/v1/vendor/size-charts/dresses')).status)
    ok((await send('put', '/v1/vendor/size-charts/tops', { body: { measurements: { M: { chest: 102, shoulder: 45 } }, photo_asset_id: null } })).status)
    expect((await send('get', '/v1/vendor/size-charts/hats')).status).toBe(404)

    // Uploads: sign, the stand-in Cloudinary, register.
    const signed = await send('post', '/v1/vendor/assets/sign', { body: { kind: 'product_image', content_type: 'image/jpeg', size_bytes: 1200 } })
    ok(signed.status)
    expect((await send('post', '/v1/vendor/assets', { body: { public_id: signed.body.public_id } })).status).toBe(409)
    const form = new FormData()
    for (const [k, v] of Object.entries(signed.body.fields as unknown as Record<string, string>)) form.append(k, v)
    form.append('file', new Blob(['jpeg'], { type: 'image/jpeg' }), 'front.jpg')
    ok((await send('post', '/v1_1/shazlo-demo/image/upload', { raw: form, origin: 'https://api.cloudinary.com' })).status)
    const asset = await send('post', '/v1/vendor/assets', { body: { public_id: signed.body.public_id } })
    ok(asset.status)
    const logo = await send('post', '/v1/vendor/assets/sign', { body: { kind: 'brand_logo', content_type: 'image/png', size_bytes: 900 } })
    const logoForm = new FormData()
    for (const [k, v] of Object.entries(logo.body.fields as unknown as Record<string, string>)) logoForm.append(k, v)
    logoForm.append('file', new Blob(['png'], { type: 'image/png' }), 'logo.png')
    await send('post', '/v1_1/shazlo-demo/image/upload', { raw: logoForm, origin: 'https://api.cloudinary.com' })
    const logoAsset = await send('post', '/v1/vendor/assets', { body: { public_id: logo.body.public_id } })

    // Brand page.
    const draft = await send('get', '/v1/vendor/brand-profile')
    ok(draft.status)
    ok((await send('get', '/v1/vendor/brand-profile/published')).status)
    const { id: _id, version: _v, state: _s, logo_url: _l, banner_url: _b, submitted_at: _sa, published_at: _p, review: _r, updated_at: _u, in_review_version: _i, ...content } = draft.body
    ok((await send('put', '/v1/vendor/brand-profile', { body: { ...content, logo_asset_id: logoAsset.body.id, tagline: 'Indigo, always.' } })).status)
    expect((await send('put', '/v1/vendor/brand-profile', { body: { ...content, website_url: 'http://not-https' } })).status).toBe(422)
    ok((await send('post', '/v1/vendor/brand-profile/submit')).status)
    await send('get', '/v1/vendor/brand-profile')
    expect((await send('post', '/v1/vendor/brand-profile/submit')).status).toBe(409)

    // Products.
    ok((await send('get', '/v1/vendor/products?limit=5')).status)
    ok((await send('get', '/v1/vendor/products?gender=women&in_stock=true&sort=price_desc&limit=5')).status)
    expect((await send('get', '/v1/vendor/products?sort=cheapest')).status).toBe(422)
    expect((await send('get', '/v1/vendor/products?limit=500')).status).toBe(422)
    const created = await send('post', '/v1/vendor/products', { body: { sku: 'CT-1', title: 'Contract Kurta', category: null, gender: null, variants: [{ size: 'M', stock: 2 }] } })
    expect(created.status).toBe(201)
    const id = created.body.id as unknown as string
    ok((await send('get', `/v1/vendor/products/${id}`)).status)
    const put = await send('put', `/v1/vendor/products/${id}`, {
      body: {
        title: 'Contract Kurta', category: 'kurtas', gender: 'women', fabric: 'Cotton', description: 'Soft.', main_colour: 'Indigo', other_colours: ['Red'],
        variants: [{ size: 'M', price_paise: 120000, mrp_paise: null, stock: 3 }],
        images: [{ asset_id: asset.body.id, angle: 'front' }],
      },
    })
    ok(put.status)
    expect((await send('put', `/v1/vendor/products/${id}`, { body: { title: 'x', main_colour: 'Plaid' } })).status).toBe(422)
    const current = (put.body as unknown as { version: number }).version
    expect((await send('put', `/v1/vendor/products/${id}`, { body: { title: 'Contract Kurta', version: current - 1 } })).status).toBe(409)
    ok((await send('put', `/v1/vendor/products/${id}`, { body: { title: 'Contract Kurta', version: current } })).status)
    const refused = await send('post', `/v1/vendor/products/${id}/submit`)
    expect(refused.status).toBe(422)
    expect((refused.body.error as unknown as { code: string }).code).toBe('product_incomplete')
    expect((await send('post', '/v1/vendor/products', { body: { sku: 'CT-1', title: 'Again' } })).status).toBe(409)
    ok((await send('delete', `/v1/vendor/products/${id}`)).status)
    expect((await send('get', `/v1/vendor/products/${id}`)).status).toBe(404)
    // A product that can be sent: the draft co-ord has everything but its try-on photos.
    const coord = db.products.find((p) => p.sku === 'KS-DAB-042')!
    for (let n = 0; n < 5; n++) {
      const s = await send('post', '/v1/vendor/assets/sign', { body: { kind: 'product_image', content_type: 'image/webp', size_bytes: 500 } })
      const f = new FormData()
      for (const [k, v] of Object.entries(s.body.fields as unknown as Record<string, string>)) f.append(k, v)
      f.append('file', new Blob(['webp'], { type: 'image/webp' }), `try-${n}.webp`)
      await send('post', '/v1_1/shazlo-demo/image/upload', { raw: f, origin: 'https://api.cloudinary.com' })
      const a = await send('post', '/v1/vendor/assets', { body: { public_id: s.body.public_id } })
      coord.working!.content.images.push({ asset_id: a.body.id as unknown as string, alt_text: null, angle: 'tryon' })
    }
    ok((await send('post', `/v1/vendor/products/${coord.id}/submit`)).status)
    expect((await send('put', `/v1/vendor/products/${coord.id}`, { body: { title: 'Locked' } })).status).toBe(409)

    // Bulk import.
    const template = await send('get', '/v1/vendor/products/import/template?format=csv')
    ok(template.status)
    ok((await send('post', '/v1/vendor/products/import?mode=validate', { raw: String(template.body), type: 'text/csv' })).status)
    ok((await send('post', '/v1/vendor/products/import?mode=import', { raw: String(template.body), type: 'text/csv' })).status)
    expect((await send('post', '/v1/vendor/products/import?mode=validate', { raw: 'name,price\nx,1', type: 'text/csv' })).status).toBe(422)
    expect((await send('post', '/v1/vendor/products/import?mode=validate', { raw: 'x', type: 'application/pdf' })).status).toBe(415)

    // Review decisions and the team.
    ok((await send('get', '/v1/vendor/submissions?limit=10')).status)
    ok((await send('get', '/v1/vendor/submissions?status=rejected&subject=product')).status)
    const users = await send('get', '/v1/vendor/users')
    ok(users.status)
    ok((await send('post', '/v1/vendor/users', { body: { email: 'new.staff@kalkistudio.in' } })).status)
    const team = (await send('get', '/v1/vendor/users')).body as unknown as { id: string; email: string; status: string }[]
    const invited = team.find((u) => u.email === DEMO_INVITED)!
    ok((await send('post', `/v1/vendor/users/${invited.id}/resend-invite`)).status)
    const staff = team.find((u) => u.email === DEMO_STAFF.email)!
    ok((await send('patch', `/v1/vendor/users/${staff.id}`, { body: { disabled: true } })).status)
    expect((await send('post', `/v1/vendor/users/${staff.id}/resend-invite`)).status).toBe(409)
    ok((await send('post', '/v1/auth/change-password', { body: { current_password: DEMO_LOGIN.password, new_password: 'another-long-password' } })).status)
    ok((await send('post', '/v1/auth/logout')).status)
    expect((await send('post', '/v1/auth/refresh')).status).toBe(401)

    const failures = exchanges.flatMap(problems)
    expect(failures).toEqual([])

    // Every mock route answered at least once with success.
    const successes = exchanges.filter((x) => x.status < 300)
    const unexercised = handlers
      .map((h) => (h as unknown as { info: { method: string; path: string } }).info)
      .filter((info) => !String(info.path).startsWith('https://api.cloudinary.com'))
      .filter((info) => {
        const pattern = new RegExp(`^${String(info.path).replace(/^\*/, '').replace(/:[a-z_]+/g, '[^/]+')}$`)
        return !successes.some((x) => x.method.toUpperCase() === String(info.method) && pattern.test(x.path))
      })
      .map((info) => `${String(info.method)} ${String(info.path)}`)
    expect(unexercised).toEqual([])
  })

  it('catches an answer that breaks the contract', () => {
    const base = { contentType: 'application/json', requestId: 'req-1' }
    expect(problems({ ...base, method: 'get', path: '/v1/vendor/me', status: 200, body: { user: {}, vendor: { id: 'v' } } })).not.toEqual([])
    expect(problems({ ...base, method: 'get', path: '/v1/vendor/products/00000000-0000-4000-8000-000000000001', status: 200, body: { id: 'x' } })).not.toEqual([])
    expect(problems({ ...base, method: 'get', path: '/v1/vendor/me', status: 401, body: { detail: 'Not authenticated' } })).not.toEqual([])
    expect(problems({ ...base, method: 'get', path: '/v1/vendor/me', status: 401, body: { error: { code: 'unauthorized', message: 'x', request_id: 'other' } } })).not.toEqual([])
    expect(problems({ ...base, method: 'get', path: '/v1/vendor/nothing-here', status: 200, body: {} })).not.toEqual([])
  })

  it('documents every proposed operation and added field as a proposal', () => {
    const doc = parseYaml(read('../../openapi/proposed.yaml')) as Doc & { components: { schemas: Record<string, Record<string, unknown>> } }
    for (const [path, item] of Object.entries(doc.paths)) {
      for (const method of METHODS) {
        const op = item[method] as Record<string, unknown> | undefined
        if (op) expect({ path, method, proposal: op['x-proposal'] }).toEqual({ path, method, proposal: true })
      }
    }
    // A schema that extends or replaces a real one names it.
    for (const [name, schema] of Object.entries(doc.components.schemas)) {
      if (name.startsWith('Proposed')) expect({ name, names: Boolean(schema['x-extends'] ?? schema['x-replaces']) }).toEqual({ name, names: true })
    }
  })
})
