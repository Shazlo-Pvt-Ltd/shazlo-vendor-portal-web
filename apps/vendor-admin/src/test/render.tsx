import { mockModuleToken } from '@shazlo/mock-vendor-api'
import { newMessageId, PROTOCOL } from '@shazlo/shell-protocol'
import { act, render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { App } from '../app/App'
import { routes } from '../app/routes'
import type { Host } from '../runtime/runtime'
import { resetMockDb } from './server'

export const VENDOR_API_URL = 'http://vendor-api.test'
export const SHELL_ORIGIN = 'http://localhost:5192'

const ADMINS = {
  naman: { id: 'a_naman', email: 'naman@shazlo.store', roles: ['super_admin'], name: 'Naman Sinha' },
  priya: { id: 'a_priya', email: 'priya@shazlo.store', roles: ['vendor_reviewer'], name: 'Priya Mehta' },
} as const

// A message on the wire (ADR 0001), as the shell would build it.
export type WireMessage = { protocol: typeof PROTOCOL; v: number; type: string; id: string; replyTo?: string; sentAt: number; payload: Record<string, unknown> }

export function shellMessage(type: string, payload: Record<string, unknown>, replyTo?: string): WireMessage {
  return { protocol: PROTOCOL, v: 1, type, id: newMessageId(), ...(replyTo ? { replyTo } : {}), sentAt: Date.now(), payload }
}

// A stand-in for the Shazlo One shell. The module runs its real protocol client (createModuleClient)
// in a fake window whose `parent` is this shell: everything the module posts is recorded, `ready`
// and `token:request` are answered with `auth` (unless `autoAuth` is false), and the shell's own
// messages arrive the way a browser delivers them, from the shell's origin and window.
export function fakeShell({ as = 'priya', autoAuth = true, framed = true }: { as?: keyof typeof ADMINS; autoAuth?: boolean; framed?: boolean } = {}) {
  const sent: WireMessage[] = []
  const admin = ADMINS[as]
  const moduleWindow = new EventTarget() as EventTarget & { parent?: unknown }
  const shellWindow = {
    postMessage(data: unknown, targetOrigin: string) {
      // A browser delivers nothing to a shell on another origin.
      if (targetOrigin !== SHELL_ORIGIN) return
      const message = structuredClone(data) as WireMessage
      sent.push(message)
      if (autoAuth && (message.type === 'ready' || message.type === 'token:request')) queueMicrotask(() => toModule(auth(message.id)))
    },
  }
  moduleWindow.parent = shellWindow
  const toModule = (data: unknown, { origin = SHELL_ORIGIN, source = shellWindow as unknown }: { origin?: string; source?: unknown } = {}) => {
    const event = new MessageEvent('message', { data })
    Object.defineProperty(event, 'origin', { value: origin })
    Object.defineProperty(event, 'source', { value: source })
    moduleWindow.dispatchEvent(event)
  }
  const auth = (replyTo?: string, ttl = 300) => {
    const expiresAt = Math.floor(Date.now() / 1000) + ttl
    return shellMessage('auth', { accessToken: mockModuleToken({ id: admin.id, name: admin.name }, expiresAt), expiresAt, user: { id: admin.id, email: admin.email, roles: [...admin.roles] } }, replyTo)
  }
  const host: Host = { framed, shellOrigin: SHELL_ORIGIN, window: moduleWindow as unknown as Window }
  return {
    host,
    sent,
    titles: () => sent.filter((m) => m.type === 'title').map((m) => m.payload),
    toasts: () => sent.filter((m) => m.type === 'toast').map((m) => m.payload),
    deliver: (message: unknown, from?: { origin?: string; source?: unknown }) => act(() => toModule(message, from)),
    auth,
    navigate: (path: string) => act(() => toModule(shellMessage('navigate', { path }))),
  }
}

export function renderModule({ route = '/queue', as = 'priya', now, shell }: { route?: string; as?: 'naman' | 'priya'; now?: Date; shell?: ReturnType<typeof fakeShell> } = {}) {
  const db = resetMockDb(now)
  const theShell = shell ?? fakeShell({ as })
  const router = createMemoryRouter(routes, { initialEntries: [route] })
  const user = userEvent.setup()
  const view = render(<App host={theShell.host} apiUrl={VENDOR_API_URL} router={router} />)
  return { ...view, user, router, db, shell: theShell }
}
