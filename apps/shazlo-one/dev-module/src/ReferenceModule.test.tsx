import {
  createShellChannel,
  type AuthPayload,
  type LogoutPayload,
  type ModuleErrorPayload,
  type ShellChannel,
  type TitlePayload,
  type ToastPayload,
  type TokenRequestPayload,
} from '@shazlo/shell-protocol'
import { fireEvent, render, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ModuleConfig } from '../config'
import { MODULE_ORIGIN, SHELL_ORIGIN, createFrames, flush } from '../test/frames'
import { ReferenceModule } from './ReferenceModule'

const API = 'https://vendor.test'
const NOW = 1_700_000_000_000
const config: ModuleConfig = { shellOrigin: SHELL_ORIGIN, vendorApiOrigin: API, development: true }

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function auth(token: string, overrides: Partial<AuthPayload> = {}): AuthPayload {
  return {
    accessToken: token,
    expiresAt: NOW / 1000 + 900,
    user: { id: 'a1', email: 'asha@shazlo.test', roles: ['vendor_reviewer', 'super_admin'] },
    ...overrides,
  }
}

interface Options {
  /** Answer `ready` with this auth automatically; false leaves the module waiting. */
  autoAuth?: boolean
  /** The tokens vendor-api accepts. */
  accept?: string[]
  /** What the shell answers a `token:request` with; undefined answers nothing. */
  refresh?: () => AuthPayload | undefined
}

/** The real shell channel and the real module in a real iframe, with vendor-api faked by MSW. */
function setup(options: Options = {}) {
  const { autoAuth = true, accept = ['tok-1'] } = options
  const frames = createFrames()
  const seen = {
    titles: [] as TitlePayload[],
    toasts: [] as ToastPayload[],
    logouts: [] as LogoutPayload[],
    errors: [] as ModuleErrorPayload[],
    tokenRequests: [] as TokenRequestPayload[],
  }
  const apiCalls: Array<string | null> = []
  server.use(
    http.get(`${API}/v1/admin/me`, ({ request }) => {
      const header = request.headers.get('Authorization')
      apiCalls.push(header)
      if (header !== null && accept.includes(header.replace('Bearer ', ''))) {
        return HttpResponse.json({ id: '11111111-2222-4333-8444-555555555555', roles: ['vendor_reviewer'] })
      }
      return HttpResponse.json({ error: { code: 'unauthorized', message: 'no' } }, { status: 401 })
    }),
  )

  const shell: ShellChannel = createShellChannel({
    iframe: frames.moduleFrame,
    origin: MODULE_ORIGIN,
    window: frames.shellWindow,
    development: true,
    onReady: ({ id }) => {
      if (autoAuth) shell.sendAuth(auth('tok-1'), { replyTo: id })
    },
    onTitle: (payload) => seen.titles.push(payload),
    onToast: (payload) => seen.toasts.push(payload),
    onLogout: (payload) => seen.logouts.push(payload),
    onModuleError: (payload) => seen.errors.push(payload),
    onTokenRequest: (payload) => {
      seen.tokenRequests.push(payload)
      const next = options.refresh?.()
      if (next) shell.sendAuth(next)
    },
  })

  // Messages are tracked by the frames; vendor-api calls by wrapping fetch. `settle` waits for both, and
  // for what each causes (a 401 asks the shell, whose answer causes another call).
  let inflight = 0
  const realFetch = globalThis.fetch
  vi.stubGlobal('fetch', (...args: Parameters<typeof fetch>) => {
    inflight += 1
    return realFetch(...args).finally(() => {
      inflight -= 1
    })
  })
  const settle = async () => {
    do {
      await flush()
    } while (inflight > 0)
    await flush()
  }

  const container = frames.frameDocument.body.appendChild(frames.frameDocument.createElement('div'))
  const view = render(<ReferenceModule config={config} frameWindow={frames.moduleWindow} now={() => NOW} />, { container })
  const page = within(frames.frameDocument.body)
  return { ...frames, shell, seen, apiCalls, page, view, settle }
}

const text = (frame: Document) => frame.body.textContent ?? ''

describe('opened outside the shell', () => {
  it('says so and does nothing else: no listener, no message, no request', async () => {
    const frames = createFrames()
    const listen = vi.spyOn(frames.shellWindow, 'addEventListener')
    const { container } = render(<ReferenceModule config={config} frameWindow={frames.shellWindow} />)
    await flush()
    expect(within(container).getByRole('heading', { level: 1, name: 'Reference module' })).toBeTruthy()
    expect(container.textContent).toMatch(/works only inside the shell/)
    expect(within(container).queryAllByRole('button')).toEqual([])
    expect(within(container).getByRole('link', { name: 'Shazlo-One' }).getAttribute('href')).toBe(SHELL_ORIGIN)
    expect(listen.mock.calls.filter(([type]) => type === 'message')).toEqual([])
    expect(frames.posts).toEqual([])
  })
})

describe('inside the shell', () => {
  it('sends ready first and waits for the session', async () => {
    const t = setup({ autoAuth: false })
    await t.settle()
    expect(text(t.frameDocument)).toMatch(/Waiting for the shell to send the session/)
    expect(t.posts[0]).toMatchObject({
      from: 'module',
      targetOrigin: SHELL_ORIGIN,
      data: { type: 'ready', payload: { module: 'reference', supportedVersions: [1] } },
    })
    expect(t.apiCalls).toEqual([])
    expect(t.page.getByRole('button', { name: 'Call GET /v1/admin/me' }).hasAttribute('disabled')).toBe(true)
  })

  it('shows the email, the roles and when the token expires, and never the token', async () => {
    const t = setup()
    await t.settle()
    const body = text(t.frameDocument)
    expect(body).toContain('asha@shazlo.test')
    expect(body).toContain('vendor_reviewer, super_admin')
    expect(body).toMatch(/\(15 min left\)/)
    expect(body).not.toContain('tok-1')
    expect(t.frameDocument.documentElement.outerHTML).not.toContain('tok-1')
  })

  it('calls vendor-api once with the exchanged token and shows what it answered', async () => {
    const t = setup()
    await t.settle()
    expect(t.apiCalls).toEqual(['Bearer tok-1'])
    expect(text(t.frameDocument)).toMatch(/vendor-api answered 200: admin 11111111-2222-4333-8444-555555555555, roles vendor_reviewer/)
    expect(t.seen.tokenRequests).toEqual([])
  })

  it('sends its token to vendor-api only, with no cookies and no referrer', async () => {
    const t = setup()
    await t.settle()
    expect(t.apiCalls).toHaveLength(1)
    // The only requests are the one MSW handled (onUnhandledFrame would have thrown on any other).
    // What the module itself posts to the shell never contains the token (only the shell's auth does).
    const fromModule = t.posts.filter((post) => post.from === 'module')
    expect(fromModule.length).toBeGreaterThan(0)
    expect(fromModule.every((post) => !JSON.stringify(post.data).includes('tok-1'))).toBe(true)
  })

  it('keeps the token out of web storage and posts only to the shell’s exact origin', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const t = setup()
    await t.settle()
    fireEvent.click(t.page.getByRole('button', { name: 'Send a success toast' }))
    await t.settle()
    expect(setItem).not.toHaveBeenCalled()
    expect(t.posts.length).toBeGreaterThan(1)
    for (const post of t.posts.filter((entry) => entry.from === 'module')) {
      expect(post.targetOrigin).toBe(SHELL_ORIGIN)
    }
  })

  it('does not call vendor-api again on a plain refresh, but the button uses the newest token', async () => {
    const t = setup({ accept: ['tok-1', 'tok-2'] })
    await t.settle()
    t.shell.sendAuth(auth('tok-2', { expiresAt: NOW / 1000 + 1800 }))
    await t.settle()
    expect(t.apiCalls).toEqual(['Bearer tok-1'])
    expect(text(t.frameDocument)).toMatch(/\(30 min left\)/)
    fireEvent.click(t.page.getByRole('button', { name: 'Call GET /v1/admin/me' }))
    await t.settle()
    expect(t.apiCalls).toEqual(['Bearer tok-1', 'Bearer tok-2'])
  })

  it('ignores an older auth replayed after a newer one', async () => {
    const t = setup({ accept: ['tok-1', 'tok-2', 'old'] })
    await t.settle()
    t.shell.sendAuth(auth('tok-2', { expiresAt: NOW / 1000 + 1800 }))
    await t.settle()
    t.shell.sendAuth(auth('old', { expiresAt: NOW / 1000 + 100 }))
    await t.settle()
    expect(text(t.frameDocument)).toMatch(/\(30 min left\)/)
    fireEvent.click(t.page.getByRole('button', { name: 'Call GET /v1/admin/me' }))
    await t.settle()
    expect(t.apiCalls.at(-1)).toBe('Bearer tok-2')
  })
})

describe('a refused token', () => {
  it('asks the shell for a new one, then repeats the call with it', async () => {
    const t = setup({ accept: ['tok-2'], refresh: () => auth('tok-2') })
    await t.settle()
    expect(t.seen.tokenRequests).toEqual([{ reason: 'unauthorized' }])
    expect(t.apiCalls).toEqual(['Bearer tok-1', 'Bearer tok-2'])
    expect(text(t.frameDocument)).toMatch(/vendor-api answered 200/)
  })

  it('does not ask again within 30 seconds, and says why, so it cannot loop on a persistent 401', async () => {
    const t = setup({ accept: [], refresh: () => auth('tok-2') })
    await t.settle()
    // First 401 asked; the shell's reply was refused too, but the second request is rate limited.
    expect(t.seen.tokenRequests).toHaveLength(1)
    expect(t.apiCalls).toEqual(['Bearer tok-1', 'Bearer tok-2'])
    expect(text(t.frameDocument)).toMatch(/less than 30 seconds ago/)
    expect(text(t.frameDocument)).toMatch(/vendor-api refused the token \(401\)/)
  })

  it('waits for the shell when it does not answer, without calling again', async () => {
    const t = setup({ accept: [] })
    await t.settle()
    expect(t.seen.tokenRequests).toHaveLength(1)
    expect(t.apiCalls).toEqual(['Bearer tok-1'])
    expect(text(t.frameDocument)).toMatch(/Asked the shell for a new token/)
  })

  it('reports an answer it does not understand, and an unreachable vendor-api, without crashing', async () => {
    const t = setup()
    await t.settle()
    server.use(http.get(`${API}/v1/admin/me`, () => HttpResponse.json({ nope: true })))
    fireEvent.click(t.page.getByRole('button', { name: 'Call GET /v1/admin/me' }))
    await t.settle()
    expect(text(t.frameDocument)).toMatch(/does not understand/)
    server.use(http.get(`${API}/v1/admin/me`, () => HttpResponse.json({}, { status: 503 })))
    fireEvent.click(t.page.getByRole('button', { name: 'Call GET /v1/admin/me' }))
    await t.settle()
    expect(text(t.frameDocument)).toMatch(/vendor-api answered 503/)
    server.use(http.get(`${API}/v1/admin/me`, () => HttpResponse.error()))
    fireEvent.click(t.page.getByRole('button', { name: 'Call GET /v1/admin/me' }))
    await t.settle()
    expect(text(t.frameDocument)).toMatch(/Could not reach vendor-api/)
  })
})

describe('every message a module can send', () => {
  it('title: each in-module page sends its path and title', async () => {
    const t = setup()
    await t.settle()
    fireEvent.click(t.page.getByRole('button', { name: /Orders \(example\)/ }))
    await t.settle()
    expect(t.seen.titles).toEqual([{ path: '/pages/orders', title: 'Orders (example)' }])
    expect(t.page.getByRole('button', { name: /Orders \(example\)/ }).getAttribute('aria-current')).toBe('page')
    expect(text(t.frameDocument)).toContain('/pages/orders')
    expect(text(t.frameDocument)).toMatch(/Sent title for \/pages\/orders\./)
  })

  it.each(['info', 'success', 'warning', 'error'] as const)('toast: a %s toast', async (level) => {
    const t = setup()
    await t.settle()
    fireEvent.click(t.page.getByRole('button', { name: `Send a ${level} toast` }))
    await t.settle()
    expect(t.seen.toasts).toEqual([{ level, message: `A ${level} message from the reference module.` }])
  })

  it('error: a non-fatal and a fatal one', async () => {
    const t = setup()
    await t.settle()
    fireEvent.click(t.page.getByRole('button', { name: 'Send a non-fatal error' }))
    fireEvent.click(t.page.getByRole('button', { name: 'Send a fatal error' }))
    await t.settle()
    expect(t.seen.errors).toEqual([
      { code: 'reference_nonfatal', message: 'A non-fatal error from the reference module.', fatal: false },
      { code: 'reference_fatal', message: 'A fatal error from the reference module.', fatal: true },
    ])
  })

  it('logout: asks the shell to end the session', async () => {
    const t = setup()
    await t.settle()
    fireEvent.click(t.page.getByRole('button', { name: 'Sign out of Shazlo-One' }))
    await t.settle()
    expect(t.seen.logouts).toEqual([{ reason: 'reference_module_button' }])
  })

  it('ready and token:request are the other two, and both were sent in the flows above', async () => {
    const t = setup({ accept: [] })
    await t.settle()
    const types = t.posts.filter((post) => post.from === 'module').map((post) => (post.data as { type: string }).type)
    expect(types).toEqual(['ready', 'token:request'])
  })
})

describe('what the shell can ask of the module', () => {
  it('navigate: shows the path and sends the matching title back', async () => {
    const t = setup()
    await t.settle()
    t.shell.sendNavigate('/pages/reports')
    await t.settle()
    expect(text(t.frameDocument)).toContain('/pages/reports')
    expect(t.seen.titles).toEqual([{ path: '/pages/reports', title: 'Reports (example)' }])
  })

  it('navigate to a path the module does not list still gets a title', async () => {
    const t = setup()
    await t.settle()
    t.shell.sendNavigate('/somewhere/else')
    await t.settle()
    expect(t.seen.titles).toEqual([{ path: '/somewhere/else', title: 'Reference module' }])
  })

  it('error: shows what the shell reported', async () => {
    const t = setup()
    await t.settle()
    t.shell.sendError('session_ending', 'Your session is ending.')
    await t.settle()
    expect(t.page.getByRole('alert').textContent).toContain('session_ending: Your session is ending.')
  })
})

describe('closing', () => {
  it('stops listening when the page is unmounted: a later auth does nothing', async () => {
    const t = setup({ accept: ['tok-1', 'tok-9'] })
    await t.settle()
    t.view.unmount()
    t.shell.sendAuth(auth('tok-9', { expiresAt: NOW / 1000 + 5000 }))
    await t.settle()
    expect(t.apiCalls).toEqual(['Bearer tok-1'])
  })
})
