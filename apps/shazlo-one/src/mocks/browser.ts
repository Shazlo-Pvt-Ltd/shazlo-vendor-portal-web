/* eslint-disable no-restricted-globals -- The one exception to "no web storage": the browser mock's own
   state on the dev server (PERSIST is false in every build, and src/security/build.test.ts proves a
   demo build holds no storage key). It never holds a real token. */
import { setupWorker } from 'msw/browser'
import { createIdentityDb, createIdentityHandlers, type IdentityDb } from './identity'

// Browser copy of the identity mock. Only on the dev server does its state (admins and the modelled
// refresh cookie, with its mock tokens) survive reloads in localStorage, as the real HttpOnly cookie
// would; a demo build (VITE_MOCK_API=on), which can be deployed, keeps it in memory and writes nothing
// to storage. shazloOneResetDemo() starts over.
const PERSIST = import.meta.env.DEV
// Empty in a demo build, so not even the name of the storage key is in it.
const KEY = PERSIST ? 'shazlo.one.mock-identity.v1' : ''

function load(): IdentityDb {
  const fresh = createIdentityDb()
  if (!PERSIST) return fresh
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return fresh
    const s = JSON.parse(raw)
    return { ...fresh, ...s, now: fresh.now, access: new Map(s.access), refresh: new Map(s.refresh), failures: new Map(s.failures) }
  } catch {
    return fresh
  }
}

function save(db: IdentityDb) {
  if (!PERSIST) return
  const { now: _now, ...rest } = db
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...rest, access: [...db.access], refresh: [...db.refresh], failures: [...db.failures] }))
  } catch {
    // Storage full or blocked: the demo resets on reload.
  }
}

export async function startMockIdentity() {
  let db = load()
  const worker = setupWorker(...createIdentityHandlers(() => db))
  worker.events.on('response:mocked', ({ request }) => {
    if (request.method !== 'GET') save(db)
  })
  const w = window as unknown as { shazloOneResetDemo: () => void }
  w.shazloOneResetDemo = () => {
    db = createIdentityDb()
    if (PERSIST) localStorage.removeItem(KEY)
    window.location.assign('/sign-in')
  }
  await worker.start({ onUnhandledFrame: 'bypass', quiet: true })
}
