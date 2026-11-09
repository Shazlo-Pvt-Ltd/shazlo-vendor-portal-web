import { mockModuleToken } from '@shazlo/mock-vendor-api'
import { createMessage, type Message, type ShellMessage } from '@shazlo/shell-protocol'
import { act, render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { App } from '../app/App'
import { routes } from '../app/routes'
import type { Host } from '../runtime/runtime'
import { resetMockDb } from './server'

export const VENDOR_API_URL = 'http://vendor-api.test'

const ADMINS = {
  naman: { id: 'a_naman', email: 'naman@shazlo.store', roles: ['super_admin'], name: 'Naman Sinha' },
  priya: { id: 'a_priya', email: 'priya@shazlo.store', roles: ['vendor_reviewer'], name: 'Priya Mehta' },
} as const

// A stand-in for the Shazlo One shell: answers `ready` with `auth` (unless `autoAuth` is false) and
// records everything the module sends, so tests can assert titles, toasts and logout.
export function fakeShell({ as = 'priya', autoAuth = true, framed = true }: { as?: keyof typeof ADMINS; autoAuth?: boolean; framed?: boolean } = {}) {
  const sent: Message[] = []
  let deliver: ((m: ShellMessage) => void) | null = null
  const admin = ADMINS[as]
  const auth = (replyTo?: string, ttl = 300) => {
    const expiresAt = Math.floor(Date.now() / 1000) + ttl
    return createMessage('auth', { accessToken: mockModuleToken({ id: admin.id, name: admin.name }, expiresAt), expiresAt, user: { id: admin.id, email: admin.email, roles: [...admin.roles], name: admin.name } }, replyTo)
  }
  const host: Host = {
    framed,
    send(message) {
      sent.push(message)
      if (autoAuth && (message.type === 'ready' || message.type === 'token:request')) queueMicrotask(() => deliver?.(auth(message.id)))
    },
    listen(onMessage) {
      deliver = onMessage
      return () => {
        deliver = null
      }
    },
  }
  return {
    host,
    sent,
    titles: () => sent.filter((m) => m.type === 'title').map((m) => (m as Message<'title'>).payload),
    toasts: () => sent.filter((m) => m.type === 'toast').map((m) => (m as Message<'toast'>).payload),
    deliver: (message: ShellMessage) => act(() => deliver?.(message)),
    auth,
    navigate: (path: string) => act(() => deliver?.(createMessage('navigate', { path }))),
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
