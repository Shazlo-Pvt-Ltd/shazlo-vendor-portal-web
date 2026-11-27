import { afterEach, describe, expect, it, vi } from 'vitest'
import { NetworkError } from '../api/errors'
import { registerSensitiveReset } from '../security/sensitiveState'
import {
  AudienceNotAllowedError,
  NotSignedInError,
  UnknownAudienceError,
  isAdminProfile,
  isSessionResponse,
  isTokenResponse,
} from './store'
import { adminProfile, apiError, fakeChannels, makeStore, sessionBody } from './testing'

afterEach(() => {
  vi.useRealTimers()
})

describe('restoring the session on load', () => {
  it('signs in from the refresh cookie with the profile from /v1/me, and writes nothing to storage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const { store } = makeStore({
      fetchMe: async () => adminProfile({ display_name: 'From Me', roles: ['reviewer'] }),
    })
    expect(store.getSnapshot().status).toBe('loading')
    await store.start()
    expect(store.getSnapshot()).toMatchObject({
      status: 'signedIn',
      roles: ['reviewer'],
      admin: { display_name: 'From Me' },
    })
    expect(store.getAccessToken()).toBe('token-1')
    expect(setItem).not.toHaveBeenCalled()
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain('token-1')
    store.close()
  })

  it('asks /v1/me with the new token, which the store has not adopted yet', async () => {
    const fetchMe = vi.fn(async () => adminProfile())
    const { store } = makeStore({ fetchMe, refresh: async () => sessionBody({ token: 'fresh' }) })
    await store.start()
    expect(fetchMe).toHaveBeenCalledWith('fresh')
    store.close()
  })

  it('is signed out on a 401 and clears the caches', async () => {
    const onCleared = vi.fn()
    const { store } = makeStore({ refresh: async () => { throw apiError(401, 'unauthorized') }, onCleared })
    await store.start()
    expect(store.getSnapshot()).toMatchObject({ status: 'signedOut', expired: false, admin: null, roles: [] })
    expect(onCleared).toHaveBeenCalledOnce()
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

  it('is unavailable when /v1/me cannot be reached, and holds no half session', async () => {
    const { store } = makeStore({ fetchMe: async () => { throw new NetworkError('timeout') } })
    await store.start()
    expect(store.getSnapshot().status).toBe('unavailable')
    expect(store.getAccessToken()).toBeNull()
    store.close()
  })

  it('calling start twice refreshes once', async () => {
    const refresh = vi.fn(async () => sessionBody())
    const { store } = makeStore({ refresh })
    await Promise.all([store.start(), store.start()])
    expect(refresh).toHaveBeenCalledTimes(1)
    store.close()
  })

  it('does not trust an answer that is not a session', async () => {
    const { store } = makeStore({ refresh: async () => ({ access_token: 'x' }) as never })
    await store.start()
    expect(store.getAccessToken()).toBeNull()
    expect(store.getSnapshot().status).toBe('unavailable')
    store.close()
  })
})

describe('an admin who must change their password', () => {
  it('is held at that step with no roles, and /v1/me is never asked (it refuses that token)', async () => {
    const fetchMe = vi.fn(async () => adminProfile())
    const { store } = makeStore({
      refresh: async () => sessionBody({ must_change_password: true, roles: ['super_admin'] }),
      fetchMe,
    })
    await store.start()
    expect(store.getSnapshot()).toMatchObject({ status: 'passwordChangeRequired', roles: [] })
    expect(store.getSnapshot().admin?.email).toBe('admin@shazlo.test')
    expect(fetchMe).not.toHaveBeenCalled()
    store.close()
  })

  it('gets no module tokens', async () => {
    const exchange = vi.fn()
    const { store } = makeStore({ refresh: async () => sessionBody({ must_change_password: true }), exchange })
    await store.start()
    await expect(store.getModuleToken('vendor-admin')).rejects.toBeInstanceOf(NotSignedInError)
    expect(exchange).not.toHaveBeenCalled()
    store.close()
  })

  it('becomes a normal session when sign-in returns the new token, and tells the other tabs', async () => {
    const channels = fakeChannels()
    const a = makeStore({ channel: channels(), refresh: async () => sessionBody({ must_change_password: true }) }).store
    const b = makeStore({ channel: channels(), refresh: async () => sessionBody({ must_change_password: true }) }).store
    await Promise.all([a.start(), b.start()])
    const refresh = vi.fn(async () => sessionBody({ token: 'normal' }))
    // Tab B's next refresh finds the new cookie.
    ;(b as unknown as { deps: { refresh: typeof refresh } }).deps.refresh = refresh
    a.signIn(sessionBody({ token: 'normal' }))
    expect(a.getSnapshot()).toMatchObject({ status: 'signedIn', roles: ['super_admin'] })
    await vi.waitFor(() => expect(b.getSnapshot().status).toBe('signedIn'))
    a.close()
    b.close()
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

  it('gives up after a second 409, without signing out', async () => {
    const { store } = makeStore({ refresh: async () => { throw apiError(409, 'refresh_conflict') } })
    await store.start()
    expect(store.getSnapshot().status).toBe('unavailable')
    store.close()
  })

  it('renews at 80% of the token life, not before', async () => {
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

  it('ends the session, flagged expired, when renewal gets a 401 mid-work, and runs the clean-up', async () => {
    let answer: 'ok' | 'denied' = 'ok'
    const reset = vi.fn()
    const undo = registerSensitiveReset(reset)
    const onCleared = vi.fn()
    const { store } = makeStore({
      refresh: async () => {
        if (answer === 'denied') throw apiError(401, 'unauthorized')
        return sessionBody()
      },
      onCleared,
    })
    await store.start()
    answer = 'denied'
    expect(await store.renew()).toBe(false)
    expect(store.getSnapshot()).toMatchObject({ status: 'signedOut', expired: true, admin: null, roles: [] })
    expect(store.getAccessToken()).toBeNull()
    expect(reset).toHaveBeenCalledOnce()
    expect(onCleared).toHaveBeenCalledOnce()
    undo()
    store.close()
  })

  it('keeps the session when renewal fails for a network reason, and tries again in 15 seconds', async () => {
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
    expect(store.getSnapshot().status).toBe('signedIn')
    expect(calls).toBe(2)
    down = false
    await vi.advanceTimersByTimeAsync(14_000)
    expect(calls).toBe(2)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(calls).toBe(3)
    expect(store.getAccessToken()).toBe('t3')
    store.close()
  })

  it('treats a server error (5xx) while signed in like the network: the session stays', async () => {
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

  it('ends the session on a failure it does not understand, rather than keep a half session', async () => {
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

  it('stops renewing after logout', async () => {
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
    const refresh = vi.fn(async () => sessionBody({ expires_in: 1 }))
    const { store } = makeStore({ refresh })
    await store.start()
    await vi.advanceTimersByTimeAsync(999)
    expect(refresh).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(2)
    expect(refresh).toHaveBeenCalledTimes(2)
    store.close()
  })
})

describe('signing out', () => {
  it('calls the server, ends the session, clears caches and sensitive forms, and is flagged as the admin’s choice', async () => {
    const logout = vi.fn(async () => {})
    const onCleared = vi.fn()
    const reset = vi.fn()
    const undo = registerSensitiveReset(reset)
    const { store } = makeStore({ logout, onCleared })
    await store.start()
    await store.logout()
    expect(logout).toHaveBeenCalledOnce()
    expect(store.getSnapshot()).toMatchObject({ status: 'signedOut', signedOutByUser: true, expired: false })
    expect(store.getAccessToken()).toBeNull()
    expect(reset).toHaveBeenCalledOnce()
    expect(onCleared).toHaveBeenCalledOnce()
    undo()
    store.close()
  })

  it('ends the session even when the server cannot be told', async () => {
    const { store } = makeStore({ logout: async () => { throw new NetworkError('network') } })
    await store.start()
    await store.logout()
    expect(store.getSnapshot().status).toBe('signedOut')
    store.close()
  })
})

describe('a sign-out while a renewal is under way', () => {
  type Body = ReturnType<typeof sessionBody>

  it('is not undone when the refresh answers afterwards', async () => {
    let answer: (value: Body) => void = () => {}
    let calls = 0
    const refresh = () => {
      calls += 1
      if (calls === 1) return Promise.resolve(sessionBody({ token: 't1' }))
      return new Promise<Body>((resolve) => {
        answer = resolve
      })
    }
    const { store } = makeStore({ refresh })
    await store.start()
    const renewing = store.renew()
    await store.logout()
    answer(sessionBody({ token: 'too-late' }))
    expect(await renewing).toBe(false)
    expect(store.getSnapshot()).toMatchObject({ status: 'signedOut', signedOutByUser: true })
    expect(store.getAccessToken()).toBeNull()
    store.close()
  })

  it('is not undone when /v1/me answers afterwards', async () => {
    let answer: (value: ReturnType<typeof adminProfile>) => void = () => {}
    let calls = 0
    const fetchMe = () => {
      calls += 1
      if (calls === 1) return Promise.resolve(adminProfile())
      return new Promise<ReturnType<typeof adminProfile>>((resolve) => {
        answer = resolve
      })
    }
    const { store } = makeStore({ fetchMe })
    await store.start()
    const renewing = store.renew()
    await vi.waitFor(() => expect(calls).toBe(2))
    await store.logout()
    answer(adminProfile())
    expect(await renewing).toBe(false)
    expect(store.getSnapshot().status).toBe('signedOut')
    expect(store.getAccessToken()).toBeNull()
    store.close()
  })

  it('from another tab wins over this tab’s renewal', async () => {
    const channels = fakeChannels()
    let answer: (value: Body) => void = () => {}
    let calls = 0
    const refresh = () => {
      calls += 1
      if (calls === 1) return Promise.resolve(sessionBody())
      return new Promise<Body>((resolve) => {
        answer = resolve
      })
    }
    const a = makeStore({ channel: channels() }).store
    const b = makeStore({ channel: channels(), refresh }).store
    await Promise.all([a.start(), b.start()])
    const renewing = b.renew()
    await a.logout()
    answer(sessionBody({ token: 'too-late' }))
    await renewing
    expect(b.getSnapshot().status).toBe('signedOut')
    expect(b.getAccessToken()).toBeNull()
    a.close()
    b.close()
  })

  it('keeps the admin’s choice when the refresh then fails with a 401', async () => {
    let fail: (error: unknown) => void = () => {}
    let calls = 0
    const refresh = () => {
      calls += 1
      if (calls === 1) return Promise.resolve(sessionBody())
      return new Promise<Body>((_resolve, reject) => {
        fail = reject
      })
    }
    const { store } = makeStore({ refresh })
    await store.start()
    const renewing = store.renew()
    await store.logout()
    fail(apiError(401, 'invalid_refresh_token'))
    await renewing
    expect(store.getSnapshot()).toMatchObject({ status: 'signedOut', signedOutByUser: true, expired: false })
    store.close()
  })
})

describe('tabs', () => {
  it('signing out in one tab signs out every tab, and no token travels', async () => {
    const channels = fakeChannels()
    const sent: unknown[] = []
    const first = channels()
    const original = first.postMessage
    first.postMessage = (data) => {
      sent.push(data)
      original(data)
    }
    const onClearedB = vi.fn()
    const a = makeStore({ channel: first }).store
    const b = makeStore({ channel: channels(), onCleared: onClearedB }).store
    await Promise.all([a.start(), b.start()])
    await a.logout()
    expect(b.getSnapshot()).toMatchObject({ status: 'signedOut', signedOutByUser: true })
    expect(b.getAccessToken()).toBeNull()
    expect(onClearedB).toHaveBeenCalledOnce()
    expect(sent).toEqual([{ type: 'logout' }])
    expect(JSON.stringify(sent)).not.toContain('token')
    a.close()
    b.close()
  })

  it('signing in in one tab restores the session in a signed-out tab, sending only the word login', async () => {
    const channels = fakeChannels()
    const sent: unknown[] = []
    const first = channels()
    const original = first.postMessage
    first.postMessage = (data) => {
      sent.push(data)
      original(data)
    }
    let cookie = false
    const a = makeStore({ channel: first, refresh: async () => { throw apiError(401, 'unauthorized') } }).store
    const b = makeStore({
      channel: channels(),
      refresh: async () => {
        if (!cookie) throw apiError(401, 'unauthorized')
        return sessionBody({ token: 'b-token' })
      },
    }).store
    await Promise.all([a.start(), b.start()])
    cookie = true
    a.signIn(sessionBody())
    expect(sent).toEqual([{ type: 'login' }])
    await vi.waitFor(() => expect(b.getSnapshot().status).toBe('signedIn'))
    expect(b.getAccessToken()).toBe('b-token')
    a.close()
    b.close()
  })

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

  it('stops listening once closed', async () => {
    const channel = { onmessage: null as ((event: MessageEvent) => void) | null, postMessage: () => {}, close: vi.fn() }
    const { store } = makeStore({ channel })
    await store.start()
    store.close()
    expect(channel.onmessage).toBeNull()
    expect(channel.close).toHaveBeenCalledOnce()
  })
})

describe('module tokens', () => {
  it('exchanges once per module and reuses the token while it lasts', async () => {
    const exchange = vi.fn(async (audience: string) => ({
      access_token: `m-${audience}`,
      token_type: 'Bearer',
      expires_in: 300,
      audience,
    }))
    const { store } = makeStore({ exchange })
    await store.start()
    const [one, two] = await Promise.all([store.getModuleToken('vendor-admin'), store.getModuleToken('vendor-admin')])
    expect(one).toBe(two)
    expect(one.accessToken).toBe('m-vendor-admin')
    await store.getModuleToken('vendor-admin')
    expect(exchange).toHaveBeenCalledOnce()
    expect(exchange).toHaveBeenCalledWith('vendor-admin', 'token-1')
    await store.getModuleToken('other')
    expect(exchange).toHaveBeenCalledTimes(2)
    store.close()
  })

  it('exchanges again once the module token is near its end', async () => {
    vi.useFakeTimers()
    const exchange = vi.fn(async (audience: string) => ({
      access_token: `m${exchange.mock.calls.length}`,
      token_type: 'Bearer',
      expires_in: 300,
      audience,
    }))
    const { store } = makeStore({ exchange, refresh: async () => sessionBody({ expires_in: 3600 }) })
    await store.start()
    expect((await store.getModuleToken('m')).accessToken).toBe('m1')
    await vi.advanceTimersByTimeAsync(295_000)
    expect((await store.getModuleToken('m')).accessToken).toBe('m2')
    store.close()
  })

  it('never keeps a module token past the identity token’s own expiry', async () => {
    vi.useFakeTimers()
    const { store } = makeStore({
      refresh: async () => sessionBody({ expires_in: 60 }),
      exchange: async (audience) => ({ access_token: 'm', token_type: 'Bearer', expires_in: 300, audience }),
    })
    await store.start()
    const issuedAt = Date.now()
    const token = await store.getModuleToken('m')
    expect(token.expiresAt).toBe(issuedAt + 60_000)
    store.close()
  })

  it('renews the identity token first when it is about to end', async () => {
    vi.useFakeTimers()
    const refresh = vi.fn(async () => sessionBody({ token: `t${refresh.mock.calls.length}`, expires_in: 900 }))
    const exchange = vi.fn(async (audience: string, token: string) => ({
      access_token: `m-for-${token}`,
      token_type: 'Bearer',
      expires_in: 300,
      audience,
    }))
    // Renewal is off here so only the exchange can trigger one.
    const { store } = makeStore({ refresh, exchange, renewAt: 100 })
    await store.start()
    await vi.advanceTimersByTimeAsync(895_000)
    const token = await store.getModuleToken('m')
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(token.accessToken).toBe('m-for-t2')
    store.close()
  })

  it('renews once and tries again when identity-api refuses the identity token', async () => {
    let first = true
    const exchange = vi.fn(async (audience: string, token: string) => {
      if (first) {
        first = false
        throw apiError(401, 'unauthorized')
      }
      return { access_token: `m-for-${token}`, token_type: 'Bearer', expires_in: 300, audience }
    })
    let n = 0
    const { store } = makeStore({ exchange, refresh: async () => sessionBody({ token: `t${(n += 1)}` }) })
    await store.start()
    const token = await store.getModuleToken('m')
    expect(token.accessToken).toBe('m-for-t2')
    expect(exchange).toHaveBeenCalledTimes(2)
    store.close()
  })

  it('surfaces 403 audience_not_allowed and 400 unknown_audience as typed errors, and does not cache them', async () => {
    const exchange = vi.fn(async (audience: string) => {
      if (audience === 'forbidden') throw apiError(403, 'audience_not_allowed')
      throw apiError(400, 'unknown_audience')
    })
    const { store } = makeStore({ exchange })
    await store.start()
    await expect(store.getModuleToken('forbidden')).rejects.toMatchObject({
      name: 'AudienceNotAllowedError',
      audience: 'forbidden',
    })
    await expect(store.getModuleToken('forbidden')).rejects.toBeInstanceOf(AudienceNotAllowedError)
    await expect(store.getModuleToken('nope')).rejects.toBeInstanceOf(UnknownAudienceError)
    expect(exchange).toHaveBeenCalledTimes(3)
    store.close()
  })

  it('passes other failures through untouched', async () => {
    const { store } = makeStore({ exchange: async () => { throw new NetworkError('network') } })
    await store.start()
    await expect(store.getModuleToken('m')).rejects.toBeInstanceOf(NetworkError)
    store.close()
  })

  it('forgets every module token when the session ends, and hands out none to the next admin', async () => {
    const exchange = vi.fn(async (audience: string, token: string) => ({
      access_token: `m-for-${token}`,
      token_type: 'Bearer',
      expires_in: 300,
      audience,
    }))
    let n = 0
    const { store } = makeStore({ exchange, refresh: async () => sessionBody({ token: `t${(n += 1)}` }) })
    await store.start()
    await store.getModuleToken('m')
    await store.logout()
    await expect(store.getModuleToken('m')).rejects.toBeInstanceOf(NotSignedInError)
    store.signIn(sessionBody({ token: 'next-admin' }))
    expect((await store.getModuleToken('m')).accessToken).toBe('m-for-next-admin')
    store.close()
  })

  it('drops the previous admin’s caches and module tokens when a renewal brings another admin', async () => {
    const onCleared = vi.fn()
    const reset = vi.fn()
    const undo = registerSensitiveReset(reset)
    let n = 0
    const exchange = vi.fn(async (audience: string, token: string) => ({
      access_token: `m-for-${token}`,
      token_type: 'Bearer',
      expires_in: 300,
      audience,
    }))
    const { store } = makeStore({
      onCleared,
      exchange,
      refresh: async () => sessionBody({ token: `t${(n += 1)}` }),
      fetchMe: async () => (n === 1 ? adminProfile({ id: 'a1' }) : adminProfile({ id: 'b2', email: 'b@shazlo.test' })),
    })
    await store.start()
    expect((await store.getModuleToken('m')).accessToken).toBe('m-for-t1')
    await store.renew()
    expect(store.getSnapshot().admin?.id).toBe('b2')
    expect(onCleared).toHaveBeenCalledOnce()
    expect(reset).toHaveBeenCalledOnce()
    expect((await store.getModuleToken('m')).accessToken).toBe('m-for-t2')
    undo()
    store.close()
  })

  it('keeps the caches when a renewal brings the same admin', async () => {
    const onCleared = vi.fn()
    const exchange = vi.fn(async (audience: string) => ({ access_token: 'm', token_type: 'Bearer', expires_in: 300, audience }))
    const { store } = makeStore({ onCleared, exchange })
    await store.start()
    await store.getModuleToken('m')
    await store.renew()
    await store.getModuleToken('m')
    expect(onCleared).not.toHaveBeenCalled()
    expect(exchange).toHaveBeenCalledOnce()
    store.close()
  })

  it('exchanges again when a renewal changes the admin’s roles', async () => {
    let n = 0
    const exchange = vi.fn(async (audience: string) => ({ access_token: 'm', token_type: 'Bearer', expires_in: 300, audience }))
    const { store } = makeStore({
      exchange,
      fetchMe: async () => adminProfile({ roles: (n += 1) === 1 ? ['super_admin'] : ['vendor_reviewer'] }),
    })
    await store.start()
    await store.getModuleToken('m')
    await store.renew()
    await store.getModuleToken('m')
    expect(exchange).toHaveBeenCalledTimes(2)
    store.close()
  })

  it('hands out no cached module token once a renewal says the password must change', async () => {
    let n = 0
    const { store } = makeStore({ refresh: async () => sessionBody({ must_change_password: (n += 1) > 1 }) })
    await store.start()
    await store.getModuleToken('m')
    await store.renew()
    expect(store.getSnapshot().status).toBe('passwordChangeRequired')
    await expect(store.getModuleToken('m')).rejects.toBeInstanceOf(NotSignedInError)
    store.close()
  })

  it('drops a token whose exchange finishes after the session ended', async () => {
    let release: () => void = () => {}
    const exchange = vi.fn(
      (audience: string) =>
        new Promise<{ access_token: string; token_type: string; expires_in: number; audience: string }>((resolve) => {
          release = () => resolve({ access_token: 'late', token_type: 'Bearer', expires_in: 300, audience })
        }),
    )
    const { store } = makeStore({ exchange })
    await store.start()
    const pending = store.getModuleToken('m')
    await vi.waitFor(() => expect(exchange).toHaveBeenCalled())
    await store.logout()
    release()
    await expect(pending).rejects.toBeInstanceOf(NotSignedInError)
    store.close()
  })
})

describe('isSessionResponse and isAdminProfile', () => {
  it.each([
    ['null', null],
    ['a string', 'token'],
    ['no admin', { access_token: 'a', expires_in: 1, must_change_password: false }],
    ['no flag', { access_token: 'a', expires_in: 1, admin: adminProfile() }],
    ['a numeric token', { ...sessionBody(), access_token: 1 }],
    ['roles that are not strings', { ...sessionBody(), admin: { ...adminProfile(), roles: [1] } }],
    ['an empty token', { ...sessionBody(), access_token: '' }],
    ['a zero lifetime', { ...sessionBody(), expires_in: 0 }],
    ['a negative lifetime', { ...sessionBody(), expires_in: -5 }],
    ['a lifetime setTimeout cannot hold', { ...sessionBody(), expires_in: 1e12 }],
  ])('rejects %s', (_name, value) => {
    expect(isSessionResponse(value)).toBe(false)
  })

  it('checks the token exchange answer the same way', () => {
    const good = { access_token: 'm', token_type: 'Bearer', expires_in: 300, audience: 'vendor-api' }
    expect(isTokenResponse(good)).toBe(true)
    expect(isTokenResponse({ ...good, access_token: '' })).toBe(false)
    expect(isTokenResponse({ ...good, expires_in: undefined })).toBe(false)
    expect(isTokenResponse(null)).toBe(false)
  })

  it('accepts a real session and profile', () => {
    expect(isSessionResponse(sessionBody())).toBe(true)
    expect(isAdminProfile(adminProfile())).toBe(true)
    expect(isAdminProfile({ ...adminProfile(), email: 3 })).toBe(false)
  })
})
