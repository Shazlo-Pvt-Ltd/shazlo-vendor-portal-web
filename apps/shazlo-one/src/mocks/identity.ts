import { mockModuleToken } from '@shazlo/mock-vendor-api'
import { http, HttpResponse, type HttpResponseResolver } from 'msw'
import type { components } from '../api/identity'

// Stand-in for identity-api (services/identity-api) in the browser and in tests. Same routes and
// envelopes; the HttpOnly identity_refresh cookie is modelled as `db.cookie`.
type S = components['schemas']

export const DEMO_ADMIN = { email: 'naman@shazlo.store', password: 'shazlo-one-2026' }
export const INVITED_ADMIN = { email: 'sneha@shazlo.store', password: 'welcome-sneha-01' }

export const ROLES: S['Role'][] = [
  { name: 'super_admin', description: 'Manages admins and roles, and passes every role check in every module.' },
  { name: 'vendor_reviewer', description: 'Reviews vendor applications, brand pages and products in the Vendors module.' },
]
// ADR 0009: which roles may get a token for which service.
const AUDIENCE_ROLES: Record<string, string[]> = { 'vendor-api': ['super_admin', 'vendor_reviewer'] }
const ACCESS_SECONDS = 15 * 60
const MAX_FAILURES = 5

type AdminRecord = S['Admin'] & { password: string }

export interface IdentityDb {
  now: () => Date
  admins: AdminRecord[]
  access: Map<string, { adminId: string; exp: number }>
  cookie: string | null
  refresh: Map<string, string>
  failures: Map<string, number>
  seq: number
}

export function createIdentityDb({ now = () => new Date() }: { now?: () => Date } = {}): IdentityDb {
  const t = now().getTime()
  const at = (h: number) => new Date(t - h * 3_600_000).toISOString()
  const admin = (id: string, display_name: string, email: string, roles: string[], extra: Partial<AdminRecord> = {}): AdminRecord => ({
    id, display_name, email, roles, is_active: true, must_change_password: false, created_at: at(24 * 60), last_login_at: at(3), password: DEMO_ADMIN.password, ...extra,
  })
  return {
    now,
    admins: [
      admin('a_naman', 'Naman Sinha', 'naman@shazlo.store', ['super_admin'], { last_login_at: at(0.2), created_at: at(24 * 120) }),
      admin('a_priya', 'Priya Mehta', 'priya@shazlo.store', ['vendor_reviewer'], { last_login_at: at(1.5) }),
      admin('a_rahul', 'Rahul Desai', 'rahul@shazlo.store', ['vendor_reviewer'], { last_login_at: at(26) }),
      admin('a_sneha', 'Sneha Iyer', 'sneha@shazlo.store', ['vendor_reviewer'], { must_change_password: true, last_login_at: null, created_at: at(20), password: INVITED_ADMIN.password }),
      admin('a_kabir', 'Kabir Shah', 'kabir@shazlo.store', ['vendor_reviewer'], { is_active: false, last_login_at: at(24 * 38) }),
    ],
    access: new Map(),
    cookie: null,
    refresh: new Map(),
    failures: new Map(),
    seq: 100,
  }
}

function fail(status: number, code: string, message: string, fields?: Record<string, string>) {
  return HttpResponse.json({ message, extra: fields ? { code, fields } : { code } }, { status })
}

const profile = (a: AdminRecord): S['AdminProfile'] => ({ id: a.id, email: a.email, display_name: a.display_name, roles: a.roles, must_change_password: a.must_change_password })
const out = ({ password: _p, ...a }: AdminRecord): S['Admin'] => a

function issue(db: IdentityDb, a: AdminRecord): S['SessionResponse'] {
  db.seq += 1
  const token = `mock.identity.${a.id}.${db.seq}`
  db.access.set(token, { adminId: a.id, exp: Math.floor(db.now().getTime() / 1000) + ACCESS_SECONDS })
  const refresh = `refresh.${a.id}.${db.seq}`
  db.refresh.set(refresh, a.id)
  db.cookie = refresh
  return { access_token: token, token_type: 'Bearer', expires_in: ACCESS_SECONDS, must_change_password: a.must_change_password, admin: profile(a) }
}

export function createIdentityHandlers(getDb: () => IdentityDb) {
  const caller = (request: Request): AdminRecord | null => {
    const db = getDb()
    const entry = db.access.get(request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '')
    if (!entry || entry.exp * 1000 < db.now().getTime()) return null
    const a = db.admins.find((x) => x.id === entry.adminId)
    return a?.is_active ? a : null
  }
  const authed = (fn: (info: Parameters<HttpResponseResolver>[0], me: AdminRecord) => ReturnType<HttpResponseResolver>, role?: string): HttpResponseResolver => (info) => {
    const me = caller(info.request)
    if (!me) return fail(401, 'unauthenticated', 'Your session has ended. Sign in again.')
    if (role && !me.roles.includes(role)) return fail(403, 'forbidden', 'Only super admins can manage admins.')
    return fn(info, me)
  }

  return [
    http.post('*/v1/auth/login', async ({ request }) => {
      const db = getDb()
      const { email, password } = (await request.json()) as { email: string; password: string }
      const key = email.trim().toLowerCase()
      if ((db.failures.get(key) ?? 0) >= MAX_FAILURES) return fail(429, 'rate_limited', 'Too many attempts. Wait 15 minutes, or ask a super admin to reset your password.')
      const a = db.admins.find((x) => x.email === key)
      if (!a || !a.is_active || a.password !== password) {
        db.failures.set(key, (db.failures.get(key) ?? 0) + 1)
        return fail(401, 'invalid_credentials', 'That email and password do not match. Check both and try again.')
      }
      db.failures.delete(key)
      a.last_login_at = db.now().toISOString()
      return HttpResponse.json(issue(db, a))
    }),

    http.post('*/v1/auth/refresh', () => {
      const db = getDb()
      const adminId = db.cookie ? db.refresh.get(db.cookie) : undefined
      const a = db.admins.find((x) => x.id === adminId)
      if (!a || !a.is_active) return fail(401, 'unauthenticated', 'Your session has ended. Sign in again.')
      db.refresh.delete(db.cookie!)
      return HttpResponse.json(issue(db, a))
    }),

    http.post('*/v1/auth/logout', () => {
      const db = getDb()
      if (db.cookie) db.refresh.delete(db.cookie)
      db.cookie = null
      return new HttpResponse(null, { status: 204 })
    }),

    http.post('*/v1/auth/change-password', authed(async ({ request }, me) => {
      const { current_password, new_password } = (await request.json()) as { current_password: string; new_password: string }
      if (current_password !== me.password) return fail(400, 'invalid_credentials', 'Your current password is not right.', { current_password: 'This is not your current password.' })
      if (new_password.length < 12) return fail(422, 'validation_error', 'Choose a longer password.', { new_password: 'Use at least 12 characters.' })
      if (new_password === current_password) return fail(422, 'validation_error', 'Choose a new password.', { new_password: 'Use a different password from the temporary one.' })
      me.password = new_password
      me.must_change_password = false
      return HttpResponse.json(issue(getDb(), me))
    })),

    http.post('*/v1/auth/token', authed(async ({ request }, me) => {
      const { audience } = (await request.json()) as { audience: string }
      const allowed = AUDIENCE_ROLES[audience]
      if (!allowed || !me.roles.some((r) => allowed.includes(r))) return fail(403, 'forbidden', 'Your role does not give access to this module.')
      const exp = Math.floor(getDb().now().getTime() / 1000) + 300
      return HttpResponse.json({ access_token: mockModuleToken({ id: me.id, name: me.display_name }, exp), token_type: 'Bearer', expires_in: 300, audience } satisfies S['TokenResponse'])
    })),

    http.get('*/v1/me', authed((_, me) => HttpResponse.json(profile(me)))),

    http.get('*/v1/roles', authed(() => HttpResponse.json(ROLES))),

    http.get('*/v1/admins', authed(({ request }) => {
      const q = new URL(request.url).searchParams
      let items = getDb().admins
      const text = q.get('q')?.toLowerCase()
      if (text) items = items.filter((a) => `${a.display_name} ${a.email}`.toLowerCase().includes(text))
      if (q.get('role')) items = items.filter((a) => a.roles.includes(q.get('role')!))
      if (q.get('is_active')) items = items.filter((a) => String(a.is_active) === q.get('is_active'))
      return HttpResponse.json({ items: items.map(out), total: items.length, limit: 25, offset: 0 } satisfies S['AdminList'])
    }, 'super_admin')),

    http.post('*/v1/admins', authed(async ({ request }) => {
      const db = getDb()
      const body = (await request.json()) as S['CreateAdmin']
      const fields: Record<string, string> = {}
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email ?? '')) fields.email = 'Enter an email like name@shazlo.store.'
      if (!body.display_name?.trim()) fields.display_name = 'Add their name.'
      if (!body.roles?.length) fields.roles = 'Choose at least one role.'
      if ((body.password ?? '').length < 12) fields.password = 'Temporary passwords need at least 12 characters.'
      if (Object.keys(fields).length) return fail(422, 'validation_error', 'Check the highlighted fields.', fields)
      if (db.admins.some((a) => a.email === body.email.toLowerCase())) return fail(409, 'conflict', 'An admin with this email already exists.', { email: 'This email already has an admin account.' })
      db.seq += 1
      const a: AdminRecord = { id: `a_${db.seq}`, email: body.email.toLowerCase(), display_name: body.display_name.trim(), roles: body.roles, is_active: true, must_change_password: true, created_at: db.now().toISOString(), last_login_at: null, password: body.password }
      db.admins.push(a)
      return HttpResponse.json(out(a), { status: 201 })
    }, 'super_admin')),

    http.get('*/v1/admins/:id', authed(({ params }) => {
      const a = getDb().admins.find((x) => x.id === params.id)
      return a ? HttpResponse.json(out(a)) : fail(404, 'not_found', 'We could not find that admin.')
    }, 'super_admin')),

    http.patch('*/v1/admins/:id', authed(async ({ params, request }, me) => {
      const db = getDb()
      const a = db.admins.find((x) => x.id === params.id)
      if (!a) return fail(404, 'not_found', 'We could not find that admin.')
      const body = (await request.json()) as S['UpdateAdmin']
      if (a.id === me.id && (body.is_active === false || (body.roles && !body.roles.includes('super_admin')))) {
        return fail(409, 'conflict', 'You cannot remove your own super admin access or deactivate yourself.')
      }
      if (body.roles && !body.roles.length) return fail(422, 'validation_error', 'Choose at least one role.', { roles: 'Choose at least one role.' })
      Object.assign(a, Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)))
      if (body.is_active === false) for (const [token, owner] of db.refresh) if (owner === a.id) db.refresh.delete(token)
      return HttpResponse.json(out(a))
    }, 'super_admin')),

    http.post('*/v1/admins/:id/reset-password', authed(async ({ params, request }) => {
      const db = getDb()
      const a = db.admins.find((x) => x.id === params.id)
      if (!a) return fail(404, 'not_found', 'We could not find that admin.')
      const { new_password } = (await request.json()) as { new_password: string }
      if (new_password.length < 12) return fail(422, 'validation_error', 'Temporary passwords need at least 12 characters.')
      a.password = new_password
      a.must_change_password = true
      for (const [token, owner] of db.refresh) if (owner === a.id) db.refresh.delete(token)
      return new HttpResponse(null, { status: 204 })
    }, 'super_admin')),
  ]
}
