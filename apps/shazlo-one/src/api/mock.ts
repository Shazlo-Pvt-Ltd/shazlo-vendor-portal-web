// In-memory stand-in for identity-api (Phase 1) and vendor-api's admin summary, so the shell can be
// built and reviewed before the services are deployed. Names and numbers come from the A- wireframes.

export type Role = 'super_admin' | 'vendor_reviewer'

export interface Admin {
  id: string
  name: string
  initials: string
  email: string
  roles: Role[]
  status: 'active' | 'invited' | 'deactivated'
  /** Last successful sign-in; missing until an invited admin sets a password. */
  lastSignInAt?: string
  mustChangePassword?: boolean
}

export interface ShellSession {
  admin: Admin
  /** Access token for identity-api; kept in memory only (ADR 0009). */
  accessToken: string
  expiresAt: number
}

export interface ModuleSummary {
  waiting: number
  oldest: string
  decidedToday: number
  byType: Array<{ label: string; count: number; oldest: string }>
  publishing: { delivered24h: number; failed: number; failedEventTypes: string[] }
  recentDecisions: Array<{ at: string; title: string; outcome: 'approved' | 'sent_back' | 'more_info' }>
}

export class ShellApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public details: { remaining?: number; retryAfter?: number } = {},
  ) {
    super(message)
  }
}

const wait = (ms = 250) => new Promise(r => setTimeout(r, import.meta.env.MODE === 'test' ? 0 : ms))
const MINUTE = 60_000

export const DEMO_ADMIN_PASSWORD = 'shazlo-one-2026'
/** identity-api login limit: 5 failures, then a 60-second pause (A-01). */
export const SIGN_IN_MAX_ATTEMPTS = 5
export const SIGN_IN_COOLDOWN_S = 60

const todayAt = (h: number, m: number) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString() }

// The A-11 board's five people. The board's super_admin is "Aarav Desai"; the demo signs in as Naman.
function seedAdmins(): Admin[] {
  return [
    { id: 'a_priya', name: 'Priya Mehta', initials: 'PM', email: 'priya@shazlo.store', roles: ['vendor_reviewer'], status: 'active', lastSignInAt: todayAt(10, 30) },
    { id: 'a_naman', name: 'Naman Sinha', initials: 'NS', email: 'naman@shazlo.store', roles: ['super_admin'], status: 'active', lastSignInAt: new Date().toISOString() },
    { id: 'a_rahul', name: 'Rahul Desai', initials: 'RD', email: 'rahul@shazlo.store', roles: ['vendor_reviewer'], status: 'active', lastSignInAt: todayAt(12, 40) },
    { id: 'a_sneha', name: 'Sneha Iyer', initials: 'SI', email: 'sneha@shazlo.store', roles: ['vendor_reviewer'], status: 'invited', mustChangePassword: true },
    { id: 'a_kabir', name: 'Kabir Shah', initials: 'KS', email: 'kabir@shazlo.store', roles: ['vendor_reviewer'], status: 'deactivated', lastSignInAt: '2026-10-02T10:00:00+05:30' },
  ]
}

let admins = seedAdmins()
let session: ShellSession | null = null
let failures = new Map<string, { count: number; lockedUntil: number }>()

// Development only: a flag (never a token) so a reload keeps the demo admin signed in.
const DEV_FLAG = 'shz-one-demo-admin'
const devMode = import.meta.env.DEV && import.meta.env.MODE !== 'test' && typeof sessionStorage !== 'undefined'
const devRemember = (adminId: string | null) => {
  if (!devMode) return
  if (adminId) sessionStorage.setItem(DEV_FLAG, adminId)
  else sessionStorage.removeItem(DEV_FLAG)
}

function token(): { accessToken: string; expiresAt: number } {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return { accessToken: `mock.${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}`, expiresAt: Math.floor((Date.now() + 15 * MINUTE) / 1000) }
}

if (devMode) {
  const remembered = admins.find(a => a.id === sessionStorage.getItem(DEV_FLAG))
  if (remembered) session = { admin: structuredClone(remembered), ...token() }
}

export function resetShellMock(signedInAs?: 'reviewer' | 'super') {
  admins = seedAdmins()
  failures = new Map()
  session = null
  if (signedInAs) session = { admin: structuredClone(admins[signedInAs === 'reviewer' ? 0 : 1]!), ...token() }
}

const activeSuperAdmins = (except?: string) => admins.filter(x => x.id !== except && x.roles.includes('super_admin') && x.status === 'active').length

export const shellApi = {
  /** POST /v1/auth/login. One message for unknown email and wrong password; rate-limited per email. */
  async signIn(email: string, password: string): Promise<ShellSession> {
    await wait(400)
    const key = email.trim().toLowerCase()
    const now = Date.now()
    const f = failures.get(key) ?? { count: 0, lockedUntil: 0 }
    if (f.lockedUntil > now) {
      throw new ShellApiError('rate_limited', 'Too many attempts.', { retryAfter: Math.ceil((f.lockedUntil - now) / 1000) })
    }
    const admin = admins.find(a => a.email === key && a.status === 'active')
    if (!admin || password !== DEMO_ADMIN_PASSWORD) {
      f.count += 1
      if (f.count >= SIGN_IN_MAX_ATTEMPTS) {
        failures.set(key, { count: 0, lockedUntil: now + SIGN_IN_COOLDOWN_S * 1000 })
        throw new ShellApiError('rate_limited', 'Too many attempts.', { retryAfter: SIGN_IN_COOLDOWN_S })
      }
      failures.set(key, f)
      throw new ShellApiError('invalid_credentials', 'That email and password don’t match.', { remaining: SIGN_IN_MAX_ATTEMPTS - f.count })
    }
    failures.delete(key)
    admin.lastSignInAt = new Date().toISOString()
    session = { admin: structuredClone(admin), ...token() }
    devRemember(admin.id)
    return structuredClone(session)
  },
  async signOut(): Promise<void> {
    await wait(100)
    session = null
    devRemember(null)
  },
  async getSession(): Promise<ShellSession | null> {
    await wait(50)
    return session ? structuredClone(session) : null
  },
  /** Token exchange (POST /v1/auth/token): a 15-minute token whose audience is one module's backend. */
  async moduleToken(moduleId: string): Promise<{ accessToken: string; expiresAt: number }> {
    await wait(120)
    if (!session) throw new ShellApiError('unauthorized', 'Session ended')
    void moduleId
    return token()
  },
  /** ADR 0001 §7: after 3 failed loads the shell reports the module as unavailable. */
  async reportModuleFailure(report: { moduleId: string; origin: string; requestId: string; attempts: number; reason: string }): Promise<{ reportedAt: string }> {
    await wait(150)
    if (import.meta.env.DEV && import.meta.env.MODE !== 'test') console.warn('[shazlo-one] module failure reported', report)
    return { reportedAt: new Date().toISOString() }
  },
  async vendorSummary(): Promise<ModuleSummary> {
    await wait()
    return {
      waiting: 14,
      oldest: '1 d',
      decidedToday: 11,
      byType: [
        { label: 'Vendor applications', count: 3, oldest: '1 d' },
        { label: 'Brand pages', count: 2, oldest: '6 h' },
        { label: 'Products', count: 9, oldest: '19 h' },
      ],
      publishing: { delivered24h: 312, failed: 1, failedEventTypes: ['product.published'] },
      recentDecisions: [
        { at: todayAt(11, 40), title: 'Ajrakh Block-Print Kurta · Kalki Studio', outcome: 'sent_back' },
        { at: todayAt(11, 2), title: 'Bandhani Silk Dupatta · Kalki Studio', outcome: 'approved' },
        { at: todayAt(10, 31), title: 'Saanjh Label · vendor application', outcome: 'more_info' },
      ],
    }
  },
  async listAdmins(): Promise<Admin[]> {
    await wait()
    return structuredClone(admins)
  },
  /** Creates the admin and emails a set-password link (A-11 note 3). */
  async inviteAdmin(input: { name: string; email: string; roles: Role[] }): Promise<Admin> {
    await wait(300)
    const email = input.email.trim().toLowerCase()
    if (admins.some(a => a.email === email)) throw new ShellApiError('duplicate_email', 'An admin with this email already exists.')
    const admin: Admin = {
      id: `a_${Date.now()}`,
      name: input.name.trim(),
      initials: input.name.trim().split(/\s+/).map(w => w[0]?.toUpperCase()).slice(0, 2).join(''),
      email,
      roles: input.roles,
      status: 'invited',
      mustChangePassword: true,
    }
    admins.push(admin)
    return structuredClone(admin)
  },
  async updateAdmin(id: string, patch: Partial<Pick<Admin, 'roles' | 'status'>>): Promise<Admin> {
    await wait(250)
    const a = admins.find(x => x.id === id)
    if (!a) throw new ShellApiError('not_found', 'Admin not found')
    const losesSuper = a.roles.includes('super_admin') && a.status === 'active'
      && (patch.status === 'deactivated' || (patch.roles !== undefined && !patch.roles.includes('super_admin')))
    if (losesSuper && activeSuperAdmins(a.id) === 0) {
      throw new ShellApiError('last_super_admin', 'You can’t remove the last super_admin. Make someone else super_admin first.')
    }
    if (patch.roles !== undefined && patch.roles.length === 0) throw new ShellApiError('no_roles', 'Choose at least one role.')
    Object.assign(a, patch)
    return structuredClone(a)
  },
  /** Emails a set-password link and revokes every refresh-token family. */
  async resetPassword(id: string): Promise<void> {
    await wait(250)
    const a = admins.find(x => x.id === id)
    if (a) a.mustChangePassword = true
  },
}

/** True when deactivating (or removing super_admin from) this admin would leave no active super_admin. */
export function isLastSuperAdmin(list: Admin[], admin: Admin) {
  return admin.roles.includes('super_admin') && admin.status === 'active'
    && !list.some(x => x.id !== admin.id && x.roles.includes('super_admin') && x.status === 'active')
}
