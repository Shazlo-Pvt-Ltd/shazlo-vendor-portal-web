import { render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { MODULES } from '../../src/modules/registry'
import { makeStore, sessionBody } from '../../src/session/testing'
import { SHELL_ORIGIN, bridge, currentFrame } from '../../src/test/frameBridge'
import { renderRoute } from '../../src/test/renderRoute'
import { setViewport } from '../../src/test/viewport'
import type { ModuleConfig } from '../config'
import { ReferenceModule } from '../src/ReferenceModule'

const API = 'https://vendor.test'
const reference = MODULES.development.find((module) => module.id === 'reference')!
const config: ModuleConfig = { shellOrigin: SHELL_ORIGIN, vendorApiOrigin: API, development: true }

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

/**
 * The shell's real host and the real reference module, together: the host creates the frame, the
 * module runs in it, they shake hands, the host exchanges a token for the registry's audience and the
 * module uses it against vendor-api. Only identity-api's exchange and vendor-api are faked.
 */
async function openReferenceInShell() {
  setViewport(1280)
  const apiCalls: Array<string | null> = []
  server.use(
    http.get(`${API}/v1/admin/me`, ({ request }) => {
      const header = request.headers.get('Authorization')
      apiCalls.push(header)
      return header === 'Bearer exchanged-for-vendor-api'
        ? HttpResponse.json({ id: '11111111-2222-4333-8444-555555555555', roles: ['vendor_reviewer'] })
        : HttpResponse.json({ error: { code: 'unauthorized', message: 'no' } }, { status: 401 })
    }),
  )
  const exchange = vi.fn(async (audience: string) => ({
    access_token: 'exchanged-for-vendor-api',
    token_type: 'Bearer',
    expires_in: 300,
    audience,
  }))
  const body = sessionBody({ roles: ['vendor_reviewer'] })
  const store = makeStore({ refresh: async () => body, fetchMe: async () => body.admin, exchange }).store
  renderRoute('/m/reference', { store, modules: MODULES.development })
  await screen.findByRole('heading', { level: 1, name: 'Reference module' })

  const frame = currentFrame()
  const { frameWindow, posts } = bridge(frame, reference.origin)
  // The frame has an address now, so jsdom hands it an empty document: give it a body to render into.
  const frameDocument = frameWindow.document
  if (frameDocument.body === null) {
    const root = frameDocument.documentElement ?? frameDocument.appendChild(frameDocument.createElement('html'))
    root.appendChild(frameDocument.createElement('body'))
  }
  const container = frameDocument.body.appendChild(frameDocument.createElement('div'))
  render(<ReferenceModule config={config} frameWindow={frameWindow} />, { container })
  return { frame, frameWindow, posts, exchange, apiCalls, page: within(frameDocument.body) }
}

describe('the reference module inside the shell', () => {
  it('receives a working token, and calls vendor-api with it', async () => {
    const t = await openReferenceInShell()
    await waitFor(() => expect(t.frameWindow.document.body.textContent).toMatch(/vendor-api answered 200/))
    expect(t.exchange).toHaveBeenCalledOnce()
    expect(t.exchange.mock.calls[0]![0]).toBe(reference.audience)
    expect(t.apiCalls).toEqual(['Bearer exchanged-for-vendor-api'])
    const text = t.frameWindow.document.body.textContent ?? ''
    expect(text).toContain('admin@shazlo.test')
    expect(text).toContain('vendor_reviewer')
    // The shell's loading state is gone and the frame is shown.
    expect(screen.queryByText(/Loading Reference module/)).toBeNull()
    expect(t.frame.style.visibility).toBe('visible')
  })

  it('never lets the token appear in a URL, storage, the pages or a log', async () => {
    const lines: unknown[][] = []
    for (const method of ['log', 'warn', 'error', 'info', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void lines.push(args))
    }
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const t = await openReferenceInShell()
    await waitFor(() => expect(t.frameWindow.document.body.textContent).toMatch(/vendor-api answered 200/))
    const token = 'exchanged-for-vendor-api'
    expect(t.frame.getAttribute('src')).toBe(reference.url)
    expect(t.frame.src).not.toContain(token)
    expect(document.documentElement.outerHTML).not.toContain(token)
    expect(t.frameWindow.document.documentElement.outerHTML).not.toContain(token)
    expect(document.location.href).not.toContain(token)
    expect(setItem).not.toHaveBeenCalled()
    expect(JSON.stringify(lines)).not.toContain(token)
    // On the wire it travels only in the shell's one `auth` message to the module's exact origin,
    // and the module's own messages never carry it.
    const withToken = t.posts.filter((post) => JSON.stringify(post.data).includes(token))
    expect(withToken).toHaveLength(1)
    expect(withToken[0]).toMatchObject({ from: 'shell', targetOrigin: reference.origin })
    expect(t.posts.every((post) => post.targetOrigin !== '*')).toBe(true)
  })
})
