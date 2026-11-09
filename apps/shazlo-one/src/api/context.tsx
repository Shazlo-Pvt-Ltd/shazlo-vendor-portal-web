import { QueryClient } from '@tanstack/react-query'
import { createContext, useContext, type ReactNode } from 'react'
import { ApiError, createApi, type Api } from './http'
import type { paths as IdentityPaths } from './identity'
import type { paths as VendorPaths } from './vendor-admin'

// The shell's session: identity-api access token in memory only (ADR 0001/0009), refreshed through the
// HttpOnly identity_refresh cookie, plus short-lived module tokens from the token exchange.
export interface SessionState {
  status: 'checking' | 'signed_out' | 'signed_in'
  admin: { id: string; email: string; display_name: string; roles: string[]; must_change_password: boolean } | null
  reason?: 'expired' | 'signed_out'
}

type Listener = () => void
type Session = { access_token: string; expires_in: number; admin: NonNullable<SessionState['admin']> }

export class SessionStore {
  private state: SessionState = { status: 'checking', admin: null }
  private token: string | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private listeners = new Set<Listener>()
  private moduleTokens = new Map<string, { token: string; expiresAt: number }>()
  identity!: Api<IdentityPaths>

  get = () => this.state
  accessToken = () => this.token
  subscribe = (l: Listener) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  private set(state: SessionState) {
    this.state = state
    this.listeners.forEach((l) => l())
  }

  // Refresh at 80% of the token's life (ADR 0001 §3.5).
  adopt(session: Session) {
    this.token = session.access_token
    this.moduleTokens.clear()
    this.set({ status: 'signed_in', admin: session.admin })
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.refresh(), Math.max(5_000, session.expires_in * 800))
  }

  async refresh(): Promise<boolean> {
    try {
      const session = await this.identity.call((c) => c.POST('/v1/auth/refresh'))
      this.adopt(session)
      return true
    } catch (error) {
      if (error instanceof ApiError && error.status === 0) return false
      this.end(this.state.status === 'signed_in' ? 'expired' : undefined)
      return false
    }
  }

  end(reason?: SessionState['reason']) {
    this.token = null
    this.moduleTokens.clear()
    if (this.timer) clearTimeout(this.timer)
    this.set({ status: 'signed_out', admin: null, reason })
  }

  // A 5-minute token for one module's backend, reused until 80% of its life has passed.
  async moduleToken(audience: string, force = false): Promise<{ token: string; expiresAt: number }> {
    const cached = this.moduleTokens.get(audience)
    const now = Date.now() / 1000
    if (!force && cached && cached.expiresAt - now > 60) return cached
    const res = await this.identity.call((c) => c.POST('/v1/auth/token', { body: { audience } }))
    const fresh = { token: res.access_token, expiresAt: Math.floor(now + res.expires_in) }
    this.moduleTokens.set(audience, fresh)
    return fresh
  }
}

export interface AppContext {
  session: SessionStore
  identity: Api<IdentityPaths>
  vendorApi: Api<VendorPaths>
  queryClient: QueryClient
}

export function createAppContext({ identityUrl, vendorApiUrl }: { identityUrl: string; vendorApiUrl: string }): AppContext {
  const session = new SessionStore()
  const identity = createApi<IdentityPaths>({ baseUrl: identityUrl, getToken: session.accessToken, renew: () => session.refresh(), withCookies: true })
  session.identity = identity
  let vendorToken: string | null = null
  const vendorApi = createApi<VendorPaths>({
    baseUrl: vendorApiUrl,
    getToken: () => vendorToken,
    renew: async () => {
      vendorToken = null
      return Boolean(await ensureVendorToken())
    },
  })
  async function ensureVendorToken() {
    vendorToken = (await session.moduleToken('vendor-api')).token
    return vendorToken
  }
  // Every vendor-api call first makes sure a module token is in hand.
  const call = vendorApi.call
  vendorApi.call = (async (fn: Parameters<typeof call>[0]) => {
    await ensureVendorToken()
    return call(fn)
  }) as typeof call
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 20_000, refetchOnWindowFocus: false, retry: (n, e) => n < 2 && e instanceof ApiError && (e.status === 0 || e.status >= 500) },
      mutations: { retry: false },
    },
  })
  session.subscribe(() => {
    if (session.get().status === 'signed_out') queryClient.clear()
  })
  return { session, identity, vendorApi, queryClient }
}

export function apiUrls() {
  const origin = typeof window !== 'undefined' && window.location.origin !== 'null' ? window.location.origin : 'http://localhost'
  return {
    identityUrl: ((import.meta.env.VITE_IDENTITY_API_URL as string | undefined) ?? origin).replace(/\/+$/, ''),
    vendorApiUrl: ((import.meta.env.VITE_VENDOR_API_URL as string | undefined) ?? 'http://localhost:5194').replace(/\/+$/, ''),
  }
}

const Context = createContext<AppContext | null>(null)
export const AppContextProvider = ({ value, children }: { value: AppContext; children: ReactNode }) => <Context.Provider value={value}>{children}</Context.Provider>
export function useAppContext() {
  const value = useContext(Context)
  if (!value) throw new Error('useAppContext needs an AppContextProvider')
  return value
}
