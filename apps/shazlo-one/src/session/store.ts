import { ApiError, NetworkError } from '../api/errors'
import type { components } from '../api/schema'
import { clearSensitiveState } from '../security/sensitiveState'

type SessionResponse = components['schemas']['SessionResponse']
type AdminProfile = components['schemas']['AdminProfile']
type TokenResponse = components['schemas']['TokenResponse']

export type { AdminProfile }

/**
 * What the session is doing. `unavailable` means the server could not be reached, not "signed out".
 * `passwordChangeRequired` is a signed-in admin whose token has no roles: the only place it may go
 * is the change-password screen.
 */
export type SessionStatus = 'loading' | 'signedIn' | 'passwordChangeRequired' | 'signedOut' | 'unavailable'

export interface SessionState {
  status: SessionStatus
  /** From `GET /v1/me` (or the sign-in answer); null unless signed in. */
  admin: AdminProfile | null
  /** The admin's roles. Always empty while `passwordChangeRequired`. */
  roles: readonly string[]
  /** True when a signed-in session ended on its own (refresh failed), not by the admin's choice. */
  expired: boolean
  /** True when the admin signed out (in this tab or another): do not send them "back" after login. */
  signedOutByUser: boolean
}

/** A token for one module's backend, from `POST /v1/auth/token`. */
export interface ModuleToken {
  accessToken: string
  audience: string
  /** Epoch milliseconds when the token was issued: with `expiresAt` it gives the token's own life. */
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

/** `400 unknown_audience`: the shell asked for a module identity-api does not know. */
export class UnknownAudienceError extends Error {
  constructor(readonly audience: string) {
    super('This module is not known to the server.')
    this.name = 'UnknownAudienceError'
  }
}

/** A module token was asked for with no signed-in session, or the session ended meanwhile. */
export class NotSignedInError extends Error {
  constructor() {
    super('There is no signed-in session.')
    this.name = 'NotSignedInError'
  }
}

export interface SessionDeps {
  /** `POST /v1/auth/refresh`: the new session. Throws `ApiError` or `NetworkError`. */
  refresh: () => Promise<SessionResponse>
  /** `GET /v1/me` with this token (the token is passed in: the store has not adopted it yet). */
  fetchMe: (accessToken: string) => Promise<AdminProfile>
  /** `POST /v1/auth/token` with this identity token. */
  exchange: (audience: string, accessToken: string) => Promise<TokenResponse>
  /** `POST /v1/auth/logout`. Failure is ignored: the local session ends either way. */
  logout: () => Promise<void>
  /** Called when the session ends, to drop every cached answer of the previous admin. */
  onCleared: () => void
  /** Tabs of the same browser; defaults to a `BroadcastChannel` when there is one. */
  channel?: Pick<BroadcastChannel, 'postMessage' | 'close'> & {
    onmessage: ((event: MessageEvent) => void) | null
  }
  /** Fraction of `expires_in` after which the token is renewed. */
  renewAt?: number
  /** How long to wait before retrying a `409 refresh_conflict`, in milliseconds. */
  conflictWaitMs?: number
}

const SIGNED_OUT: SessionState = {
  status: 'signedOut',
  admin: null,
  roles: [],
  expired: false,
  signedOutByUser: false,
}
const LOADING: SessionState = { ...SIGNED_OUT, status: 'loading' }

export const SESSION_CHANNEL = 'shazlo-one-session'

/** A module token this close to its end is replaced rather than handed out. */
const MODULE_TOKEN_SKEW_MS = 10_000

/**
 * Longest token life accepted, in seconds (identity-api allows at most an hour). A longer one would
 * overflow `setTimeout`, which then fires at once and refreshes in a loop.
 */
const MAX_TOKEN_LIFE_S = 24 * 60 * 60

function isLifetime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_TOKEN_LIFE_S
}

/**
 * How long identity-api's exchanged tokens last by default (`EXCHANGED_TOKEN_TTL_SECONDS`, 300). Used
 * until the first exchange says otherwise, to renew the identity token before a module token would
 * outlive it.
 */
const DEFAULT_MODULE_TOKEN_TTL_MS = 300_000

/** Between a module's id and an audience in a cache key; module ids cannot contain it. */
const SCOPE_SEPARATOR = '|'

/** The session body, checked: do not trust the answer blindly. */
export function isSessionResponse(value: unknown): value is SessionResponse {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Partial<SessionResponse>
  return (
    typeof v.access_token === 'string' &&
    v.access_token !== '' &&
    isLifetime(v.expires_in) &&
    typeof v.must_change_password === 'boolean' &&
    isAdminProfile(v.admin)
  )
}

/** The `POST /v1/auth/token` body, checked. */
export function isTokenResponse(value: unknown): value is TokenResponse {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Partial<TokenResponse>
  return typeof v.access_token === 'string' && v.access_token !== '' && isLifetime(v.expires_in)
}

export function isAdminProfile(value: unknown): value is AdminProfile {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Partial<AdminProfile>
  return (
    typeof v.id === 'string' &&
    typeof v.email === 'string' &&
    typeof v.display_name === 'string' &&
    Array.isArray(v.roles) &&
    v.roles.every((role) => typeof role === 'string') &&
    typeof v.must_change_password === 'boolean'
  )
}

/**
 * The admin's session (ADR 0009): a 15-minute access token kept in memory only, and a refresh
 * cookie the browser holds. Nothing here touches web storage. Only the words `login` and `logout`
 * travel between tabs, never a token. The shell is the only holder of the session: modules get a
 * short token of their own from {@link SessionStore.getModuleToken}.
 */
export class SessionStore {
  private state: SessionState = LOADING
  private token: string | null = null
  private tokenExpiresAt = 0
  /** How long the identity token we hold was given to last (milliseconds). */
  private identityLifetimeMs = 0
  /** How long the last exchanged token was given to last, to know when the identity token is too old to ask with. */
  private moduleTtlMs = DEFAULT_MODULE_TOKEN_TTL_MS
  private listeners = new Set<() => void>()
  private renewTimer: ReturnType<typeof setTimeout> | undefined
  private inFlight: { promise: Promise<boolean>; endings: number } | undefined
  private started: Promise<void> | undefined
  private closed = true
  /**
   * Bumped whenever a session ends or passes to another admin (or to a password-change token), so
   * a module-token exchange that answers later knows it is stale.
   */
  private generation = 0
  /**
   * Bumped only when a session ends (sign-out here or in another tab, a refused refresh), not on
   * {@link close}: a renewal under way at that moment must not sign the tab back in.
   */
  private endings = 0
  private moduleTokens = new Map<string, ModuleToken>()
  private moduleRequests = new Map<string, Promise<ModuleToken>>()
  /** Bumped when a module's tokens are dropped, so an exchange that started before knows not to keep its token. */
  private scopeEpochs = new Map<string, number>()

  private channel: SessionDeps['channel'] | undefined

  constructor(private readonly deps: SessionDeps) {}

  /** Starts listening to the other tabs. Safe to call again after {@link close} (StrictMode does). */
  private open(): void {
    this.closed = false
    if (this.channel) return
    const channel =
      this.deps.channel ?? (typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel(SESSION_CHANNEL))
    if (channel) {
      this.channel = channel
      channel.onmessage = (event) => this.onTabMessage(event.data)
    }
  }

  // --- reading ---------------------------------------------------------------------------------

  getSnapshot = (): SessionState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getAccessToken = (): string | null => this.token

  // --- starting and ending ---------------------------------------------------------------------

  /** Restores the session after a page load. Calling it again returns the same attempt. */
  start(): Promise<void> {
    this.open()
    this.started ??= this.restore()
    return this.started
  }

  private async restore(): Promise<void> {
    await this.renew()
  }

  /** Retry after `unavailable`. */
  retry(): Promise<void> {
    this.open()
    this.set({ ...LOADING })
    this.started = this.restore()
    return this.started
  }

  /** Takes the session a login or change-password call returned. */
  signIn(session: SessionResponse): void {
    this.adopt(session, session.admin)
    this.channel?.postMessage({ type: 'login' })
  }

  /** The admin's own sign-out. */
  async logout(): Promise<void> {
    try {
      await this.deps.logout()
    } catch {
      // The cookie may already be gone or the network down; the local session ends regardless.
    }
    this.end({ expired: false, byUser: true })
    this.channel?.postMessage({ type: 'logout' })
  }

  /**
   * Ends the session because it could not be kept alive (for example a module's token ran out while the
   * server could not be reached): flagged as expired, so the login screen says so and sends the admin
   * back to where they were. Unlike {@link SessionStore.logout} it does not call the server (which may
   * be what is down) and does not tell the other tabs; each finds out for itself.
   */
  expire(): void {
    if (!this.hasSession()) return
    this.end({ expired: true })
  }

  /** Stops timers and listeners; for unmounting. */
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
   * Gets a new access token. Every caller while one is under way gets that one's answer (ten
   * requests that find the token expired cause one refresh). Resolves true when there is a session.
   */
  renew = (): Promise<boolean> => {
    if (this.inFlight && this.inFlight.endings === this.endings) return this.inFlight.promise
    // One started before the session ended throws its answer away (another tab may sign in right
    // after signing out): queue a fresh one behind it, so two refreshes never race for the cookie.
    const before = this.inFlight?.promise
    const promise: Promise<boolean> = (before ? before.then(() => this.doRenew()) : this.doRenew()).finally(() => {
      if (this.inFlight?.promise === promise) this.inFlight = undefined
    })
    this.inFlight = { promise, endings: this.endings }
    return promise
  }

  private async doRenew(): Promise<boolean> {
    const hadSession = this.hasSession()
    const endings = this.endings
    const stale = () => this.closed || endings !== this.endings
    try {
      const session = await this.refreshWithConflictRetry()
      if (stale()) return false
      // An admin who must change their password has a token with no roles, which `/v1/me` refuses:
      // the answer to refresh already says who they are.
      const profile = session.must_change_password ? session.admin : await this.deps.fetchMe(session.access_token)
      if (stale()) return false
      this.adopt(session, profile)
      return true
    } catch (error) {
      if (stale()) return false
      if (error instanceof ApiError && error.status === 401) {
        // Already signed out (a stray 401 after sign-out): keep why the session ended.
        if (this.state.status !== 'signedOut') this.end({ expired: hadSession })
      } else if (error instanceof NetworkError || error instanceof ApiError) {
        // The server is unreachable or failing: the session may still be good, so do not sign out.
        if (this.state.status === 'loading') this.set({ ...this.state, status: 'unavailable' })
        else this.scheduleRenewal(15)
      } else {
        this.end({ expired: hadSession })
      }
      return false
    }
  }

  /** `409 refresh_conflict`: another tab used the token a moment ago; its new cookie works. */
  private async refreshWithConflictRetry(): Promise<SessionResponse> {
    const checked = async () => {
      const session = await this.deps.refresh()
      if (!isSessionResponse(session)) {
        throw new ApiError({ status: 502, code: 'bad_session_response', message: 'The server sent an unexpected answer.' })
      }
      return session
    }
    try {
      return await checked()
    } catch (error) {
      if (error instanceof ApiError && error.code === 'refresh_conflict') {
        await new Promise((resolve) => setTimeout(resolve, this.deps.conflictWaitMs ?? 400))
        return await checked()
      }
      throw error
    }
  }

  private adopt(session: SessionResponse, profile: AdminProfile): void {
    const mustChange = session.must_change_password
    const roles = mustChange ? [] : [...profile.roles]
    const previous = this.state.admin
    if (previous !== null && previous.id !== profile.id) {
      // The cookie now belongs to another admin (another tab signed out and in while this one
      // missed the messages): nothing of the previous admin may carry over.
      this.forgetModuleTokens()
      clearSensitiveState()
      this.deps.onCleared()
    } else if (mustChange) {
      // A password-change token gets no module tokens at all.
      this.forgetModuleTokens()
    } else if (roles.length !== this.state.roles.length || roles.some((role, i) => role !== this.state.roles[i])) {
      // The cached module tokens were issued for the old roles.
      this.moduleTokens.clear()
    }
    this.token = session.access_token
    this.tokenExpiresAt = Date.now() + session.expires_in * 1000
    this.identityLifetimeMs = session.expires_in * 1000
    this.set({
      status: mustChange ? 'passwordChangeRequired' : 'signedIn',
      admin: profile,
      // No roles until the password is changed, whatever the profile says.
      roles,
      expired: false,
      signedOutByUser: false,
    })
    this.scheduleRenewal(session.expires_in * (this.deps.renewAt ?? 0.8))
  }

  private scheduleRenewal(seconds: number): void {
    clearTimeout(this.renewTimer)
    if (this.closed) return
    this.renewTimer = setTimeout(() => void this.renew(), Math.max(1, seconds) * 1000)
  }

  private hasSession(): boolean {
    return this.state.status === 'signedIn' || this.state.status === 'passwordChangeRequired'
  }

  private end(options: { expired: boolean; byUser?: boolean }): void {
    this.endings += 1
    this.clearToken()
    // Typed passwords and half-filled sensitive forms never survive the session, expired or not.
    clearSensitiveState()
    this.set({ ...SIGNED_OUT, expired: options.expired, signedOutByUser: options.byUser === true })
    this.deps.onCleared()
  }

  private clearToken(): void {
    this.token = null
    this.tokenExpiresAt = 0
    this.forgetModuleTokens()
    clearTimeout(this.renewTimer)
  }

  /** Drops every module token, and makes an exchange under way throw away its answer. */
  private forgetModuleTokens(): void {
    this.generation += 1
    this.moduleTokens.clear()
    this.moduleRequests.clear()
  }

  // --- module tokens ---------------------------------------------------------------------------

  /**
   * A token for one module's backend (`POST /v1/auth/token`), kept only until it nears its end or
   * the identity token it came from would have ended, whichever is first. Callers asking at the same
   * time share one exchange. Throws {@link AudienceNotAllowedError}, {@link UnknownAudienceError} or
   * {@link NotSignedInError}; other failures are the API client's own errors.
   *
   * `scope` says whose token it is: the module's id. A token is kept per scope, never shared, so two
   * modules that use the same audience (`vendor-api`) each get a token of their own, and
   * {@link SessionStore.dropModuleTokens} can drop one module's tokens when its page is left. It
   * defaults to the audience, for callers that have no module. With `fresh` a new token is asked for even
   * when a good one is kept (a refresh; it replaces the kept one).
   *
   * When the identity token would end before a new module token would (a module token lasts 5 minutes,
   * an identity token 15), the identity token is renewed first, so the module token is not cut short.
   */
  getModuleToken(audience: string, scope: string = audience, options: { fresh?: boolean } = {}): Promise<ModuleToken> {
    // Only a signed-in admin has roles to exchange; a password-change token gets nothing.
    if (this.state.status !== 'signedIn') return Promise.reject(new NotSignedInError())
    const key = this.moduleKey(scope, audience)
    const cached = this.moduleTokens.get(key)
    // `fresh` skips the cache: the refresh asks for a new token while the old one is still good.
    if (!options.fresh && cached && cached.expiresAt - Date.now() > MODULE_TOKEN_SKEW_MS) return Promise.resolve(cached)
    let pending = this.moduleRequests.get(key)
    if (!pending) {
      const request: Promise<ModuleToken> = this.exchangeFor(audience, scope).finally(() => {
        // Only the entry this call made: a drop or a session that ended may have replaced it.
        if (this.moduleRequests.get(key) === request) this.moduleRequests.delete(key)
      })
      pending = request
      this.moduleRequests.set(key, pending)
    }
    return pending
  }

  /**
   * Forgets every token kept for a module (its page was left). An exchange still under way for it
   * finishes, but its token is handed only to the caller that asked, never kept.
   */
  dropModuleTokens(scope: string): void {
    const prefix = `${scope}${SCOPE_SEPARATOR}`
    for (const key of [...this.moduleTokens.keys()]) if (key.startsWith(prefix)) this.moduleTokens.delete(key)
    for (const key of [...this.moduleRequests.keys()]) if (key.startsWith(prefix)) this.moduleRequests.delete(key)
    this.scopeEpochs.set(scope, (this.scopeEpochs.get(scope) ?? 0) + 1)
  }

  private moduleKey(scope: string, audience: string): string {
    return `${scope}${SCOPE_SEPARATOR}${audience}`
  }

  private async exchangeFor(audience: string, scope: string): Promise<ModuleToken> {
    const epoch = this.scopeEpochs.get(scope) ?? 0
    // Only a signed-in admin has roles to exchange; a password-change token gets nothing.
    if (this.state.status !== 'signedIn') throw new NotSignedInError()
    const generation = this.generation
    const remaining = this.tokenExpiresAt - Date.now()
    if (remaining <= MODULE_TOKEN_SKEW_MS) {
      // Too old to ask with at all.
      if (!(await this.renew())) throw new NotSignedInError()
    } else if (remaining < this.moduleTtlMs && this.identityLifetimeMs > this.moduleTtlMs) {
      // It would end before the new module token should: renew it first so the module token gets its
      // whole life. If renewal cannot be done now, the exchange goes ahead with what we hold (the module
      // token is then cut short and refreshed again sooner); only an ended session stops it.
      await this.renew()
      if (this.state.status !== 'signedIn') throw new NotSignedInError()
    }
    let issuedFrom = { token: this.token, expiresAt: this.tokenExpiresAt }
    let response: TokenResponse
    try {
      response = await this.exchangeOnce(audience, issuedFrom.token)
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw this.typed(error, audience)
      // The identity token was refused (it was revoked or ran out): renew once and try again.
      if (!(await this.renew())) throw new NotSignedInError()
      issuedFrom = { token: this.token, expiresAt: this.tokenExpiresAt }
      try {
        response = await this.exchangeOnce(audience, issuedFrom.token)
      } catch (retryError) {
        throw this.typed(retryError, audience)
      }
    }
    // The session ended (or was replaced) while the exchange ran: this token belongs to nobody now.
    if (generation !== this.generation) throw new NotSignedInError()
    const issuedAt = Date.now()
    this.moduleTtlMs = response.expires_in * 1000
    const moduleToken: ModuleToken = {
      accessToken: response.access_token,
      audience,
      issuedAt,
      expiresAt: Math.min(issuedAt + response.expires_in * 1000, issuedFrom.expiresAt),
    }
    // Not kept if the module's page was left while the exchange ran.
    if ((this.scopeEpochs.get(scope) ?? 0) === epoch) this.moduleTokens.set(this.moduleKey(scope, audience), moduleToken)
    return moduleToken
  }

  private exchangeOnce(audience: string, token: string | null): Promise<TokenResponse> {
    if (token === null) throw new NotSignedInError()
    return this.deps.exchange(audience, token)
  }

  private typed(error: unknown, audience: string): unknown {
    if (error instanceof ApiError && error.status === 403 && error.code === 'audience_not_allowed') {
      return new AudienceNotAllowedError(audience)
    }
    if (error instanceof ApiError && error.status === 400 && error.code === 'unknown_audience') {
      return new UnknownAudienceError(audience)
    }
    return error
  }

  // --- other tabs ------------------------------------------------------------------------------

  private onTabMessage(message: unknown): void {
    const type = typeof message === 'object' && message !== null ? (message as { type?: unknown }).type : undefined
    if (type === 'logout' && this.state.status !== 'signedOut') {
      this.end({ expired: false, byUser: true })
    } else if (type === 'login' && this.state.status !== 'signedIn') {
      void this.renew()
    }
  }

  private set(next: SessionState): void {
    this.state = next
    for (const listener of this.listeners) listener()
  }
}
