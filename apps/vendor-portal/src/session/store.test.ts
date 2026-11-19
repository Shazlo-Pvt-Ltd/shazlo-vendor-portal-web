import { afterEach, describe, expect, it, vi } from 'vitest'
import { NetworkError } from '../api/errors'
import { registerSensitiveReset } from '../security/sensitiveState'
import { clearDrafts, saveDraft, takeDraft } from './drafts'
import { isSessionResponse } from './store'
import { apiError, fakeChannels, makeStore, sessionBody } from './testing'

afterEach(() => {
  clearDrafts()
  vi.useRealTimers()
})

describe('restoring the session on load', () => {
  it('signs in from the refresh cookie, with the role, the vendor and no storage use', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const { store } = makeStore()
    expect(store.getSnapshot().status).toBe('loading')
    await store.start()
    expect(store.getSnapshot()).toMatchObject({ status: 'signedIn', role: 'owner', vendor: { status: 'approved' } })
    expect(store.getAccessToken()).toBe('token-1')
    expect(setItem).not.toHaveBeenCalled()
    expect(JSON.stringify({ ...localStorage })).not.toContain('token-1')
    store.close()
  })

  it('treats an unrecognised role as staff', async () => {
    const { store } = makeStore({ refresh: async () => sessionBody({ role: 'admin' }) })
    await store.start()
    expect(store.getSnapshot().role).toBe('staff')
    store.close()
  })

  it('is signed out on a 401 and clears the caches', async () => {
    const onCleared = vi.fn()
    const { store } = makeStore({ refresh: async () => { throw apiError(401, 'unauthorized') }, onCleared })
    await store.start()
    expect(store.getSnapshot()).toMatchObject({ status: 'signedOut', expired: false })
    expect(onCleared).toHaveBeenCalledOnce()
    store.close()
  })

  it('is blocked, not signed out, for a rejected or suspended vendor', async () => {
    const { store } = makeStore({ refresh: async () => { throw apiError(403, 'vendor_not_allowed') } })
    await store.start()
    expect(store.getSnapshot().status).toBe('blocked')
    store.close()
  })

  it('is unavailable, not signed out, when the server cannot be reached; retry recovers', async () => {
    let down = true
    const { store } = makeStore({
      refresh: async () => {
        if (down) throw new NetworkError('network')
        return sessionBody()
      },
    })
    await store.start()
    expect(store.getSnapshot().status).toBe('unavailable')
    down = false
    await store.retry()
    expect(store.getSnapshot().status).toBe('signedIn')
    store.close()
  })

  it('calling start twice refreshes once', async () => {
    const refresh = vi.fn(async () => sessionBody())
    const { store } = makeStore({ refresh })
    await Promise.all([store.start(), store.start()])
    expect(refresh).toHaveBeenCalledTimes(1)
    store.close()
  })
})

describe('renewal', () => {
  it('shares one refresh between concurrent callers', async () => {
    let calls = 0
    const { store } = makeStore({
      refresh: async () => {
        calls += 1
        await new Promise((resolve) => setTimeout(resolve, 20))
        return sessionBody({ token: `t${calls}` })
      },
    })
    await store.start()
    calls = 0
    const results = await Promise.all(Array.from({ length: 10 }, () => store.renew()))
    expect(results.every(Boolean)).toBe(true)
    expect(calls).toBe(1)
    store.close()
  })

  it('waits and retries once on 409 refresh_conflict', async () => {
    let calls = 0
    const { store } = makeStore({
      refresh: async () => {
        calls += 1
        if (calls === 1) throw apiError(409, 'refresh_conflict')
        return sessionBody({ token: 'after-conflict' })
      },
    })
    await store.start()
    expect(calls).toBe(2)
    expect(store.getAccessToken()).toBe('after-conflict')
    store.close()
  })

  it('gives up after a second 409', async () => {
    const { store } = makeStore({ refresh: async () => { throw apiError(409, 'refresh_conflict') } })
    await store.start()
    expect(store.getSnapshot().status).toBe('unavailable')
    store.close()
  })

  it('renews before the token expires', async () => {
    vi.useFakeTimers()
    let calls = 0
    const { store } = makeStore({
      refresh: async () => {
        calls += 1
        return sessionBody({ token: `t${calls}`, expires_in: 900 })
      },
    })
    await store.start()
    expect(calls).toBe(1)
    await vi.advanceTimersByTimeAsync(719_000)
    expect(calls).toBe(1)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(calls).toBe(2)
    expect(store.getAccessToken()).toBe('t2')
    store.close()
  })

  it('ends the session, flagged expired, when renewal gets a 401 mid-work, and keeps unsaved drafts', async () => {
    let answer: 'ok' | 'denied' = 'ok'
    const { store } = makeStore({
      refresh: async () => {
        if (answer === 'denied') throw apiError(401, 'unauthorized')
        return sessionBody()
      },
    })
    await store.start()
    saveDraft('product:new', { name: 'Kurta' })
    answer = 'denied'
    expect(await store.renew()).toBe(false)
    expect(store.getSnapshot()).toMatchObject({ status: 'signedOut', expired: true })
    expect(store.getAccessToken()).toBeNull()
    expect(takeDraft('product:new')).toEqual({ name: 'Kurta' })
    store.close()
  })

  it('keeps the session when renewal fails for a network reason', async () => {
    let down = false
    const { store } = makeStore({
      refresh: async () => {
        if (down) throw new NetworkError('network')
        return sessionBody()
      },
    })
    await store.start()
    down = true
    expect(await store.renew()).toBe(false)
    expect(store.getSnapshot().status).toBe('signedIn')
    store.close()
  })
})

describe('renewal edge cases', () => {
  it('retries 15 seconds after a renewal the network failed, and recovers without signing out', async () => {
    vi.useFakeTimers()
    let down = false
    let calls = 0
    const { store } = makeStore({
      refresh: async () => {
        calls += 1
        if (down) throw new NetworkError('network')
        return sessionBody({ token: `t${calls}` })
      },
    })
    await store.start()
    down = true
    expect(await store.renew()).toBe(false)
    expect(calls).toBe(2)
    down = false
    await vi.advanceTimersByTimeAsync(14_000)
    expect(calls).toBe(2)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(calls).toBe(3)
    expect(store.getSnapshot().status).toBe('signedIn')
    expect(store.getAccessToken()).toBe('t3')
    store.close()
  })

  it('a server error (5xx) while signed in is treated like the network: the session stays', async () => {
    let failing = false
    const onCleared = vi.fn()
    const { store } = makeStore({
      refresh: async () => {
        if (failing) throw apiError(503, 'unavailable')
        return sessionBody({ token: 'kept' })
      },
      onCleared,
    })
    await store.start()
    failing = true
    expect(await store.renew()).toBe(false)
    expect(store.getSnapshot().status).toBe('signedIn')
    expect(store.getAccessToken()).toBe('kept')
    expect(onCleared).not.toHaveBeenCalled()
    store.close()
  })

  it('blocks a vendor suspended mid-session: token, drafts and sensitive forms are gone', async () => {
    let suspended = false
    const reset = vi.fn()
    const undo = registerSensitiveReset(reset)
    const onCleared = vi.fn()
    const { store } = makeStore({
      refresh: async () => {
        if (suspended) throw apiError(403, 'vendor_not_allowed')
        return sessionBody()
      },
      onCleared,
    })
    await store.start()
    saveDraft('product:new', { name: 'Kurta' })
    suspended = true
    expect(await store.renew()).toBe(false)
    expect(store.getSnapshot()).toMatchObject({ status: 'blocked', user: null, vendor: null, role: null })
    expect(store.getAccessToken()).toBeNull()
    expect(takeDraft('product:new')).toBeUndefined()
    expect(reset).toHaveBeenCalledOnce()
    expect(onCleared).toHaveBeenCalledOnce()
    undo()
    store.close()
  })

  it('ends the session on an answer it does not understand, rather than keeping a half session', async () => {
    let broken = false
    const { store } = makeStore({
      refresh: async () => {
        if (broken) throw new TypeError('not a session')
        return sessionBody()
      },
    })
    await store.start()
    broken = true
    expect(await store.renew()).toBe(false)
    expect(store.getSnapshot()).toMatchObject({ status: 'signedOut', expired: true })
    expect(store.getAccessToken()).toBeNull()
    store.close()
  })

  it('ignores a refresh that answers after the store was closed', async () => {
    let answer: (value: ReturnType<typeof sessionBody>) => void = () => {}
    const { store } = makeStore({ refresh: () => new Promise((resolve) => { answer = resolve }) })
    const started = store.start()
    store.close()
    answer(sessionBody({ token: 'too-late' }))
    await started
    expect(store.getAccessToken()).toBeNull()
    expect(store.getSnapshot().status).toBe('loading')
  })

  it('stops renewing after logout: no refresh fires once the session is over', async () => {
    vi.useFakeTimers()
    const refresh = vi.fn(async () => sessionBody({ expires_in: 60 }))
    const { store } = makeStore({ refresh })
    await store.start()
    await store.logout()
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(refresh).toHaveBeenCalledOnce()
    store.close()
  })

  it('never schedules a renewal sooner than a second, whatever expires_in says', async () => {
    vi.useFakeTimers()
    const refresh = vi.fn(async () => sessionBody({ expires_in: 0 }))
    const { store } = makeStore({ refresh })
    await store.start()
    await vi.advanceTimersByTimeAsync(999)
    expect(refresh).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(2)
    expect(refresh).toHaveBeenCalledTimes(2)
    store.close()
  })
})

describe('messages from other tabs', () => {
  it('ignores anything but the two words, and a login while already signed in', async () => {
    const channel = { onmessage: null as ((event: MessageEvent) => void) | null, postMessage: () => {}, close: () => {} }
    const refresh = vi.fn(async () => sessionBody())
    const onCleared = vi.fn()
    const { store } = makeStore({ channel, refresh, onCleared })
    await store.start()
    for (const data of [null, 'logout', { type: 'LOGOUT' }, { kind: 'logout' }, 42, { type: 'login', token: 'x' }]) {
      channel.onmessage?.({ data } as MessageEvent)
    }
    await Promise.resolve()
    expect(store.getSnapshot().status).toBe('signedIn')
    expect(refresh).toHaveBeenCalledOnce()
    expect(onCleared).not.toHaveBeenCalled()
    store.close()
  })

  it('a logout from another tab while already signed out changes nothing', async () => {
    const channel = { onmessage: null as ((event: MessageEvent) => void) | null, postMessage: () => {}, close: () => {} }
    const onCleared = vi.fn()
    const { store } = makeStore({ channel, refresh: async () => { throw apiError(401, 'unauthorized') }, onCleared })
    await store.start()
    expect(onCleared).toHaveBeenCalledOnce()
    channel.onmessage?.({ data: { type: 'logout' } } as MessageEvent)
    expect(onCleared).toHaveBeenCalledOnce()
    expect(store.getSnapshot()).toMatchObject({ status: 'signedOut', signedOutByUser: false })
    store.close()
  })

  it('stops listening once closed', async () => {
    const channel = { onmessage: null as ((event: MessageEvent) => void) | null, postMessage: () => {}, close: vi.fn() }
    const { store } = makeStore({ channel })
    await store.start()
    store.close()
    expect(channel.onmessage).toBeNull()
    expect(channel.close).toHaveBeenCalledOnce()
  })
})

describe('isSessionResponse', () => {
  it.each([
    ['null', null],
    ['a string', 'token'],
    ['no token', { ...sessionBody(), access_token: undefined }],
    ['a numeric token', { ...sessionBody(), access_token: 5 }],
    ['expires_in as text', { ...sessionBody(), expires_in: '900' }],
    ['no user', { ...sessionBody(), user: null }],
    ['no vendor', { ...sessionBody(), vendor: undefined }],
  ])('refuses %s', (_name, value) => expect(isSessionResponse(value)).toBe(false))

  it('accepts a session', () => expect(isSessionResponse(sessionBody())).toBe(true))
})

describe('sensitive form state', () => {
  it('is cleared when the session ends, by logout or by expiry', async () => {
    const reset = vi.fn()
    const undo = registerSensitiveReset(reset)
    const { store } = makeStore()
    await store.start()
    await store.logout()
    expect(reset).toHaveBeenCalledTimes(1)
    const expiring = makeStore({ refresh: async () => { throw apiError(401, 'unauthorized') } })
    await expiring.store.start()
    expect(reset).toHaveBeenCalledTimes(2)
    undo()
    store.close()
    expiring.store.close()
  })
})

describe('logout and other tabs', () => {
  it('logout calls the server, clears token, caches and drafts, and still ends if the call fails', async () => {
    const logout = vi.fn(async () => { throw new NetworkError('network') })
    const onCleared = vi.fn()
    const { store } = makeStore({ logout, onCleared })
    await store.start()
    saveDraft('k', 1)
    await store.logout()
    expect(logout).toHaveBeenCalledOnce()
    expect(store.getSnapshot()).toMatchObject({ status: 'signedOut', expired: false })
    expect(store.getAccessToken()).toBeNull()
    expect(onCleared).toHaveBeenCalled()
    expect(takeDraft('k')).toBeUndefined()
    store.close()
  })

  it('remembers that the user signed out, as opposed to the session running out', async () => {
    const { store } = makeStore()
    await store.start()
    await store.logout()
    expect(store.getSnapshot()).toMatchObject({ status: 'signedOut', signedOutByUser: true, expired: false })
    const expiring = makeStore({ refresh: async () => { throw apiError(401, 'unauthorized') } })
    await expiring.store.start()
    expect(expiring.store.getSnapshot().signedOutByUser).toBe(false)
    store.close()
    expiring.store.close()
  })

  it('a logout in one tab signs out the other, which does not call the server again', async () => {
    const channel = fakeChannels()
    const a = makeStore({ channel: channel() })
    const logoutB = vi.fn(async () => {})
    const b = makeStore({ channel: channel(), logout: logoutB })
    await Promise.all([a.store.start(), b.store.start()])
    await a.store.logout()
    expect(b.store.getSnapshot().status).toBe('signedOut')
    expect(logoutB).not.toHaveBeenCalled()
    a.store.close()
    b.store.close()
  })

  it('a login in one tab makes the other renew with its own cookie, never receiving a token', async () => {
    const channel = fakeChannels()
    let cookieValid = false
    const a = makeStore({ channel: channel(), refresh: async () => { throw apiError(401, 'unauthorized') } })
    const b = makeStore({
      channel: channel(),
      refresh: async () => {
        if (!cookieValid) throw apiError(401, 'unauthorized')
        return sessionBody({ token: 'tab-b-own-token' })
      },
    })
    await Promise.all([a.store.start(), b.store.start()])
    expect(b.store.getSnapshot().status).toBe('signedOut')
    cookieValid = true
    a.store.signIn(sessionBody({ token: 'tab-a-token' }))
    await vi.waitFor(() => expect(b.store.getSnapshot().status).toBe('signedIn'))
    expect(b.store.getAccessToken()).toBe('tab-b-own-token')
    a.store.close()
    b.store.close()
  })

  it('only ever sends the words login and logout between tabs', async () => {
    const sent: unknown[] = []
    const channel = { onmessage: null, postMessage: (d: unknown) => sent.push(d), close: () => {} }
    const { store } = makeStore({ channel })
    await store.start()
    store.signIn(sessionBody({ token: 'secret-token' }))
    await store.logout()
    expect(sent).toEqual([{ type: 'login' }, { type: 'logout' }])
    expect(JSON.stringify(sent)).not.toContain('secret-token')
    store.close()
  })
})
