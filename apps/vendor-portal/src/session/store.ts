import type { components } from '../api/schema'
import { ApiError, NetworkError } from '../api/errors'
import { clearSensitiveState } from '../security/sensitiveState'
import { clearDrafts } from './drafts'

type SessionResponse = components['schemas']['SessionResponse']

export type Role = 'owner' | 'staff'

/** What the session is doing. `unavailable` means the server could not be reached, not "signed out". */
export type SessionStatus = 'loading' | 'signedIn' | 'signedOut' | 'blocked' | 'unavailable'

export interface SessionState {
  status: SessionStatus
  user: SessionResponse['user'] | null
  vendor: SessionResponse['vendor'] | null
  /** `owner` or `staff`. Anything unrecognised counts as `staff`, the least privilege. */
  role: Role | null
  /** True when a signed-in session ended on its own (refresh failed), not by the user's choice. */
  expired: boolean
}

export interface SessionDeps {
  /** `POST /v1/auth/refresh`: the new session. Throws `ApiError` or `NetworkError`. */
  refresh: () => Promise<SessionResponse>
  /** `POST /v1/auth/logout`. Failure is ignored: the local session ends either way. */
  logout: () => Promise<void>
  /** Called when the session ends, to drop every cached answer of the previous user. */
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

const SIGNED_OUT: SessionState = { status: 'signedOut', user: null, vendor: null, role: null, expired: false }
const LOADING: SessionState = { ...SIGNED_OUT, status: 'loading' }

export const SESSION_CHANNEL = 'shazlo-vendor-session'

function roleOf(role: string): Role {
  return role === 'owner' ? 'owner' : 'staff'
}

/** The session body, checked: refresh is untyped in the OpenAPI file, so do not trust it blindly. */
export function isSessionResponse(value: unknown): value is SessionResponse {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Partial<SessionResponse>
  return (
    typeof v.access_token === 'string' &&
    typeof v.expires_in === 'number' &&
    typeof v.user === 'object' &&
    v.user !== null &&
    typeof v.vendor === 'object' &&
    v.vendor !== null
  )
}

/**
 * The vendor's session (ADR 0009): a 15-minute access token kept in memory only, and a refresh
 * cookie the browser holds. Nothing here touches web storage. Only the words `login` and `logout`
 * travel between tabs, never a token.
 */
export class SessionStore {
  private state: SessionState = LOADING
  private token: string | null = null
  private listeners = new Set<() => void>()
  private renewTimer: ReturnType<typeof setTimeout> | undefined
  private inFlight: Promise<boolean> | undefined
  private started: Promise<void> | undefined
  private closed = true

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
    this.set({ ...LOADING })
    this.started = this.restore()
    return this.started
  }

  /** Takes a session a login call returned. */
  signIn(session: SessionResponse): void {
    this.adopt(session)
    this.channel?.postMessage({ type: 'login' })
  }

  /** The vendor is rejected or suspended: no session, and a page that says why instead of a loop. */
  markBlocked(): void {
    this.clearToken()
    clearDrafts()
    clearSensitiveState()
    this.set({ ...SIGNED_OUT, status: 'blocked' })
    this.deps.onCleared()
  }

  /** The user's own sign-out. */
  async logout(): Promise<void> {
    try {
      await this.deps.logout()
    } catch {
      // The cookie may already be gone or the network down; the local session ends regardless.
    }
    this.end({ expired: false })
    this.channel?.postMessage({ type: 'logout' })
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
    this.inFlight ??= this.doRenew().finally(() => {
      this.inFlight = undefined
    })
    return this.inFlight
  }

  private async doRenew(): Promise<boolean> {
    const hadSession = this.state.status === 'signedIn'
    try {
      const session = await this.refreshWithConflictRetry()
      if (this.closed) return false
      this.adopt(session)
      return true
    } catch (error) {
      if (this.closed) return false
      if (error instanceof ApiError && error.code === 'vendor_not_allowed') {
        this.markBlocked()
      } else if (error instanceof ApiError && error.status === 401) {
        this.end({ expired: hadSession })
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
    try {
      return await this.deps.refresh()
    } catch (error) {
      if (error instanceof ApiError && error.code === 'refresh_conflict') {
        await new Promise((resolve) => setTimeout(resolve, this.deps.conflictWaitMs ?? 400))
        return await this.deps.refresh()
      }
      throw error
    }
  }

  private adopt(session: SessionResponse): void {
    this.token = session.access_token
    this.set({
      status: 'signedIn',
      user: session.user,
      vendor: session.vendor,
      role: roleOf(session.user.role),
      expired: false,
    })
    this.scheduleRenewal(session.expires_in * (this.deps.renewAt ?? 0.8))
  }

  private scheduleRenewal(seconds: number): void {
    clearTimeout(this.renewTimer)
    if (this.closed) return
    this.renewTimer = setTimeout(() => void this.renew(), Math.max(1, seconds) * 1000)
  }

  private end(options: { expired: boolean }): void {
    this.clearToken()
    // A session that ran out keeps the unsaved forms for the next sign-in; a sign-out does not.
    if (!options.expired) clearDrafts()
    // Typed passwords and half-filled sensitive forms never survive the session, expired or not.
    clearSensitiveState()
    this.set({ ...SIGNED_OUT, expired: options.expired })
    this.deps.onCleared()
  }

  private clearToken(): void {
    this.token = null
    clearTimeout(this.renewTimer)
  }

  // --- other tabs ------------------------------------------------------------------------------

  private onTabMessage(message: unknown): void {
    const type = typeof message === 'object' && message !== null ? (message as { type?: unknown }).type : undefined
    if (type === 'logout' && this.state.status !== 'signedOut') {
      this.end({ expired: false })
    } else if (type === 'login' && this.state.status !== 'signedIn') {
      void this.renew()
    }
  }

  private set(next: SessionState): void {
    this.state = next
    for (const listener of this.listeners) listener()
  }
}
