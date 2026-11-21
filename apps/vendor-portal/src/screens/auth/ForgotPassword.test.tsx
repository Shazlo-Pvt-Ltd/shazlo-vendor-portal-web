import { cleanup, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeAll, describe, expect, it } from 'vitest'
import { DEMO_LOGIN } from '../../mocks/db'
import { renderApp } from '../../test/render'
import { setupMockApi } from '../../test/server'

const { server, db } = setupMockApi()
const SLOW = { timeout: 8000 }

beforeAll(async () => {
  await import('./ForgotPassword')
})

async function open() {
  const view = await renderApp({ route: '/forgot-password', signedIn: false })
  expect(await screen.findByRole('heading', { level: 1, name: 'Reset your password' }, SLOW)).toBeInTheDocument()
  return view
}

function count() {
  const bodies: unknown[] = []
  server.use(
    http.post('*/v1/auth/forgot-password', async ({ request }) => {
      bodies.push(await request.clone().json())
    }),
  )
  return bodies
}

describe('Forgot password', () => {
  it('asks for the work email', async () => {
    await open()
    expect(screen.getByLabelText('Work email')).toHaveAttribute('autocomplete', 'username')
    expect(screen.getByLabelText('Work email')).toHaveAttribute('inputmode', 'email')
    expect(screen.getByRole('button', { name: 'Send reset link' })).toHaveClass('MuiButton-contained')
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login')
  })

  it('checks the email before sending and focuses it', async () => {
    const bodies = count()
    const { user } = await open()
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))
    const email = screen.getByLabelText('Work email')
    expect(email).toHaveAccessibleDescription('Enter your work email.')
    expect(email).toHaveFocus()
    await user.type(email, 'kiran@')
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(email).toHaveAccessibleDescription('Enter an email like name@brand.in.')
    expect(screen.queryByRole('heading', { name: 'Check your email' })).toBeNull()
    expect(bodies).toEqual([])
  })

  it('gives a seller with an account and an email with none the same answer, so it never says which', async () => {
    const pages: string[] = []
    for (const address of [DEMO_LOGIN.email, 'someone@elsewhere.in']) {
      const { user } = await open()
      await user.type(screen.getByLabelText('Work email'), address)
      await user.click(screen.getByRole('button', { name: 'Send reset link' }))
      const title = await screen.findByRole('heading', { level: 1, name: 'Check your email' })
      expect(document.activeElement).toContainElement(title)
      expect(screen.getByText(`If an account uses ${address}, we have sent it a link to choose a new password. The link works once, for a limited time.`)).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login')
      expect(screen.queryByLabelText('Work email')).toBeNull()
      pages.push((screen.getByRole('main').textContent ?? '').split(address).join('EMAIL'))
      cleanup()
    }
    expect(pages[0]).toBe(pages[1])
    // Only the real account got an email.
    expect(db().emails).toEqual([expect.objectContaining({ to: DEMO_LOGIN.email, kind: 'reset' })])
  })

  it('sends only the address, without the spaces around it, once on a double click', async () => {
    const bodies = count()
    const { user } = await open()
    await user.type(screen.getByLabelText('Work email'), `  ${DEMO_LOGIN.email} `)
    await user.dblClick(screen.getByRole('button', { name: 'Send reset link' }))
    await screen.findByRole('heading', { level: 1, name: 'Check your email' })
    expect(bodies).toEqual([{ email: DEMO_LOGIN.email }])
  })

  it('keeps the form when the request does not go through', async () => {
    db().faults.push({ path: '/v1/auth/forgot-password', network: true })
    const { user } = await open()
    await user.type(screen.getByLabelText('Work email'), DEMO_LOGIN.email)
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server. Check your connection and try again.')
    expect(screen.getByLabelText('Work email')).toHaveValue(DEMO_LOGIN.email)
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Check your email' })).toBeInTheDocument()
  })

  it('never shows what went wrong on our side as it came', async () => {
    db().faults.push({ path: '/v1/auth/forgot-password', status: 500, message: 'Traceback: smtp down' })
    const { user } = await open()
    await user.type(screen.getByLabelText('Work email'), DEMO_LOGIN.email)
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong on our side. Try again in a moment.')
    expect(screen.queryByText(/Traceback/)).toBeNull()
  })

  it('counts down after too many attempts', async () => {
    server.use(http.post('*/v1/auth/forgot-password', () => HttpResponse.json({ error: { code: 'rate_limited', message: 'x' } }, { status: 429, headers: { 'Retry-After': '120' } }), { once: true }))
    const { user } = await open()
    await user.type(screen.getByLabelText('Work email'), DEMO_LOGIN.email)
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(await screen.findByText(/Too many attempts. Try again in (120|119) s\./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send reset link' })).toBeDisabled()
  })
})
