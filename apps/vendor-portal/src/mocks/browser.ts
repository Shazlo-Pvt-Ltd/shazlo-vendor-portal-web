import { setupWorker } from 'msw/browser'
import { createDb, type MockDb } from './db'
import { createHandlers } from './handlers'

// Browser copy of the mock API. Its data survives reloads (localStorage), so a reviewer can
// sign in, edit and refresh. That includes the modelled refresh cookie (db.sessions.cookie), so a
// reload stays signed in, as the real HttpOnly cookie would; the portal itself stores no token.
// Clear the key, or call window.shazloResetDemo(), to start over.
// v2: Build 2 data (store details, commission, size charts, new product fields).
const KEY = 'shazlo.seller.mock-db.v2'

type Stored = Omit<MockDb, 'now' | 'sessions' | 'invites' | 'uploads' | 'imports'> & {
  sessions: { access: [string, number][]; refresh: string[]; cookie?: string | null }
  invites: [string, { email: string; brand_name: string; owner_name: string }][]
  uploads: [string, string][]
  imports: [string, MockDb['imports'] extends Map<string, infer V> ? V : never][]
}

function load(): MockDb {
  const fresh = createDb()
  try {
    localStorage.removeItem('shazlo.seller.mock-db.v1')
    const raw = localStorage.getItem(KEY)
    if (!raw) return fresh
    const s = JSON.parse(raw) as Stored
    return {
      ...fresh,
      ...s,
      now: fresh.now,
      sessions: { access: new Map(s.sessions.access), refresh: new Set(s.sessions.refresh), cookie: s.sessions.cookie ?? null },
      invites: new Map(s.invites),
      uploads: new Map(s.uploads),
      imports: new Map(s.imports),
    }
  } catch {
    return fresh
  }
}

function save(db: MockDb) {
  const { now: _now, ...rest } = db
  const stored: Stored = {
    ...rest,
    sessions: { access: [...db.sessions.access], refresh: [...db.sessions.refresh], cookie: db.sessions.cookie },
    invites: [...db.invites],
    uploads: [...db.uploads],
    imports: [...db.imports],
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(stored))
  } catch {
    // Large uploaded photos can exceed the storage quota; the demo then resets on reload.
  }
}

export async function startMockApi() {
  let db = load()
  const worker = setupWorker(...createHandlers(() => db))
  worker.events.on('response:mocked', ({ request }) => {
    if (request.method !== 'GET') save(db)
  })
  ;(window as unknown as { shazloResetDemo: () => void }).shazloResetDemo = () => {
    db = createDb()
    localStorage.removeItem(KEY)
    window.location.assign('/sign-in')
  }
  await worker.start({ onUnhandledRequest: 'bypass', quiet: true })
}
