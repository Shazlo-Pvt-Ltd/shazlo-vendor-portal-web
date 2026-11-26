import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import { getResponse } from 'msw'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createIdentityDb, createIdentityHandlers, DEMO_ADMIN, INVITED_ADMIN } from './identity'

// Every answer the identity mock gives must be what identity-api documents in
// services/identity-api/openapi.json, and every error must be its {error: {code, message, request_id}}
// envelope. The scenario calls every route the shell uses with success and the main error answers.

type Doc = { paths: Record<string, Record<string, { responses?: Record<string, { content?: Record<string, unknown> }> }>> }

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
const spec = JSON.parse(read('../../../../services/identity-api/openapi.json')) as Doc

const ajv = new Ajv2020({ strict: false, allErrors: true })
addFormats(ajv)
ajv.addSchema({ ...spec, $id: 'identity.json' })

const templateRegex = (template: string) => new RegExp(`^${template.replace(/\{[^}]+\}/g, '[^/]+')}$`)
const pointer = (...parts: string[]) => parts.map((p) => p.replace(/~/g, '~0').replace(/\//g, '~1')).join('/')

interface Exchange {
  method: string
  path: string
  status: number
  contentType: string
  body: unknown
}

function problems(x: Exchange): string[] {
  const label = `${x.method.toUpperCase()} ${x.path} ${x.status}`
  if (x.status >= 400) {
    const validate = ajv.getSchema('identity.json#/components/schemas/ErrorResponse')!
    return validate(x.body) ? [] : [`${label}: error envelope: ${ajv.errorsText(validate.errors)}`]
  }
  const template = Object.keys(spec.paths).find((t) => templateRegex(t).test(x.path) && spec.paths[t]![x.method])
  if (!template) return [`${label}: no documented operation`]
  const documented = spec.paths[template]![x.method]!.responses?.[String(x.status)]
  if (!documented) return [`${label}: status is not documented for ${template}`]
  if (x.status === 204) return x.body === null ? [] : [`${label}: a 204 must have no body`]
  const type = x.contentType.split(';')[0]!.trim()
  if (!documented.content?.[type]) return [`${label}: content type ${type} is not documented`]
  const validate = ajv.getSchema(`identity.json#/${pointer('paths', template, x.method, 'responses', String(x.status), 'content', type, 'schema')}`)
  if (!validate) return [`${label}: no schema`]
  return validate(x.body) ? [] : [`${label}: ${ajv.errorsText(validate.errors)}`]
}

function harness() {
  const db = createIdentityDb({ now: () => new Date('2026-11-21T10:00:00Z') })
  const handlers = createIdentityHandlers(() => db)
  const exchanges: Exchange[] = []
  let token: string | null = null
  async function send(method: string, path: string, body?: unknown) {
    const headers = new Headers()
    if (token) headers.set('Authorization', `Bearer ${token}`)
    if (body !== undefined) headers.set('Content-Type', 'application/json')
    const request = new Request(`https://api.test${path}`, { method: method.toUpperCase(), headers, body: body === undefined ? undefined : JSON.stringify(body) })
    const response = await getResponse(handlers, request)
    if (!response) throw new Error(`no mock answers ${method.toUpperCase()} ${path}`)
    const contentType = response.headers.get('Content-Type') ?? ''
    const text = await response.text()
    const parsed: unknown = text === '' ? null : contentType.includes('json') ? JSON.parse(text) : text
    exchanges.push({ method, path: path.split('?')[0]!, status: response.status, contentType, body: parsed })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the contract test reads fields off whatever shape each endpoint answers
    return { status: response.status, body: parsed as Record<string, any>, response }
  }
  return { db, send, exchanges, setToken: (next: string | null) => (token = next) }
}

describe('the identity mock against identity-api’s contract', () => {
  it('answers every route as openapi.json says', async () => {
    const { send, exchanges, setToken } = harness()

    // Signed out.
    expect((await send('post', '/v1/auth/login', { email: DEMO_ADMIN.email, password: 'wrong-password' })).status).toBe(401)
    expect((await send('get', '/v1/me')).status).toBe(401)
    expect((await send('post', '/v1/auth/refresh')).status).toBe(401)

    // Sign in, restore, token exchange.
    const login = await send('post', '/v1/auth/login', DEMO_ADMIN)
    expect(login.status).toBe(200)
    setToken(login.body.access_token)
    const refreshed = await send('post', '/v1/auth/refresh')
    expect(refreshed.status).toBe(200)
    setToken(refreshed.body.access_token)
    expect((await send('get', '/v1/me')).status).toBe(200)
    expect((await send('get', '/v1/roles')).status).toBe(200)
    expect((await send('post', '/v1/auth/token', { audience: 'vendor-api' })).status).toBe(200)

    // Admins.
    const list = await send('get', '/v1/admins?limit=10&offset=0')
    expect(list.status).toBe(200)
    const created = await send('post', '/v1/admins', { email: 'new.person@shazlo.store', display_name: 'New Person', roles: ['vendor_reviewer'], password: 'a-long-temporary-pass' })
    expect(created.status).toBe(201)
    const id = created.body.id as string
    expect((await send('get', `/v1/admins/${id}`)).status).toBe(200)
    expect((await send('post', '/v1/admins', { email: 'new.person@shazlo.store', display_name: 'New Person', roles: ['vendor_reviewer'], password: 'a-long-temporary-pass' })).status).toBe(409)
    expect((await send('post', '/v1/admins', { email: 'not-an-email', display_name: '', roles: [], password: 'x' })).status).toBe(422)
    expect((await send('patch', `/v1/admins/${id}`, { is_active: false })).status).toBe(200)
    expect((await send('patch', `/v1/admins/${id}`, { roles: [] })).status).toBe(422)
    expect((await send('post', `/v1/admins/${id}/reset-password`, { new_password: 'another-long-temporary' })).status).toBeLessThan(300)
    expect((await send('post', `/v1/admins/${id}/reset-password`, { new_password: 'short' })).status).toBe(422)
    expect((await send('get', '/v1/admins/00000000-0000-0000-0000-000000000000')).status).toBe(404)

    // Password change.
    expect((await send('post', '/v1/auth/change-password', { current_password: 'wrong', new_password: 'a-brand-new-password' })).status).toBe(400)
    expect((await send('post', '/v1/auth/change-password', { current_password: DEMO_ADMIN.password, new_password: 'short' })).status).toBe(422)
    expect((await send('post', '/v1/auth/change-password', { current_password: DEMO_ADMIN.password, new_password: 'a-brand-new-password' })).status).toBeLessThan(300)

    // Sign out.
    expect((await send('post', '/v1/auth/logout')).status).toBeLessThan(300)

    const wrong = exchanges.flatMap(problems)
    expect(wrong).toEqual([])
    // Every route the shell calls was exercised.
    for (const route of ['/v1/auth/login', '/v1/auth/refresh', '/v1/auth/logout', '/v1/auth/token', '/v1/auth/change-password', '/v1/me', '/v1/roles', '/v1/admins']) {
      expect(exchanges.some((x) => x.path === route && x.status < 300)).toBe(true)
    }
  })

  it('rate-limits repeated wrong passwords with Retry-After and the rate_limited code', async () => {
    const { send, exchanges } = harness()
    let last = await send('post', '/v1/auth/login', { email: INVITED_ADMIN.email, password: 'wrong-password' })
    for (let i = 0; i < 5; i++) last = await send('post', '/v1/auth/login', { email: INVITED_ADMIN.email, password: 'wrong-password' })
    expect(last.status).toBe(429)
    expect(last.body.error.code).toBe('rate_limited')
    expect(last.response.headers.get('Retry-After')).toMatch(/^\d+$/)
    expect(exchanges.flatMap(problems)).toEqual([])
  })

  it('documents every error code the mock can answer', () => {
    const codes = new Set(Object.keys((spec as unknown as { 'x-error-codes'?: object })['x-error-codes'] ?? {}))
    // The spec lists codes in each response description (`code`: ...); the mock must stay inside that set.
    const text = JSON.stringify(spec)
    for (const code of ['unauthorized', 'forbidden', 'invalid_credentials', 'invalid_refresh_token', 'invalid_current_password', 'weak_password', 'email_taken', 'admin_not_found', 'cannot_deactivate_self', 'rate_limited', 'validation_error']) {
      expect(codes.has(code) || text.includes(`\`${code}\``)).toBe(true)
    }
  })
})
