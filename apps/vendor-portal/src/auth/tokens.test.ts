import { describe, expect, it, vi } from 'vitest'
import { createSessionStore } from './tokens'

const storedValues = () =>
  [localStorage, sessionStorage].flatMap((storage) => Array.from({ length: storage.length }, (_, i) => storage.getItem(storage.key(i)!) ?? ''))

describe('createSessionStore', () => {
  it('keeps the access token in memory and writes nothing to web storage', () => {
    const store = createSessionStore()
    expect(store.status()).toBe('loading')
    store.set('access-1')
    expect(store.get()).toBe('access-1')
    expect(store.status()).toBe('signedIn')
    expect(storedValues()).toEqual([])
  })

  it('ends as signed out and tells its listeners', () => {
    const store = createSessionStore()
    const listener = vi.fn()
    const stop = store.subscribe(listener)
    store.set('access-1')
    store.set(null)
    expect(store.get()).toBeNull()
    expect(store.status()).toBe('signedOut')
    expect(listener).toHaveBeenCalledTimes(2)
    stop()
    store.set('access-2')
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('removes the tokens that earlier builds left in web storage', () => {
    const old = JSON.stringify({ access_token: 'a', refresh_token: 'r' })
    localStorage.setItem('shazlo.seller.session', old)
    sessionStorage.setItem('shazlo.seller.session', old)
    localStorage.setItem('shazlo.seller.application-draft.v2', '{}')
    const store = createSessionStore()
    expect(localStorage.getItem('shazlo.seller.session')).toBeNull()
    expect(sessionStorage.getItem('shazlo.seller.session')).toBeNull()
    // Nothing else is touched, and the old tokens are not taken up.
    expect(localStorage.getItem('shazlo.seller.application-draft.v2')).toBe('{}')
    expect(store.get()).toBeNull()
    expect(store.status()).toBe('loading')
  })
})
