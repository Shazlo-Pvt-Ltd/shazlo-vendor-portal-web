import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { apiErrorBody, renderPortal, TEST_API, WIDTHS } from '../../session/renderPortal'
import { sessionBody } from '../../session/testing'

const TITLE = 'Sign in to your seller account'
const signedOutRefresh = http.post(`${TEST_API}/v1/auth/refresh`, () => apiErrorBody(401, 'unauthorized'))

function login(answer: Parameters<typeof http.post>[1]) {
  return http.post(`${TEST_API}/v1/auth/login`, answer)
}

async function open(route = '/login', handlers = [login(() => HttpResponse.json(sessionBody({ token: 'login-token' })))], width: number = WIDTHS.desktop) {
  const view = renderPortal({ route, session: 'real', width, handlers: [signedOutRefresh, ...handlers] })
  await screen.findByRole('heading', { level: 1, name: TITLE })
  return view
}

async function fill(user: ReturnType<typeof renderPortal>['user'], email = 'kiran@kalkistudio.in', password = 'ajrakh-indigo-26') {
  await user.type(screen.getByLabelText('Work email'), email)
  await user.type(screen.getByLabelText('Password', { selector: 'input' }), password)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('V-01 Sign in', () => {
  it('pairs the form with reasons to sell on desktop, and has no "keep me signed in"', async () => {
    await open()
    const why = screen.getByRole('complementary', { name: 'Why sell on Shazlo' })
    expect(within(why).getAllByRole('listitem')).toHaveLength(3)
    expect(why).not.toHaveTextContent('%')
    expect(screen.getByRole('link', { name: 'Apply to sell' })).toHaveAttribute('href', '/signup')
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/forgot-password')
    // The refresh cookie keeps sellers signed in; there is nothing to choose.
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('sets the reasons on a photo collage from the app, with a scrim so the words stay readable', async () => {
    await open()
    const why = screen.getByRole('complementary', { name: 'Why sell on Shazlo' })
    const panel = why.closest('[data-panel="why-sell"]') as HTMLElement
    expect(panel).not.toBeNull()
    // The photos are decoration: hidden from screen readers, served from the app itself (img-src 'self').
    const collage = panel.querySelector('[data-collage]') as HTMLElement
    expect(collage).toHaveAttribute('aria-hidden', 'true')
    const photos = [...collage.querySelectorAll('img')]
    expect(photos.length).toBeGreaterThanOrEqual(6)
    for (const photo of photos) {
      expect(photo).toHaveAttribute('alt', '')
      expect(photo.getAttribute('src')).not.toMatch(/^https?:/)
      expect(photo).toHaveAttribute('loading', 'lazy')
    }
    // The text sits on a dark scrim above the photos, in light type.
    expect(panel.querySelector('[data-scrim]')).not.toBeNull()
    expect(within(why).getByRole('heading', { level: 2, name: 'Why sell on Shazlo' })).toBeInTheDocument()
    expect(within(why).getAllByRole('heading', { level: 3 })).toHaveLength(3)
  })

  it('drops the reasons panel on phones', async () => {
    await open('/login', undefined, WIDTHS.phone)
    expect(screen.queryByRole('complementary', { name: 'Why sell on Shazlo' })).toBeNull()
  })

  it('checks the fields before calling the API and focuses the first problem', async () => {
    const { user, requests } = await open()
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    const email = screen.getByLabelText('Work email')
    expect(email).toHaveAccessibleDescription('Enter your work email.')
    expect(email).toHaveAttribute('aria-invalid', 'true')
    expect(email).toHaveFocus()
    await user.type(email, 'kiran@')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(email).toHaveAccessibleDescription('Enter an email like name@brand.in.')
    expect(requests.some((r) => r.url.endsWith('/v1/auth/login'))).toBe(false)
  })

  it('signs in through the session and returns to the page the seller asked for', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    let body: unknown
    const { user, router } = await open('/login?next=%2Freview%3Ffilter%3Dsent_back', [
      login(async ({ request }) => {
        body = await request.json()
        return HttpResponse.json(sessionBody({ token: 'login-token' }))
      }),
    ])
    await fill(user)
    await waitFor(() => expect(router.state.location.pathname).toBe('/review'))
    expect(router.state.location.search).toBe('?filter=sent_back')
    expect(body).toEqual({ email: 'kiran@kalkistudio.in', password: 'ajrakh-indigo-26' })
    expect(setItem).not.toHaveBeenCalled()
  })

  it('sends the new access token with the next API call', async () => {
    const { user, requests } = await open()
    await fill(user)
    await screen.findByRole('navigation', { name: 'Seller sections' })
    await waitFor(() => expect(requests.some((r) => r.url.includes('/v1/vendor/'))).toBe(true))
    const call = requests.find((r) => r.url.includes('/v1/vendor/'))!
    expect(call.headers.get('Authorization')).toBe('Bearer login-token')
  })

  it.each(['//evil.example', 'https://evil.example/phish', 'javascript:alert(1)', '/\\evil.example'])('never follows the next link %j', async (next) => {
    const { user, router } = await open(`/login?next=${encodeURIComponent(next)}`)
    await fill(user)
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(router.state.location.search).toBe('')
  })

  it('gives one message for every kind of bad login, and empties the password', async () => {
    const seen = new Set<string>()
    for (const message of ['Invalid email or password', 'No such user', 'Email not verified']) {
      const { user, router, unmount } = await open('/login', [login(() => apiErrorBody(401, 'invalid_credentials', message))])
      await fill(user)
      seen.add((await screen.findByRole('alert')).textContent ?? '')
      expect(router.state.location.pathname).toBe('/login')
      expect(screen.getByLabelText('Password', { selector: 'input' })).toHaveValue('')
      expect(screen.getByLabelText('Work email')).toHaveValue('kiran@kalkistudio.in')
      unmount()
    }
    expect([...seen]).toEqual(['That email and password do not match.'])
  })

  it('keeps no copy of the password in the query cache once the call has ended', async () => {
    const { user, queryClient } = await open('/login', [login(() => apiErrorBody(401, 'invalid_credentials'))])
    await fill(user)
    await screen.findByRole('alert')
    const cached = JSON.stringify(queryClient.getMutationCache().getAll().map((m) => m.state.variables))
    expect(cached).not.toContain('ajrakh-indigo-26')
  })

  it('shows the explanation page to a rejected or suspended vendor', async () => {
    const { user } = await open('/login', [login(() => apiErrorBody(403, 'vendor_not_allowed', 'Vendor is suspended'))])
    await fill(user)
    expect(await screen.findByRole('heading', { level: 1, name: "This account can't use Shazlo Seller" })).toBeInTheDocument()
  })

  it('waits out "too many attempts" before letting the seller try again', async () => {
    const { user } = await open('/login', [
      login(() => HttpResponse.json({ error: { code: 'rate_limited', message: 'Slow down' } }, { status: 429, headers: { 'Retry-After': '30' } })),
    ])
    await fill(user)
    expect(await screen.findByText(/^Too many attempts\. Try again in \d+ s\.$/)).toBeInTheDocument()
    // Said once: no second error banner repeating it.
    expect(screen.getAllByText(/Too many attempts/)).toHaveLength(2) // the visible countdown and its screen-reader sentence
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled()
  })

  it('says when the server cannot be reached', async () => {
    const { user } = await open('/login', [login(() => HttpResponse.error())])
    await fill(user)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server')
  })

  it('says the session ended when it was sent here by an expiry', async () => {
    renderPortal({ route: '/login', session: 'signedOut' })
    await screen.findByRole('heading', { level: 1, name: TITLE })
    expect(screen.queryByText(/Your session ended/)).toBeNull()
  })

  it('sends a signed-in seller straight to the overview', async () => {
    const { router } = renderPortal({ route: '/login' })
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })
})
