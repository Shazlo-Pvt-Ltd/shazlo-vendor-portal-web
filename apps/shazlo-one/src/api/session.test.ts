import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { DEMO_ADMIN } from '../mocks/identity'
import { IDENTITY_URL, VENDOR_API_URL } from '../test/render'
import { resetMocks, server } from '../test/server'
import { createAppContext } from './context'

// The session store against identity-api's refresh rules (services/identity-api/README.md).
const envelope = (code: string, message = code) => ({ error: { code, message, request_id: 'r' } })

async function signedIn() {
  const { identityDb } = resetMocks()
  const context = createAppContext({ identityUrl: IDENTITY_URL, vendorApiUrl: VENDOR_API_URL })
  context.session.adopt(await context.identity.call((c) => c.POST('/v1/auth/login', { body: DEMO_ADMIN })))
  return { context, identityDb }
}

describe('session restore and renewal', () => {
  it('restores the session from the refresh cookie on load', async () => {
    const { context } = await signedIn()
    const fresh = createAppContext({ identityUrl: IDENTITY_URL, vendorApiUrl: VENDOR_API_URL })
    expect(await fresh.session.refresh()).toBe(true)
    expect(fresh.session.get()).toMatchObject({ status: 'signed_in', admin: { email: DEMO_ADMIN.email } })
    context.session.end()
    fresh.session.end()
  })

  it('renews a 401 once, shared by parallel calls', async () => {
    const { context, identityDb } = await signedIn()
    let refreshes = 0
    server.events.on('request:start', ({ request }) => {
      if (request.url.endsWith('/v1/auth/refresh')) refreshes += 1
    })
    identityDb.access.clear() // every current access token is now rejected
    const [a, b, c] = await Promise.all([0, 1, 2].map(() => context.identity.call((x) => x.GET('/v1/me'))))
    expect([a, b, c].map((m) => m?.email)).toEqual([DEMO_ADMIN.email, DEMO_ADMIN.email, DEMO_ADMIN.email])
    expect(refreshes).toBe(1)
    server.events.removeAllListeners()
    context.session.end()
  })

  it('ends the session when the refresh cookie is rejected while signed in', async () => {
    const { context, identityDb } = await signedIn()
    identityDb.refresh.clear()
    identityDb.access.clear()
    expect(await context.session.refresh()).toBe(false)
    expect(context.session.get()).toMatchObject({ status: 'signed_out', reason: 'expired' })
  })

  it('a call whose token and cookie are both gone fails instead of hanging', async () => {
    const { context, identityDb } = await signedIn()
    identityDb.refresh.clear()
    identityDb.access.clear()
    await expect(context.identity.call((c) => c.GET('/v1/me'))).rejects.toMatchObject({ status: 401 })
    expect(context.session.get().status).toBe('signed_out')
  })

  it('retries once on 409 refresh_conflict (another tab used the cookie a moment ago)', async () => {
    const { context } = await signedIn()
    let first = true
    server.use(
      http.post('*/v1/auth/refresh', () => {
        if (!first) return undefined
        first = false
        return HttpResponse.json(envelope('refresh_conflict'), { status: 409 })
      }),
    )
    expect(await context.session.refresh()).toBe(true)
    expect(context.session.get().status).toBe('signed_in')
    context.session.end()
  })

  it('keeps the session when identity-api is down behind the dev proxy (5xx) or rate-limits the refresh', async () => {
    const { context } = await signedIn()
    for (const status of [502, 429]) {
      server.use(http.post('*/v1/auth/refresh', () => HttpResponse.text('Bad gateway', { status }), { once: true }))
      expect(await context.session.refresh()).toBe(false)
      expect(context.session.get().status).toBe('signed_in')
    }
    context.session.end()
  })

  it('leaves "checking" on load when identity-api cannot be reached, instead of spinning forever', async () => {
    resetMocks()
    server.use(http.post('*/v1/auth/refresh', () => HttpResponse.error()))
    const fresh = createAppContext({ identityUrl: IDENTITY_URL, vendorApiUrl: VENDOR_API_URL })
    expect(await fresh.session.refresh()).toBe(false)
    expect(fresh.session.get().status).toBe('signed_out')
  })
})
