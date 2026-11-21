import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

// No MSW server starts here: main's tests start their own (src/test/msw.ts) and the mock API is
// started per file with useMockApi() (src/test/server.ts). Two servers would both answer.

// Screens are lazy chunks: the first one a test file opens can take a few seconds to load on a cold,
// busy machine, far longer than findBy's 1 s default. Waiting longer costs nothing when it is fast.
configure({ asyncUtilTimeout: 5000 })

// Testing Library only cleans up by itself when the test globals are on; they are not.
afterEach(() => cleanup())

// Node 25+ defines its own localStorage/sessionStorage globals (empty without --localstorage-file),
// which hide jsdom's. Point both back at jsdom's storage, so tests can check nothing is written.
const dom = (globalThis as { jsdom?: { window: Window } }).jsdom
for (const name of ['localStorage', 'sessionStorage'] as const) {
  if (dom && !globalThis[name]) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] })
}

// jsdom lacks these browser APIs; MUI and the shell read them. (Files that run in the node
// environment, like the mock API's contract test, have no window.)
if (typeof window !== 'undefined' && !window.matchMedia) {
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
if (typeof window !== 'undefined') window.scrollTo = () => {}
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// jsdom has no object URLs; previews of a chosen file and the mock's demo photos use them.
if (typeof URL.createObjectURL !== 'function') {
  let counter = 0
  URL.createObjectURL = () => `blob:test/${(counter += 1)}`
  URL.revokeObjectURL = () => {}
}
