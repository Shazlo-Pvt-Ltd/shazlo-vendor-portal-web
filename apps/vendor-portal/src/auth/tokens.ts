import type { Tokens, TokenStore } from '../api/client'

const KEY = 'shazlo.seller.session'

export interface SessionStore extends TokenStore {
  // "Keep me signed in" keeps tokens in localStorage; otherwise they end with the tab.
  set(tokens: Tokens | null, remember?: boolean): void
  subscribe(listener: () => void): () => void
}

function read(storage: Storage | undefined): Tokens | null {
  try {
    const raw = storage?.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as Partial<Tokens>) : null
    return parsed?.access_token && parsed.refresh_token ? { access_token: parsed.access_token, refresh_token: parsed.refresh_token } : null
  } catch {
    return null
  }
}

function safe(fn: () => void) {
  try {
    fn()
  } catch {
    // Storage can be blocked (private mode); the session then lasts for this page only.
  }
}

export function createSessionStore(): SessionStore {
  const local = typeof localStorage === 'undefined' ? undefined : localStorage
  const session = typeof sessionStorage === 'undefined' ? undefined : sessionStorage
  let remember = read(local) !== null
  let current = read(local) ?? read(session)
  const listeners = new Set<() => void>()

  return {
    get: () => current,
    set(tokens, keep) {
      if (keep !== undefined) remember = keep
      current = tokens
      safe(() => local?.removeItem(KEY))
      safe(() => session?.removeItem(KEY))
      if (tokens) safe(() => (remember ? local : session)?.setItem(KEY, JSON.stringify(tokens)))
      listeners.forEach((l) => l())
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
