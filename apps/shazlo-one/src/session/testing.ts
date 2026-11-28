import { ApiError } from '../api/http'
import type { components } from '../api/identity'
import { SessionStore, type SessionDeps } from './store'

type SessionResponse = components['schemas']['SessionResponse']
type AdminProfile = components['schemas']['AdminProfile']

// Test helpers for the session store (store.test.ts) and the module host.

export function adminProfile(overrides: Partial<AdminProfile> = {}): AdminProfile {
  return { id: 'a1', email: 'admin@shazlo.test', display_name: 'Asha Admin', roles: ['super_admin'], must_change_password: false, ...overrides }
}

export function sessionBody(overrides: { roles?: string[]; token?: string; expires_in?: number; must_change_password?: boolean; admin?: Partial<AdminProfile> } = {}): SessionResponse {
  const mustChange = overrides.must_change_password ?? false
  return {
    access_token: overrides.token ?? 'token-1',
    expires_in: overrides.expires_in ?? 900,
    token_type: 'Bearer',
    must_change_password: mustChange,
    admin: adminProfile({ roles: overrides.roles ?? ['super_admin'], must_change_password: mustChange, ...overrides.admin }),
  }
}

export function apiError(status: number, code: string): ApiError {
  return new ApiError(status, code, code)
}

/** An in-memory stand-in for the BroadcastChannel: what one member sends, the others receive. */
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
    exchange: async (audience) => ({ access_token: `module-${audience}`, token_type: 'Bearer', expires_in: 300, audience }),
    logout: async () => {},
    onCleared: () => {},
    channel: null,
    conflictWaitMs: 0,
    ...overrides,
  }
  return { store: new SessionStore(deps), deps }
}
