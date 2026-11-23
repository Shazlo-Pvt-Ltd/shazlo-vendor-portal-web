import { delay, http, HttpResponse } from 'msw'
import type { SetupServer } from 'msw/node'
import { BASE } from './msw'

export interface FakeAdmin {
  id: string
  email: string
  display_name: string
  roles: string[]
  is_active: boolean
  must_change_password: boolean
  created_at: string
  last_login_at: string | null
}

export interface RecordedCall {
  method: string
  path: string
  query: Record<string, string>
  body?: unknown
}

const ROLES = [
  { name: 'super_admin', description: 'Sees every module and manages admins.' },
  { name: 'vendor_reviewer', description: 'Reviews vendor applications, products and brand pages.' },
]

export const ME = 'a1'

export function admin(overrides: Partial<FakeAdmin> & { id: string }): FakeAdmin {
  return {
    email: `${overrides.id}@shazlo.test`,
    display_name: `Admin ${overrides.id}`,
    roles: ['vendor_reviewer'],
    is_active: true,
    must_change_password: false,
    created_at: '2026-01-01T00:00:00Z',
    last_login_at: null,
    ...overrides,
  }
}

const error = (status: number, code: string, message = code, headers: Record<string, string> = {}) =>
  HttpResponse.json({ error: { code, message } }, { status, headers })

/**
 * A stand-in for identity-api's admin routes that applies its real rules: `email_taken` (any letter case),
 * `weak_password` (under 12 characters, or too common), `unknown_role`, `cannot_deactivate_self`,
 * `last_super_admin`, `admin_not_found`, paging and the `q`, `role` and `is_active` filters. It records every
 * call, so a test can see what was sent and that nothing was sent.
 */
export function fakeIdentity(server: SetupServer, initial: FakeAdmin[]) {
  const state = {
    admins: initial.map((entry) => ({ ...entry, roles: [...entry.roles] })),
    roles: ROLES.map((role) => ({ ...role })),
    calls: [] as RecordedCall[],
    /** Answer the next create with this status and code (a 429 uses `retryAfter`). */
    nextCreateFails: undefined as { status: number; code: string; retryAfter?: number } | undefined,
    /** Answer the next change (a PATCH) with this status and code. */
    nextPatchFails: undefined as { status: number; code: string } | undefined,
    listFails: false,
    /** Answer the list after this many milliseconds. */
    listDelayMs: 0,
    /** Answer the list with nobody in it, whatever the filters. */
    listEmpty: false,
    callsTo: (method: string, path: string) => state.calls.filter((call) => call.method === method && call.path === path),
    find: (id: string) => state.admins.find((entry) => entry.id === id),
  }

  const record = (method: string, path: string, request: Request, body?: unknown) =>
    state.calls.push({ method, path, query: Object.fromEntries(new URL(request.url).searchParams), ...(body === undefined ? {} : { body }) })
  const weak = (password: string, email: string): string | undefined => {
    if (password.length < 12) return 'Password must be at least 12 characters'
    if (password.toLowerCase().includes('password')) return 'Password is too common'
    if (password.toLowerCase() === email.toLowerCase()) return 'Password must not be the email address'
    return undefined
  }
  const activeSuperAdmins = (admins: FakeAdmin[]) => admins.filter((entry) => entry.is_active && entry.roles.includes('super_admin')).length

  server.use(
    http.get(`${BASE}/v1/roles`, ({ request }) => {
      record('GET', '/v1/roles', request)
      return HttpResponse.json(state.roles)
    }),
    http.get(`${BASE}/v1/admins`, async ({ request }) => {
      record('GET', '/v1/admins', request)
      if (state.listDelayMs > 0) await delay(state.listDelayMs)
      if (state.listFails) return error(503, 'unavailable', 'database is down')
      if (state.listEmpty) return HttpResponse.json({ items: [], total: 0, limit: 25, offset: 0 })
      const url = new URL(request.url)
      const q = url.searchParams.get('q')?.toLowerCase()
      const role = url.searchParams.get('role')
      const active = url.searchParams.get('is_active')
      const limit = Number(url.searchParams.get('limit') ?? 25)
      const offset = Number(url.searchParams.get('offset') ?? 0)
      const matching = state.admins
        .filter((entry) => !q || entry.email.toLowerCase().includes(q) || entry.display_name.toLowerCase().includes(q))
        .filter((entry) => !role || entry.roles.includes(role))
        .filter((entry) => active === null || entry.is_active === (active === 'true'))
        .sort((a, b) => a.display_name.localeCompare(b.display_name, 'en', { numeric: true }))
      return HttpResponse.json({ items: matching.slice(offset, offset + limit), total: matching.length, limit, offset })
    }),
    http.post(`${BASE}/v1/admins`, async ({ request }) => {
      const body = (await request.json()) as { email: string; display_name: string; password: string; roles: string[] }
      record('POST', '/v1/admins', request, body)
      const failure = state.nextCreateFails
      if (failure) {
        state.nextCreateFails = undefined
        return error(failure.status, failure.code, failure.code, failure.retryAfter ? { 'Retry-After': String(failure.retryAfter) } : {})
      }
      if (state.admins.some((entry) => entry.email.toLowerCase() === body.email.toLowerCase())) return error(409, 'email_taken')
      if (body.roles.some((name) => !state.roles.some((role) => role.name === name))) return error(422, 'unknown_role')
      const problem = weak(body.password, body.email)
      if (problem) return error(422, 'weak_password', problem)
      const created = admin({ id: `n${state.admins.length + 1}`, email: body.email.toLowerCase(), display_name: body.display_name, roles: body.roles, must_change_password: true })
      state.admins.push(created)
      return HttpResponse.json(created, { status: 201 })
    }),
    http.patch(`${BASE}/v1/admins/:id`, async ({ request, params }) => {
      const body = (await request.json()) as { display_name?: string; roles?: string[]; is_active?: boolean }
      record('PATCH', '/v1/admins/{id}', request, { id: params.id, ...body })
      const failure = state.nextPatchFails
      if (failure) {
        state.nextPatchFails = undefined
        return error(failure.status, failure.code)
      }
      const target = state.find(String(params.id))
      if (!target) return error(404, 'admin_not_found')
      if (body.is_active === false && target.id === ME) return error(409, 'cannot_deactivate_self')
      if (body.roles?.some((name) => !state.roles.some((role) => role.name === name))) return error(422, 'unknown_role')
      const next = { ...target, ...(body.display_name === undefined ? {} : { display_name: body.display_name }), ...(body.roles === undefined ? {} : { roles: body.roles }), ...(body.is_active === undefined ? {} : { is_active: body.is_active }) }
      if (activeSuperAdmins(state.admins.map((entry) => (entry.id === target.id ? next : entry))) === 0) return error(409, 'last_super_admin')
      Object.assign(target, next)
      return HttpResponse.json(target)
    }),
    http.post(`${BASE}/v1/admins/:id/reset-password`, async ({ request, params }) => {
      const body = (await request.json()) as { new_password: string }
      record('POST', '/v1/admins/{id}/reset-password', request, { id: params.id, ...body })
      const target = state.find(String(params.id))
      if (!target) return error(404, 'admin_not_found')
      const problem = weak(body.new_password, target.email)
      if (problem) return error(422, 'weak_password', problem)
      target.must_change_password = true
      return new HttpResponse(null, { status: 204 })
    }),
  )
  return state
}
