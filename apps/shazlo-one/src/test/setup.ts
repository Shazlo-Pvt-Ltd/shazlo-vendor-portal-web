import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { server } from './server'

// Node 25+ defines its own localStorage/sessionStorage globals (empty without --localstorage-file),
// which hide jsdom's. Point both back at jsdom's storage.
const dom = (globalThis as { jsdom?: { window: Window } }).jsdom
for (const name of ['localStorage', 'sessionStorage'] as const) {
  if (dom && !globalThis[name]) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] })
}

// Lazily loaded screens compile on first use in jsdom; give the first find* calls room.
configure({ asyncUtilTimeout: 4000 })

// jsdom lacks these browser APIs; MUI and the shell read them. (A test that runs in Node, such as the
// build checks, has no window at all.)
const browser = typeof window !== 'undefined'
if (browser && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })
}
if (browser) window.scrollTo = () => {}
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (!URL.createObjectURL) URL.createObjectURL = () => 'blob:mock'
if (!URL.revokeObjectURL) URL.revokeObjectURL = () => {}

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  server.resetHandlers()
  if (!browser) return
  cleanup()
  localStorage.clear()
  sessionStorage.clear()
})
afterAll(() => server.close())
