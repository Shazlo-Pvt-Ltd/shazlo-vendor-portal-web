import { ApiError } from '../api/http'
import type { components } from '../api/identity'
import { clearSensitiveState } from '../security/sensitiveState'

type SessionResponse = components['schemas']['SessionResponse']
type TokenResponse = components['schemas']['TokenResponse']
export type Admin = components['schemas']['AdminProfile']

/**
 * What the session is doing. `unavailable`: identity-api could not be reached while the page loaded,
 * which is not the same as signed out (the refresh cookie may still be good).
 */
export interface SessionState {
  status: 'checking' | 'signed_out' | 'signed_in' | 'unavailable'
  admin: Admin | null
  /** Why a session ended: on its own (`expired`), or the admin signed out, here or in another tab. */
  reason?: 'expired' | 'signed_out'
}

/** A token for one module's backend, from `POST /v1/auth/token`. */
export interface ModuleToken {
  accessToken: string
  audience: string
  /** Epoch milliseconds when it was issued: with `expiresAt` it gives the token's own life. */
  issuedAt: number
  /** Epoch milliseconds. Never later than the identity token it was exchanged with. */
  expiresAt: number
}

/** `403 audience_not_allowed`: none of the admin's roles may use that module. */
export class AudienceNotAllowedError extends Error {
  constructor(readonly audience: string) {
    super('Your account is not allowed to open this module.')
    this.name = 'AudienceNotAllowedError'
  }
}

/** `400 unknown_audience`: identity-api does not know the module's backend. */
export class UnknownAudienceError extends Error {
  constructor(readonly audience: string) {
    super('This module is not known to the server.')
    this.name = 'UnknownAudienceError'
  }
}

/** A module token was asked for with no signed-in session (or a password-change one), or it ended meanwhile. */
export class NotSignedInError extends Error {
  constructor() {
    super('There is no signed-in session.')
    this.name = 'NotSignedInError'
  }
}

type TabChannel = Pick<BroadcastChannel, 'postMessage' | 'close'> & { onmessage: ((event: MessageEvent) => void) | null }

export interface SessionDeps {
  /** `POST /v1/auth/refresh`, without the client's own 401 renewal. Throws `ApiError`. */
  refresh: () => Promise<unknown>
  /** `POST /v1/auth/token` with this identity token. */
  exchange: (audience: string, accessToken: string) => Promise<unknown>
  /** `POST /v1/auth/logout`. A failure is ignored: the local session ends either way. */
  logout: () => Promise<unknown>
  /** Called when the session ends or passes to another admin: drop every cached answer of the last one. */
  onCleared: () => void
  /** The other tabs of this browser; a `BroadcastChannel` by default, `null` for none. */
  channel?: TabChannel | null
  /** Fraction of `expires_in` after which the identity token is renewed. */
  renewAt?: number
  /** How long to wait before retrying a `409 refresh_conflict`, in milliseconds. */
  conflictWaitMs?: number
  /** How long to wait before trying again when identity-api could not be reached, in seconds. */
  retryAfterOutageS?: number
}

export const SESSION_CHANNEL = 'shazlo-one-session'

/** A module token this close to its end is replaced rather than handed out. */
const MODULE_TOKEN_SKEW_MS = 10_000
/** identity-api's default exchanged-token life (300 s), until the first exchange says otherwise. */
const DEFAULT_MODULE_TOKEN_TTL_MS = 300_000
/** Between a module's id and an audience in a cache key; module ids cannot contain it. */
const SCOPE_SEPARATOR = '|'
/**
 * The longest token life accepted, in seconds (identity-api allows at most an hour). A longer one would
 * overflow `setTimeout`, which then fires at once and renews in a loop.
 */
export const MAX_TOKEN_LIFE_S = 24 * 60 * 60

const isLifetime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_TOKEN_LIFE_S

export function isAdminProfile(value: unknown): value is Admin {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Partial<Admin>
  return (
    typeof v.id === 'string' &&
    v.id !== '' &&
    typeof v.email === 'string' &&
    typeof v.display_name === 'string' &&
    Array.isArray(v.roles) &&
    v.roles.every((role) => typeof role === 'string') &&
    typeof v.must_change_password === 'boolean'
  )
}

/** A session answer (login, refresh, change-password), checked rather than trusted. */
export function isSessionResponse(value: unknown): value is SessionResponse {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Partial<SessionResponse>
  return typeof v.access_token === 'string' && v.access_token !== '' && isLifetime(v.expires_in) && typeof v.must_change_password === 'boolean' && isAdminProfile(v.admin)
}

/** A token-exchange answer, checked rather than trusted. */
export function isTokenResponse(value: unknown): value is TokenResponse {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Partial<TokenResponse>
  return typeof v.access_token === 'string' && v.access_token !== '' && isLifetime(v.expires_in)
}

const badAnswer = () => new ApiError(502, 'bad_session_response', 'The server sent an answer Shazlo One cannot read. Try again in a moment.')

/** identity-api could not be reached or is failing (offline, 408, 429, 5xx, or a 409 that persisted): the cookie may still be good. */
function isOutage(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 0 || error.status === 408 || error.status === 409 || error.status === 429 || error.status >= 500)
}

const sameRoles = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((role, i) => role === b[i])

/**
 * The admin's session (ADR 0009): a 15-minute identity-api access token kept in memory only, and the
 * HttpOnly refresh cookie the browser holds. Nothing here touches web storage, and only the words
 * `login` and `logout` travel between tabs, never a token. The shell is the only holder of the session:
 * each module gets a short token of its own from {@link SessionStore.getModuleToken}.
 */
export class SessionStore {
  private state: SessionState = { status: 'checking', admin: null }
  private token: string | null = null
  private tokenExpiresAt = 0
  private identityLifetimeMs = 0
  private moduleTtlMs = DEFAULT_MODULE_TOKEN_TTL_MS
  private listeners = new Set<() => void>()
  private renewTimer: ReturnType<typeof setTimeout> | undefined
  private inFlight: { promise: Promise<boolean>; endings: number } | undefined
  private started: Promise<void> | undefined
  private closed = false
  /** Bumped whenever a session ends or passes to another admin, so a module-token exchange that answers later knows it is stale. */
  private generation = 0
  /** Bumped only when a session ends (sign-out here or in another tab, a refused refresh): a renewal under way must not sign the tab back in. */
  private endings = 0
  private moduleTokens = new Map<string, ModuleToken>()
  private moduleRequests = new Map<string, Promise<ModuleToken>>()
  /** Bumped when a module's tokens are dropped, so an exchange that started before does not keep its token. */
  private scopeEpochs = new Map<string, number>()
  private channel: TabChannel | null | undefined

  constructor(private readonly deps: SessionDeps) {
    this.open()
  }

  private open(): void {
    this.closed = false
    if (this.channel) return
    this.channel = this.deps.channel === undefined ? (typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(SESSION_CHANNEL)) : this.deps.channel
    if (this.channel) this.channel.onmessage = (event) => this.onTabMessage(event.data)
  }

  // --- reading ---------------------------------------------------------------------------------

  get = (): SessionState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  accessToken = (): string | null => this.token

  // --- starting and ending ---------------------------------------------------------------------

  /** Restores the session from the refresh cookie after a page load. Calling it again returns the same attempt. */
  start(): Promise<void> {
    this.open()
    this.started ??= this.renew().then(() => undefined)
    return this.started
  }

  /** Tries again after `unavailable`. */
  retry(): Promise<void> {
    this.open()
    this.set({ status: 'checking', admin: null })
    this.started = this.renew().then(() => undefined)
    return this.started
  }

  /** Takes the session a sign-in or change-password call returned, and tells the other tabs. */
  signIn(session: unknown): void {
    if (!isSessionResponse(session)) throw badAnswer()
    this.adopt(session)
    this.channel?.postMessage({ type: 'login' })
  }

  /** The admin's own sign-out: every tab of this browser ends its session too. */
  async logout(): Promise<void> {
    try {
      await this.deps.logout()
    } catch {
      // The cookie may already be gone or the network down; the local session ends regardless.
    }
    this.end('signed_out')
    this.channel?.postMessage({ type: 'logout' })
  }

  /**
   * Ends the session because it could not be kept alive (a module's token ran out while identity-api
   * could not be reached): the sign-in screen says so and sends the admin back to where they were. It
   * does not call the server (which may be what is down) and does not tell the other tabs.
   */
  expire(): void {
    if (this.state.status === 'signed_in') this.end('expired')
  }

  /** Stops timers and listeners, for unmounting. */
  close(): void {
    this.closed = true
    this.clearToken()
    if (this.channel) {
      this.channel.onmessage = null
      this.channel.close()
      this.channel = undefined
    }
  }

  // --- renewal ---------------------------------------------------------------------------------

  /**
   * Gets a new identity token. Every caller while one is under way shares its answer (ten requests that
   * find the token expired cause one refresh). Resolves true when there is a session.
   */
  renew = (): Promise<boolean> => {
    if (this.inFlight && this.inFlight.endings === this.endings) return this.inFlight.promise
    // One that started before the session ended will throw its answer away (another tab may sign in
    // right after signing out): queue a fresh one behind it, so two refreshes never race for the cookie.
    const before = this.inFlight?.promise
    const promise: Promise<boolean> = (before ? before.then(() => this.doRenew()) : this.doRenew()).finally(() => {
      if (this.inFlight?.promise === promise) this.inFlight = undefined
    })
    this.inFlight = { promise, endings: this.endings }
    return promise
  }

  private async doRenew(): Promise<boolean> {
    const endings = this.endings
    const stale = () => this.closed || endings !== this.endings
    try {
      const session = await this.refreshWithConflictRetry()
      // Signed out (here or in another tab) while the refresh ran: its answer belongs to nobody.
      if (stale()) return false
      this.adopt(session)
      return true
    } catch (error) {
      if (stale()) return false
      if (isOutage(error)) {
        // identity-api is down, slow or busy: a signed-in session stays and is tried again soon.
        if (this.state.status === 'signed_in') this.scheduleRenewal(this.deps.retryAfterOutageS ?? 15)
        else if (this.state.status === 'checking') this.set({ status: 'unavailable', admin: null })
      } else if (this.state.status !== 'signed_out') {
        // Refused (401, or any other answer that says the cookie is no good): the session is over.
        this.end(this.state.status === 'signed_in' ? 'expired' : undefined)
      }
      return false
    }
  }

  /** `409 refresh_conflict`: another tab used the cookie a moment ago, and the browser now holds its new one. Tried once more. */
  private async refreshWithConflictRetry(): Promise<SessionResponse> {
    const checked = async () => {
      const session = await this.deps.refresh()
      if (!isSessionResponse(session)) throw badAnswer()
      return session
    }
    try {
      return await checked()
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'refresh_conflict') throw error
      await new Promise((resolve) => setTimeout(resolve, this.deps.conflictWaitMs ?? 400))
      return await checked()
    }
  }

  private adopt(session: SessionResponse): void {
    const profile = session.admin
    const previous = this.state.admin
    if (previous !== null && previous.id !== profile.id) {
      // The cookie now belongs to another admin (another tab signed out and in, and this one missed it):
      // nothing of the previous admin may carry over.
      this.forgetModuleTokens()
      clearSensitiveState()
      this.deps.onCleared()
    } else if (session.must_change_password) {
      // A password-change token gets no module tokens at all.
      this.forgetModuleTokens()
    } else if (previous !== null && !sameRoles(previous.roles, profile.roles)) {
      // New roles: the module tokens were issued for the old ones, and cached answers were read with them.
      this.forgetModuleTokens()
      this.deps.onCleared()
    }
    this.token = session.access_token
    this.tokenExpiresAt = Date.now() + session.expires_in * 1000
    this.identityLifetimeMs = session.expires_in * 1000
    this.set({ status: 'signed_in', admin: { ...profile, must_change_password: session.must_change_password } })
    this.scheduleRenewal(session.expires_in * (this.deps.renewAt ?? 0.8))
  }

  private scheduleRenewal(seconds: number): void {
    clearTimeout(this.renewTimer)
    if (this.closed) return
    this.renewTimer = setTimeout(() => void this.renew(), Math.max(1, seconds) * 1000)
  }

  private end(reason?: SessionState['reason']): void {
    this.endings += 1
    this.clearToken()
    // Typed passwords and temporary passwords never outlive the session, expired or not.
    clearSensitiveState()
    this.set({ status: 'signed_out', admin: null, reason })
    this.deps.onCleared()
  }

  private clearToken(): void {
    this.token = null
    this.tokenExpiresAt = 0
    this.forgetModuleTokens()
    clearTimeout(this.renewTimer)
  }

  /** Drops every module token, and makes an exchange under way throw its answer away. */
  private forgetModuleTokens(): void {
    this.generation += 1
    this.moduleTokens.clear()
    this.moduleRequests.clear()
  }

  // --- module tokens ---------------------------------------------------------------------------

  /**
   * A token for one module's backend (`POST /v1/auth/token`), kept until it nears its end. Callers asking
   * at the same time share one exchange. `scope` says whose token it is (the module's id): tokens are
   * kept per scope, never shared, so two modules on one backend each get their own and
   * {@link dropModuleTokens} can drop one module's when its page is left. With `fresh` a new token is
   * asked for even while a kept one is good (a refresh).
   *
   * Throws {@link AudienceNotAllowedError}, {@link UnknownAudienceError} or {@link NotSignedInError};
   * other failures are the API client's `ApiError`.
   */
  getModuleToken(audience: string, scope: string = audience, options: { fresh?: boolean } = {}): Promise<ModuleToken> {
    if (!this.canExchange()) return Promise.reject(new NotSignedInError())
    const key = `${scope}${SCOPE_SEPARATOR}${audience}`
    const cached = this.moduleTokens.get(key)
    if (!options.fresh && cached && cached.expiresAt - Date.now() > MODULE_TOKEN_SKEW_MS) return Promise.resolve(cached)
    let pending = this.moduleRequests.get(key)
    if (!pending) {
      const request: Promise<ModuleToken> = this.exchangeFor(audience, scope, key).finally(() => {
        if (this.moduleRequests.get(key) === request) this.moduleRequests.delete(key)
      })
      pending = request
      this.moduleRequests.set(key, pending)
    }
    return pending
  }

  /** Forgets every token kept for one module (its page was left, or it is being reloaded). */
  dropModuleTokens(scope: string): void {
    const prefix = `${scope}${SCOPE_SEPARATOR}`
    for (const key of [...this.moduleTokens.keys()]) if (key.startsWith(prefix)) this.moduleTokens.delete(key)
    for (const key of [...this.moduleRequests.keys()]) if (key.startsWith(prefix)) this.moduleRequests.delete(key)
    this.scopeEpochs.set(scope, (this.scopeEpochs.get(scope) ?? 0) + 1)
  }

  /** Only a signed-in admin who has changed any temporary password has roles to exchange. */
  private canExchange(): boolean {
    return this.state.status === 'signed_in' && this.state.admin !== null && !this.state.admin.must_change_password
  }

  private async exchangeFor(audience: string, scope: string, key: string): Promise<ModuleToken> {
    const epoch = this.scopeEpochs.get(scope) ?? 0
    const generation = this.generation
    const remaining = this.tokenExpiresAt - Date.now()
    if (remaining <= MODULE_TOKEN_SKEW_MS) {
      // Too old to ask with at all.
      if (!(await this.renew())) throw new NotSignedInError()
    } else if (remaining < this.moduleTtlMs && this.identityLifetimeMs > this.moduleTtlMs) {
      // It would end before the module token should: renew first so the module token gets its whole life.
      await this.renew()
    }
    if (!this.canExchange()) throw new NotSignedInError()
    let from = { token: this.token, expiresAt: this.tokenExpiresAt }
    let answer: TokenResponse
    try {
      answer = await this.exchangeOnce(audience, from.token)
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw typed(error, audience)
      // The identity token was refused (revoked, or ran out): renew once and try again.
      if (!(await this.renew()) || !this.canExchange()) throw new NotSignedInError()
      from = { token: this.token, expiresAt: this.tokenExpiresAt }
      try {
        answer = await this.exchangeOnce(audience, from.token)
      } catch (retryError) {
        throw typed(retryError, audience)
      }
    }
    // The session ended, or passed to another admin or other roles, while the exchange ran.
    if (generation !== this.generation) throw new NotSignedInError()
    const issuedAt = Date.now()
    this.moduleTtlMs = answer.expires_in * 1000
    const token: ModuleToken = { accessToken: answer.access_token, audience, issuedAt, expiresAt: Math.min(issuedAt + answer.expires_in * 1000, from.expiresAt) }
    // Not kept if the module's page was left while the exchange ran.
    if ((this.scopeEpochs.get(scope) ?? 0) === epoch) this.moduleTokens.set(key, token)
    return token
  }

  private async exchangeOnce(audience: string, token: string | null): Promise<TokenResponse> {
    if (token === null) throw new NotSignedInError()
    const answer = await this.deps.exchange(audience, token)
    if (!isTokenResponse(answer)) throw badAnswer()
    return answer
  }

  // --- other tabs ------------------------------------------------------------------------------

  private onTabMessage(message: unknown): void {
    const type = typeof message === 'object' && message !== null ? (message as { type?: unknown }).type : undefined
    if (type === 'logout' && this.state.status !== 'signed_out') this.end('signed_out')
    // A sign-in elsewhere: restore a signed-out tab, or move one held at the password change along.
    else if (type === 'login' && (this.state.status !== 'signed_in' || this.state.admin?.must_change_password)) void this.renew()
  }

  private set(next: SessionState): void {
    this.state = next
    for (const listener of this.listeners) listener()
  }
}

function typed(error: unknown, audience: string): unknown {
  if (error instanceof ApiError && error.status === 403 && error.code === 'audience_not_allowed') return new AudienceNotAllowedError(audience)
  if (error instanceof ApiError && error.status === 400 && error.code === 'unknown_audience') return new UnknownAudienceError(audience)
  return error
}
