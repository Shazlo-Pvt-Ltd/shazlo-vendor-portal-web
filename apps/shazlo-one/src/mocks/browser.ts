import { setupWorker } from 'msw/browser'
import { createIdentityDb, createIdentityHandlers, type IdentityDb } from './identity'

// Browser copy of the identity mock. Its state (admins and the modelled refresh cookie) survives
// reloads in localStorage, as the real HttpOnly cookie would. shazloOneResetDemo() starts over.
const KEY = 'shazlo.one.mock-identity.v1'

function load(): IdentityDb {
  const fresh = createIdentityDb()
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
    localStorage.removeItem(KEY)
    window.location.assign('/sign-in')
  }
  await worker.start({ onUnhandledRequest: 'bypass', quiet: true })
}
