import { ApiError } from '../api/errors'
import type { components } from '../api/schema'
import { SessionStore, type SessionDeps } from './store'

type SessionResponse = components['schemas']['SessionResponse']

export function sessionBody(overrides: { role?: string; status?: string; token?: string; expires_in?: number } = {}): SessionResponse {
  return {
    access_token: overrides.token ?? 'token-1',
    expires_in: overrides.expires_in ?? 900,
    token_type: 'Bearer',
    user: { id: 'u1', email: 'owner@brand.test', role: overrides.role ?? 'owner', last_login_at: null },
    vendor: { id: 'v1', name: 'Brand', slug: 'brand', status: overrides.status ?? 'approved' },
  } as SessionResponse
}

export function apiError(status: number, code: string): ApiError {
  return new ApiError({ status, code, message: code })
}

/** An in-memory stand-in for the BroadcastChannel; `peers` receive what one sends. */
export function fakeChannels() {
  const members: Array<{ onmessage: ((e: MessageEvent) => void) | null }> = []
  return () => {
    const me: { onmessage: ((e: MessageEvent) => void) | null; postMessage: (data: unknown) => void; close: () => void } = {
      onmessage: null,
      postMessage: (data) => {
        for (const other of members) if (other !== me) other.onmessage?.({ data } as MessageEvent)
      },
      close: () => {
        members.splice(members.indexOf(me), 1)
      },
    }
    members.push(me)
    return me
  }
}

export function makeStore(overrides: Partial<SessionDeps> = {}) {
  const deps: SessionDeps = {
    refresh: async () => sessionBody(),
    logout: async () => {},
    onCleared: () => {},
    conflictWaitMs: 0,
    ...overrides,
  }
  return { store: new SessionStore(deps), deps }
}
