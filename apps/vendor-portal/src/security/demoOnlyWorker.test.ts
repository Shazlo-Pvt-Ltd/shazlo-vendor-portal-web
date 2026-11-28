// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { demoOnlyWorker, mswWorkerPath, MOCK_WORKER_FILE } from './demoOnlyWorker'

type Middleware = (req: { url?: string }, res: { setHeader: (name: string, value: unknown) => void; end: (body: string) => void }, next: () => void) => void

/** Runs the plugin's dev-server hook and returns the middleware it added, if any. */
function devMiddleware(demo: boolean): Middleware | undefined {
  let added: Middleware | undefined
  const server = { config: { server: { headers: { 'X-Content-Type-Options': 'nosniff' } } }, middlewares: { use: (fn: Middleware) => void (added = fn) } }
  ;(demoOnlyWorker(demo).configureServer as (server: unknown) => void)(server)
  return added
}

function request(middleware: Middleware, url: string) {
  const headers: Record<string, unknown> = {}
  let body: string | undefined
  const next = vi.fn()
  middleware({ url }, { setHeader: (name, value) => void (headers[name] = value), end: (text) => void (body = text) }, next)
  return { headers, body, next }
}

/** Runs the plugin's bundle hook and returns what it emitted. */
function emitted(demo: boolean): Array<{ fileName: string; source: string }> {
  const files: Array<{ fileName: string; source: string }> = []
  ;(demoOnlyWorker(demo).generateBundle as (this: unknown) => void).call({ emitFile: (file: { fileName: string; source: string }) => void files.push(file) })
  return files
}

describe('the mock service worker', () => {
  const worker = readFileSync(mswWorkerPath(), 'utf8')

  it('comes from the installed msw package', () => {
    expect(worker).toContain('Mock Service Worker')
  })

  it('is served by the dev server in demo mode, with the policy headers', () => {
    const middleware = devMiddleware(true)!
    const served = request(middleware, `/${MOCK_WORKER_FILE}?v=1`)
    expect(served.body).toBe(worker)
    expect(served.headers['Content-Type']).toMatch(/^text\/javascript/)
    expect(served.headers['X-Content-Type-Options']).toBe('nosniff')
    expect(served.next).not.toHaveBeenCalled()
    expect(request(middleware, '/index.html').next).toHaveBeenCalled()
  })

  it('is not served by the dev server outside demo mode', () => {
    expect(devMiddleware(false)).toBeUndefined()
  })

  it('is emitted into a demo build (VITE_MOCK_API=on)', () => {
    expect(emitted(true)).toEqual([{ type: 'asset', fileName: MOCK_WORKER_FILE, source: worker }])
  })

  it('is left out of a normal build', () => {
    expect(emitted(false)).toEqual([])
  })
})
