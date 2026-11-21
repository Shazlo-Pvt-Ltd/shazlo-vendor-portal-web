import { createMessage } from '@shazlo/shell-protocol'
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { fakeShell, renderModule, VENDOR_API_URL } from '../test/render'
import { server } from '../test/server'

describe('module runtime (ADR 0001, module side)', () => {
  it('says ready with its versions before anything else, and renders only after auth', async () => {
    const shell = fakeShell({ autoAuth: false })
    renderModule({ shell })
    expect(shell.sent[0]).toMatchObject({ type: 'ready', payload: { module: 'vendor-admin', supportedVersions: [1] } })
    expect(screen.getByRole('status', { name: 'Connecting to Shazlo One' })).toBeInTheDocument()
    shell.deliver(shell.auth(shell.sent[0]!.id))
    expect(await screen.findByRole('heading', { level: 1, name: 'Review queue' })).toBeInTheDocument()
  })

  it('tells the shell each page title and path', async () => {
    const { shell } = renderModule({ route: '/publishing' })
    await waitFor(() => expect(shell.titles()).toContainEqual({ path: '/publishing', title: 'Publishing to the app' }))
  })

  it('follows navigate from the shell', async () => {
    const { shell, router } = renderModule({ route: '/queue' })
    await screen.findByRole('heading', { level: 1, name: 'Review queue' })
    shell.navigate('/vendors')
    await waitFor(() => expect(router.state.location.pathname).toBe('/vendors'))
  })

  it('asks the shell for a new token on 401, then retries with it', async () => {
    let calls = 0
    server.use(
      http.get(`${VENDOR_API_URL}/api/v1/admin/queue`, ({ request }) => {
        calls += 1
        if (calls === 1) return HttpResponse.json({ message: 'Expired', extra: { code: 'unauthenticated' } }, { status: 401 })
        expect(request.headers.get('authorization')).toMatch(/^Bearer mock\.vendor-api\./)
        return HttpResponse.json({ items: [], counts: { all: 0, product: 0, brand_page: 0, application: 0 }, vendors: [] })
      }),
    )
    // The review queue loads on open, so its first call meets the 401.
    const { shell } = renderModule({ route: '/queue' })
    await waitFor(() => expect(shell.sent.some((m) => m.type === 'token:request')).toBe(true))
    await waitFor(() => expect(calls).toBe(2))
  })

  it('ignores an auth older than the token it holds', async () => {
    const shell = fakeShell()
    renderModule({ shell })
    await screen.findByRole('heading', { level: 1, name: 'Review queue' })
    shell.deliver(shell.auth(undefined, -3600))
    expect(screen.getByRole('heading', { level: 1, name: 'Review queue' })).toBeInTheDocument()
  })

  it('stops when the shell sends an error, and explains', async () => {
    const shell = fakeShell()
    renderModule({ shell })
    await screen.findByRole('heading', { level: 1, name: 'Review queue' })
    shell.deliver(createMessage('error', { code: 'version_unsupported', message: 'No' }))
    expect(await screen.findByRole('heading', { name: 'Your session ended' })).toBeInTheDocument()
  })

  it('outside Shazlo One, points people to it instead of loading', () => {
    renderModule({ shell: fakeShell({ framed: false }) })
    expect(screen.getByRole('heading', { name: 'Open this in Shazlo One' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Shazlo One' })).toHaveAttribute('href', expect.stringContaining('http://localhost:5192/vendors'))
  })
})
