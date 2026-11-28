import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NetworkError } from '../api/errors'
import { entry } from '../modules/testing'
import { adminProfile, apiError, fakeChannels, makeStore, sessionBody } from '../session/testing'
import type { SessionStore } from '../session/store'
import { attachModule, deliver, readyMessage, tokenRequestMessage } from '../test/frameBridge'
import { renderRoute } from '../test/renderRoute'
import { setViewport } from '../test/viewport'

const MODULES = [entry({ id: 'vendor-admin', title: 'Vendor admin' })]
const ORIGIN = MODULES[0]!.origin

afterEach(() => {
  vi.useRealTimers()
})

async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
    for (let round = 0; round < 6; round += 1) await Promise.resolve()
  })
}

interface Options {
  /** Makes the exchange of this call (1 is the first) fail with this error. */
  exchangeFails?: (call: number) => unknown
  /** Makes identity-api's refresh of this call (1 is the sign-in restore) fail with this error. */
  refreshFails?: (call: number) => unknown
  identityLifetime?: number
  roles?: () => string[]
  /** Who identity-api says the admin is, on each refresh and `/v1/me`. */
  adminId?: () => string
  channel?: Parameters<typeof makeStore>[0] extends infer D ? (D extends { channel?: infer C } ? C : never) : never
}

/** The host with a fake clock, a counting exchange and a counting identity refresh. */
async function open(options: Options = {}) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  setViewport(1280)
  const exchangeCalls: Array<{ call: number; at: number; identityToken: string }> = []
  let exchanges = 0
  const exchange = vi.fn(async (audience: string, identityToken: string) => {
    exchanges += 1
    exchangeCalls.push({ call: exchanges, at: Date.now(), identityToken })
    const failure = options.exchangeFails?.(exchanges)
    if (failure) throw failure
    return { access_token: `mod-${exchanges}`, token_type: 'Bearer', expires_in: 300, audience }
  })
  let refreshes = 0
  const refresh = vi.fn(async () => {
    refreshes += 1
    const failure = options.refreshFails?.(refreshes)
    if (failure) throw failure
    const body = sessionBody({ token: `id-${refreshes}`, expires_in: options.identityLifetime ?? 900, roles: options.roles?.() ?? ['vendor_reviewer'] })
    return { ...body, admin: { ...body.admin, id: options.adminId?.() ?? body.admin.id } }
  })
  const logout = vi.fn(async () => {})
  const store: SessionStore = makeStore({
    refresh,
    fetchMe: async () => adminProfile({ id: options.adminId?.() ?? 'a1', roles: options.roles?.() ?? ['vendor_reviewer'] }),
    exchange,
    logout,
    channel: options.channel,
  }).store
  const startedAt = Date.now()
  const router = renderRoute('/m/vendor-admin', { store, modules: MODULES })
  await settle()
  await settle()
  const module = attachModule({ moduleOrigin: ORIGIN })
  module.client.sendReady()
  await settle()
  return { store, router, module, exchange, exchangeCalls, refresh, logout, startedAt, secondsSinceStart: () => (Date.now() - startedAt) / 1000 }
}

const frames = () => document.querySelectorAll('iframe').length
const times = (calls: Array<{ at: number }>, from: number) => calls.map((call) => Math.round((call.at - from) / 1000))

describe('keeping a module supplied with a token', () => {
  it('sends a fresh auth at 80% of the token’s life, not before, and again each time after', async () => {
    const t = await open()
    expect(t.module.auths).toHaveLength(1)
    await settle(239_999)
    expect(t.exchange).toHaveBeenCalledTimes(1)
    await settle(1)
    expect(t.exchange).toHaveBeenCalledTimes(2)
    expect(t.module.auths.map((auth) => auth.accessToken)).toEqual(['mod-1', 'mod-2'])
    expect(t.module.auths[1]!.expiresAt).toBeGreaterThan(t.module.auths[0]!.expiresAt)
    await settle(239_999)
    expect(t.exchange).toHaveBeenCalledTimes(2)
    await settle(1)
    expect(t.module.auths.map((auth) => auth.accessToken)).toEqual(['mod-1', 'mod-2', 'mod-3'])
  })

  it('asks for a new token, not the cached one, even though the old one is still good', async () => {
    const t = await open()
    await settle(240_000)
    expect(t.module.auths[1]!.accessToken).not.toBe(t.module.auths[0]!.accessToken)
  })

  it('leaves the module with a valid token at every moment of a half-hour session, without a reload', async () => {
    const t = await open()
    const first = t.module.frameWindow
    for (let elapsed = 0; elapsed < 1800; elapsed += 20) {
      await settle(20_000)
      const latest = t.module.auths.at(-1)!
      expect(latest.expiresAt * 1000, `at ${elapsed + 20} s`).toBeGreaterThan(Date.now())
    }
    expect(t.module.auths.length).toBeGreaterThanOrEqual(7)
    // The same frame throughout: no reload, no panel, still signed in.
    expect(frames()).toBe(1)
    expect(t.module.frameWindow).toBe(first)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(t.store.getSnapshot().status).toBe('signedIn')
  })

  it('sends the module the admin’s roles with each refresh, so a module sees a role that was added', async () => {
    let roles = ['vendor_reviewer']
    const t = await open({ roles: () => roles })
    roles = ['vendor_reviewer', 'super_admin']
    await settle(800_000)
    expect(t.module.auths.at(-1)!.user.roles).toEqual(['vendor_reviewer', 'super_admin'])
  })

  it('renews the identity token first when the module token would outlive it', async () => {
    // An identity token of 400 s: at 240 s it has 160 s left, less than a new 300 s module token needs.
    const t = await open({ identityLifetime: 400 })
    expect(t.refresh).toHaveBeenCalledTimes(1)
    await settle(240_000)
    expect(t.refresh).toHaveBeenCalledTimes(2)
    const second = t.exchangeCalls[1]!
    expect(second.identityToken).toBe('id-2')
    // The new module token has its whole 300 seconds, not what was left of the old identity token.
    expect(t.module.auths[1]!.expiresAt - Math.floor(second.at / 1000)).toBe(300)
  })

  it('goes ahead with the identity token it has when that renewal fails, so the module token is cut short and replaced sooner', async () => {
    const t = await open({ identityLifetime: 400, refreshFails: (call) => (call >= 2 ? new NetworkError('network') : undefined) })
    await settle(240_000)
    expect(t.exchange).toHaveBeenCalledTimes(2)
    expect(t.exchangeCalls[1]!.identityToken).toBe('id-1')
    // Capped at the identity token's end (400 s), not 240 + 300.
    const startSeconds = Math.floor(t.startedAt / 1000)
    expect(t.module.auths[1]!.expiresAt).toBeLessThanOrEqual(startSeconds + 400)
    expect(t.module.auths[1]!.expiresAt).toBeGreaterThan(startSeconds + 390)
  })

  it('stops refreshing when the page is left, and drops what it held', async () => {
    const t = await open()
    await settle(100_000)
    await act(async () => {
      await t.router.navigate('/')
    })
    await settle()
    expect(frames()).toBe(0)
    await settle(20 * 60_000)
    expect(t.exchange).toHaveBeenCalledTimes(1)
  })

  it('does the same for a module that reloaded: the schedule follows the token it was last given', async () => {
    const t = await open()
    await settle(200_000)
    t.module.client.sendReady()
    await settle()
    expect(t.module.auths).toHaveLength(2)
    // The cached token (issued at 0) is refreshed at 240 s, 40 s after the reload, not 240 s after it.
    await settle(39_999)
    expect(t.exchange).toHaveBeenCalledTimes(1)
    await settle(1)
    expect(t.exchange).toHaveBeenCalledTimes(2)
  })
})

describe('token:request', () => {
  it('is answered with a fresh auth', async () => {
    const t = await open()
    expect(t.module.client.requestToken('unauthorized')).toBe(true)
    await settle()
    expect(t.exchange).toHaveBeenCalledTimes(2)
    expect(t.module.auths.map((auth) => auth.accessToken)).toEqual(['mod-1', 'mod-2'])
  })

  it('is accepted at most once every 30 seconds per module, whatever the module sends', async () => {
    const t = await open()
    const request = () => deliver(t.module.shellWindow, tokenRequestMessage(), ORIGIN, t.module.frameWindow)
    request()
    request()
    request()
    await settle()
    expect(t.exchange).toHaveBeenCalledTimes(2)
    await settle(29_999)
    request()
    await settle()
    expect(t.exchange).toHaveBeenCalledTimes(2)
    await settle(1)
    request()
    await settle()
    expect(t.exchange).toHaveBeenCalledTimes(3)
    expect(t.module.auths).toHaveLength(3)
  })

  it('does not let a flood of requests flood the identity server', async () => {
    const t = await open()
    for (let i = 0; i < 200; i += 1) deliver(t.module.shellWindow, tokenRequestMessage(), ORIGIN, t.module.frameWindow)
    await settle()
    expect(t.exchange).toHaveBeenCalledTimes(2)
  })

  it('is ignored from another origin or another window', async () => {
    const t = await open()
    const attacker = document.createElement('iframe')
    document.body.append(attacker)
    deliver(t.module.shellWindow, tokenRequestMessage(), 'https://evil.example', t.module.frameWindow)
    deliver(t.module.shellWindow, tokenRequestMessage(), ORIGIN, attacker.contentWindow)
    await settle()
    expect(t.exchange).toHaveBeenCalledTimes(1)
    attacker.remove()
  })

  it('ends the session when no token can be had: the exchange is refused and so is the renewal', async () => {
    const t = await open({
      exchangeFails: (call) => (call >= 2 ? apiError(401, 'unauthorized') : undefined),
      refreshFails: (call) => (call >= 2 ? apiError(401, 'unauthorized') : undefined),
    })
    t.module.client.requestToken('unauthorized')
    await settle()
    expect(frames()).toBe(0)
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeTruthy()
    expect(t.store.getSnapshot()).toMatchObject({ status: 'signedOut', expired: true })
    expect(new URLSearchParams(t.router.state.location.search).get('return-to')).toBe('/m/vendor-admin')
  })
})

describe('when a refresh fails', () => {
  const down = (call: number) => (call >= 2 ? new NetworkError('network') : undefined)

  it('keeps the current token and retries after 5, 15 and 30 seconds, then every 30', async () => {
    const t = await open({ exchangeFails: down })
    await settle(299_000)
    expect(times(t.exchangeCalls, t.startedAt)).toEqual([0, 240, 245, 260, 290])
    // The module still has its token and its frame, and was told nothing.
    expect(frames()).toBe(1)
    expect(t.module.auths).toHaveLength(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('treats a server error like the network', async () => {
    const t = await open({ exchangeFails: (call) => (call >= 2 ? apiError(503, 'unavailable') : undefined) })
    await settle(299_000)
    expect(times(t.exchangeCalls, t.startedAt)).toEqual([0, 240, 245, 260, 290])
    expect(frames()).toBe(1)
  })

  it('removes the frame at expiry, says the session expired and goes to login at the module’s path', async () => {
    const t = await open({ exchangeFails: down })
    await settle(299_999)
    expect(frames()).toBe(1)
    await settle(1)
    expect(frames()).toBe(0)
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeTruthy()
    expect(screen.getByText(/Your session ended/)).toBeTruthy()
    expect(new URLSearchParams(t.router.state.location.search).get('return-to')).toBe('/m/vendor-admin')
    expect(t.store.getSnapshot()).toMatchObject({ status: 'signedOut', expired: true, signedOutByUser: false })
    expect(t.store.getAccessToken()).toBeNull()
  })

  it('needs no server to end the session, and does not retry after it', async () => {
    const t = await open({ exchangeFails: down })
    await settle(300_000)
    const callsAtExpiry = t.exchange.mock.calls.length
    expect(t.logout).not.toHaveBeenCalled()
    await settle(10 * 60_000)
    expect(t.exchange.mock.calls.length).toBe(callsAtExpiry)
  })

  it('recovers when a retry works: the module gets the new token and the next failure backs off from 5 seconds again', async () => {
    // Calls: 1 ready; 2 and 3 fail; 4 works; 5 fails; 6 works.
    const t = await open({ exchangeFails: (call) => ([2, 3, 5].includes(call) ? new NetworkError('network') : undefined) })
    await settle(262_000)
    expect(t.module.auths.map((auth) => auth.accessToken)).toEqual(['mod-1', 'mod-4'])
    await settle(250_000)
    // Call 5 is 240 s after call 4; call 6 follows 5 s later (the backoff started over, not at 15 s).
    const at = times(t.exchangeCalls, t.startedAt)
    expect(at.slice(0, 4)).toEqual([0, 240, 245, 260])
    expect(at[4]! - at[3]!).toBe(240)
    expect(at[5]! - at[4]!).toBe(5)
    expect(t.module.auths.at(-1)!.accessToken).toBe('mod-6')
    expect(frames()).toBe(1)
  })

  it('keeps trying when the identity token is too old to exchange with and cannot be renewed yet, and recovers when it can', async () => {
    // identity-api cannot be reached from 700 to 893 s: the identity token (900 s) cannot be renewed, so the
    // module tokens are cut short to its end, until it is too old to exchange with at all.
    let first: number | undefined
    const t = await open({
      refreshFails: () => {
        first ??= Date.now()
        const at = (Date.now() - first) / 1000
        return at >= 700 && at < 893 ? new NetworkError('network') : undefined
      },
    })
    await settle(905_000)
    expect(t.store.getSnapshot().status).toBe('signedIn')
    expect(frames()).toBe(1)
    expect(t.module.auths.at(-1)!.expiresAt * 1000).toBeGreaterThan(Date.now())
  })

  it('does not end the session when a retry works in the last seconds before expiry', async () => {
    // Calls at 240, 245 and 260 fail; the one at 290 works, ten seconds before the token ends.
    const t = await open({ exchangeFails: (call) => (call >= 2 && call <= 4 ? new NetworkError('network') : undefined) })
    await settle(291_000)
    expect(times(t.exchangeCalls, t.startedAt)).toEqual([0, 240, 245, 260, 290])
    expect(t.module.auths.map((auth) => auth.accessToken)).toEqual(['mod-1', 'mod-5'])
    // Past the old token's end: nothing expired, because the module holds a newer one.
    await settle(30_000)
    expect(frames()).toBe(1)
    expect(t.store.getSnapshot().status).toBe('signedIn')
    expect(screen.queryByRole('heading', { name: 'Sign in' })).toBeNull()
  })
})

describe('when the session ends from anywhere, the module loses its token at once', () => {
  async function expectEverythingGone(t: Awaited<ReturnType<typeof open>>) {
    expect(frames()).toBe(0)
    expect(t.store.getAccessToken()).toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeTruthy()
    const authsAtEnd = t.module.auths.length
    const postsAtEnd = t.module.posts.length
    await settle(30 * 60_000)
    expect(t.module.auths).toHaveLength(authsAtEnd)
    expect(t.module.posts).toHaveLength(postsAtEnd)
  }

  it('signing out here', async () => {
    const t = await open()
    await act(async () => {
      await t.store.logout()
    })
    await settle()
    expect(t.logout).toHaveBeenCalledOnce()
    await expectEverythingGone(t)
    expect(t.router.state.location.search).toBe('')
  })

  it('signing out in another tab', async () => {
    const channels = fakeChannels()
    const t = await open({ channel: channels() })
    const other = makeStore({ channel: channels(), refresh: async () => sessionBody(), fetchMe: async () => sessionBody().admin }).store
    await other.start()
    await act(async () => {
      await other.logout()
    })
    await settle()
    await expectEverythingGone(t)
    expect(t.store.getSnapshot()).toMatchObject({ status: 'signedOut', signedOutByUser: true })
    other.close()
  })

  it('a revoked refresh family (the identity renewal is refused)', async () => {
    const t = await open({ refreshFails: (call) => (call >= 2 ? apiError(401, 'unauthorized') : undefined) })
    // The module is refreshed from the identity token while it lasts; at 720 s the renewal is refused.
    await settle(721_000)
    await expectEverythingGone(t)
    expect(t.store.getSnapshot()).toMatchObject({ status: 'signedOut', expired: true })
    expect(new URLSearchParams(t.router.state.location.search).get('return-to')).toBe('/m/vendor-admin')
  })

  it('a deactivated admin (the exchange and the renewal are both refused)', async () => {
    const t = await open({
      exchangeFails: (call) => (call >= 2 ? apiError(401, 'unauthorized') : undefined),
      refreshFails: (call) => (call >= 2 ? apiError(401, 'unauthorized') : undefined),
    })
    await settle(240_000)
    await expectEverythingGone(t)
    expect(t.store.getSnapshot()).toMatchObject({ status: 'signedOut', expired: true })
  })

  it('sends the module nothing after the session ended, even from a timer that was already running', async () => {
    const t = await open()
    await settle(230_000)
    await act(async () => {
      await t.store.logout()
    })
    const posts = t.module.posts.length
    await settle(5 * 60_000)
    expect(t.module.posts).toHaveLength(posts)
    expect(t.exchange).toHaveBeenCalledTimes(1)
  })
})

describe('when a role is removed', () => {
  it('a 403 on the refresh closes the module and shows the 403 page', async () => {
    const t = await open({ exchangeFails: (call) => (call >= 2 ? apiError(403, 'audience_not_allowed') : undefined) })
    await settle(240_000)
    expect(screen.getByRole('heading', { level: 1, name: "You don't have access to this module" })).toBeTruthy()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(frames()).toBe(0)
    // No retries: this is not a failure to try again.
    await settle(10 * 60_000)
    expect(t.exchange).toHaveBeenCalledTimes(2)
    expect(t.store.getSnapshot().status).toBe('signedIn')
    expect(t.module.auths).toHaveLength(1)
  })

  it('a 403 on a token request does the same', async () => {
    const t = await open({ exchangeFails: (call) => (call >= 2 ? apiError(403, 'audience_not_allowed') : undefined) })
    t.module.client.requestToken('unauthorized')
    await settle()
    expect(screen.getByRole('heading', { level: 1, name: "You don't have access to this module" })).toBeTruthy()
    expect(frames()).toBe(0)
  })

  it('the role leaving the admin’s own session (read again on renewal) closes the module too', async () => {
    let roles = ['vendor_reviewer']
    const t = await open({ roles: () => roles })
    roles = []
    // The identity token is renewed at 720 s and the roles are read again with it.
    await settle(725_000)
    expect(frames()).toBe(0)
    expect(screen.getByRole('heading', { level: 1, name: "You don't have access to this module" })).toBeTruthy()
    expect(t.store.getSnapshot().roles).toEqual([])
  })
})

describe('a module that sends `ready` again and again', () => {
  const down = (call: number) => (call >= 2 ? new NetworkError('network') : undefined)
  const readies = (t: Awaited<ReturnType<typeof open>>, count: number) => {
    for (let i = 0; i < count; i += 1) deliver(t.module.shellWindow, readyMessage(), ORIGIN, t.module.frameWindow)
  }

  it('gets the token it holds again, without resetting the backoff or causing an exchange', async () => {
    const t = await open({ exchangeFails: down })
    await settle(241_000)
    readies(t, 20)
    await settle()
    await settle(58_000)
    // The same retries as with no `ready` at all: one each at 245, 260 and 290 s.
    expect(times(t.exchangeCalls, t.startedAt)).toEqual([0, 240, 245, 260, 290])
    // Each `ready` was answered, with the token the module already had.
    expect(new Set(t.module.auths.map((auth) => auth.accessToken))).toEqual(new Set(['mod-1']))
  })

  it('causes no exchange in the last seconds of a token that cannot be refreshed', async () => {
    const t = await open({ exchangeFails: down })
    await settle(292_000)
    const before = t.exchange.mock.calls.length
    readies(t, 20)
    await settle()
    expect(t.exchange.mock.calls.length).toBe(before)
  })
})

describe('when a renewal changes who the admin is or what they may do', () => {
  it('another admin: the frame is replaced, so the module keeps nothing of the previous admin', async () => {
    let adminId = 'a1'
    const t = await open({ adminId: () => adminId })
    const first = document.querySelector('iframe')
    adminId = 'a2'
    await act(async () => {
      await t.store.renew()
    })
    await settle()
    expect(t.store.getSnapshot().admin?.id).toBe('a2')
    expect(document.querySelector('iframe')).not.toBe(first)
    // The old frame was told nothing more, and the new admin's session is not ended by the old token's expiry.
    expect(t.module.auths).toHaveLength(1)
    await settle(400_000)
    expect(t.store.getSnapshot().status).toBe('signedIn')
  })

  it('new roles: the module gets a token for them at once, not at the next scheduled refresh', async () => {
    let roles = ['vendor_reviewer']
    const t = await open({ roles: () => roles })
    await settle(60_000)
    roles = ['vendor_reviewer', 'super_admin']
    await act(async () => {
      await t.store.renew()
    })
    await settle()
    expect(t.exchange).toHaveBeenCalledTimes(2)
    expect(t.module.auths.at(-1)).toMatchObject({ accessToken: 'mod-2', user: { roles: ['vendor_reviewer', 'super_admin'] } })
  })
})

describe('the page while this happens', () => {
  it('keeps the shell’s chrome usable through a failing refresh', async () => {
    await open({ exchangeFails: (call) => (call >= 2 ? new NetworkError('network') : undefined) })
    await settle(250_000)
    expect(screen.getByRole('navigation', { name: 'Modules' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Asha Admin' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Asha Admin' }))
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeTruthy()
  })
})
