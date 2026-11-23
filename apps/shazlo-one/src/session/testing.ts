import { ApiError } from '../api/errors'
import type { components } from '../api/schema'
import { SessionStore, type SessionDeps } from './store'

type SessionResponse = components['schemas']['SessionResponse']
type AdminProfile = components['schemas']['AdminProfile']

export function adminProfile(overrides: Partial<AdminProfile> = {}): AdminProfile {
  return {
    id: 'a1',
    email: 'admin@shazlo.test',
    display_name: 'Asha Admin',
    roles: ['super_admin'],
    must_change_password: false,
    ...overrides,
  }
}

export function sessionBody(
  overrides: { roles?: string[]; token?: string; expires_in?: number; must_change_password?: boolean } = {},
): SessionResponse {
  const mustChange = overrides.must_change_password ?? false
  return {
    access_token: overrides.token ?? 'token-1',
    expires_in: overrides.expires_in ?? 900,
    token_type: 'Bearer',
    must_change_password: mustChange,
    // What identity-api sends for a first login: the profile, but a token with no roles.
    admin: adminProfile({ roles: overrides.roles ?? ['super_admin'], must_change_password: mustChange }),
  }
}

export function apiError(status: number, code: string): ApiError {
  return new ApiError({ status, code, message: code })
}

/** An in-memory stand-in for the BroadcastChannel; what one member sends the others receive. */
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
    fetchMe: async () => adminProfile(),
    exchange: async (audience) => ({ access_token: `module-${audience}`, token_type: 'Bearer', expires_in: 300, audience }),
    logout: async () => {},
    onCleared: () => {},
    conflictWaitMs: 0,
    ...overrides,
  }
  return { store: new SessionStore(deps), deps }
}
