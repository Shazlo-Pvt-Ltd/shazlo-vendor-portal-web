import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { makeStore, sessionBody } from '../../session/testing'
import { BASE, apiErrorResponse, useApiServer } from '../../test/msw'
import { renderRoute } from '../../test/renderRoute'
import { setViewport } from '../../test/viewport'
import type { Member } from './rules'

const server = useApiServer()
const USERS = `${BASE}/v1/vendor/users`
const INVITED = 'If this address can be invited, we have sent an invitation.'

const member = (id: string, email: string, overrides: Partial<Member> = {}): Member => ({
  id,
  email,
  role: 'staff',
  status: 'active',
  last_login_at: '2026-11-15T09:30:00Z',
  created_at: '2026-11-01T09:30:00Z',
  ...overrides,
})

// The session's user is `u1` (see sessionBody).
const team = () => [
  member('s2', 'zara@brand.test', { status: 'disabled' }),
  member('s1', 'asha@brand.test', { status: 'invited', last_login_at: null }),
  member('u1', 'owner@brand.test', { role: 'owner' }),
  member('s3', 'bina@brand.test'),
]

interface Calls {
  lists: number
  invites: unknown[]
  patches: { id: string; body: unknown }[]
  resends: string[]
}

function serve(options: { invite?: () => Response; patch?: () => Response; resend?: () => Response } = {}): Calls {
  const calls: Calls = { lists: 0, invites: [], patches: [], resends: [] }
  let members = team()
  server.use(
    http.get(USERS, () => {
      calls.lists += 1
      return HttpResponse.json(members)
    }),
    http.post(USERS, async ({ request }) => {
      calls.invites.push(await request.json())
      return options.invite ? options.invite() : HttpResponse.json({ message: INVITED }, { status: 202 })
    }),
    http.patch(`${USERS}/:id`, async ({ params, request }) => {
      const body = (await request.json()) as { disabled: boolean }
      calls.patches.push({ id: String(params.id), body })
      if (options.patch) return options.patch()
      members = members.map((m) => (m.id === params.id ? { ...m, status: body.disabled ? 'disabled' : 'active' } : m))
      return HttpResponse.json(members.find((m) => m.id === params.id))
    }),
    http.post(`${USERS}/:id/resend-invite`, ({ params }) => {
      calls.resends.push(String(params.id))
      return options.resend ? options.resend() : new HttpResponse(null, { status: 204 })
    }),
  )
  return calls
}

async function open(role: 'owner' | 'staff' = 'owner', options: Parameters<typeof serve>[0] = {}) {
  setViewport(1280)
  const calls = serve(options)
  const router = renderRoute('/team', { store: makeStore({ refresh: async () => sessionBody({ role }) }).store })
  await screen.findByRole('heading', { level: 1 }, { timeout: 15_000 })
  return { calls, router, user: userEvent.setup() }
}

/** A member's row, found by the email shown on it (and not, say, by a toast that mentions it). */
const row = (email: string) =>
  screen.getByText((_content, element) => element?.tagName === 'P' && [email, `${email} (you)`].includes(element.textContent ?? '')).closest('li') as HTMLElement

describe('the team page', () => {
  it('lists the owner first, then active, invited and disabled staff, with role, status and last sign-in', async () => {
    await open()
    await screen.findByText('owner@brand.test (you)')
    const items = within(screen.getByRole('list', { name: 'Team members' })).getAllByRole('listitem')
    expect(items.map((item) => item.textContent?.split(/(Owner|Staff)/)[0])).toEqual([
      'owner@brand.test (you)',
      'bina@brand.test',
      'asha@brand.test',
      'zara@brand.test',
    ])
    expect(within(row('asha@brand.test')).getByText('Invited')).toBeTruthy()
    expect(within(row('asha@brand.test')).getByText(/has not signed in yet/)).toBeTruthy()
    expect(within(row('zara@brand.test')).getByText('Disabled')).toBeTruthy()
    expect(within(row('bina@brand.test')).getByText('Active')).toBeTruthy()
    expect(within(row('bina@brand.test')).getByText(/Last signed in/).querySelector('time')?.getAttribute('datetime')).toBe('2026-11-15T09:30:00Z')
    // Nobody can act on the owner (which is also the signed-in user).
    expect(within(row('owner@brand.test')).queryByRole('button')).toBeNull()
  })

  it('invites by email and shows the same answer whatever the address', async () => {
    const { calls, user } = await open()
    await screen.findByText('owner@brand.test (you)')
    const lists = calls.lists
    await user.type(screen.getByLabelText('Email address'), '  new@brand.test ')
    await user.click(screen.getByRole('button', { name: 'Send invitation' }))
    expect(await screen.findByText(new RegExp(INVITED))).toBeTruthy()
    expect(calls.invites).toEqual([{ email: 'new@brand.test' }])
    expect((screen.getByLabelText('Email address') as HTMLInputElement).value).toBe('')
    await waitFor(() => expect(calls.lists).toBeGreaterThan(lists))
  })

  it('checks the address before sending', async () => {
    const { calls, user } = await open()
    await user.type(screen.getByLabelText('Email address'), 'not-an-email')
    await user.click(screen.getByRole('button', { name: 'Send invitation' }))
    expect(screen.getByText('Enter an email address like name@example.com.')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText('Email address'))
    expect(calls.invites).toEqual([])
  })

  it('says how long to wait after too many invitations', async () => {
    const { user } = await open('owner', { invite: () => apiErrorResponse(429, 'rate_limited', 'x', { 'Retry-After': '600' }) })
    await user.type(screen.getByLabelText('Email address'), 'new@brand.test')
    await user.click(screen.getByRole('button', { name: 'Send invitation' }))
    expect(await screen.findByText('You have sent many invitations in the last hour. Try again in 10 minutes.')).toBeTruthy()
  })

  it('resends an invitation', async () => {
    const { calls, user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Resend the invitation to asha@brand.test' }))
    expect(await screen.findByText('Invitation sent again to asha@brand.test')).toBeTruthy()
    expect(calls.resends).toEqual(['s1'])
  })

  it('explains an invitation that was already accepted', async () => {
    const { user } = await open('owner', { resend: () => apiErrorResponse(409, 'not_invited') })
    await user.click(await screen.findByRole('button', { name: 'Resend the invitation to asha@brand.test' }))
    expect(await screen.findByText(/has already set a password, so there is no invitation to resend/)).toBeTruthy()
  })

  it('disables after a confirmation, and enables', async () => {
    const { calls, user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Disable bina@brand.test' }))
    const dialog = await screen.findByRole('dialog', { name: 'Disable bina@brand.test?' })
    expect(within(dialog).getByText(/signed out everywhere at once/)).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Disable' }))
    expect(await screen.findByText('bina@brand.test is disabled')).toBeTruthy()
    expect(calls.patches).toEqual([{ id: 's3', body: { disabled: true } }])
    expect(within(row('bina@brand.test')).getByText('Disabled')).toBeTruthy()

    // The confirmation dialog hides the page from assistive technology until it has closed.
    await user.click(await screen.findByRole('button', { name: 'Enable zara@brand.test' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Enable' }))
    expect(await screen.findByText('zara@brand.test is enabled')).toBeTruthy()
    expect(calls.patches[1]).toEqual({ id: 's2', body: { disabled: false } })
  })

  it('asks for a new invitation after enabling someone who never accepted one', async () => {
    // vendor-api puts a user without a password back to `invited`, and disabling ended their link.
    const { user } = await open('owner', { patch: () => HttpResponse.json(member('s2', 'zara@brand.test', { status: 'invited', last_login_at: null })) })
    await user.click(await screen.findByRole('button', { name: 'Enable zara@brand.test' }))
    const dialog = await screen.findByRole('dialog', { name: 'Enable zara@brand.test?' })
    expect(within(dialog).getByText(/never accepted their invitation needs a new one/)).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Enable' }))
    expect(await screen.findByText('zara@brand.test is enabled. Resend the invitation so they can choose a password.')).toBeTruthy()
    // The closing dialog hides the page from role queries until its transition ends.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 10_000 })
    expect(within(row('zara@brand.test')).getByText('Invited')).toBeTruthy()
    expect(within(row('zara@brand.test')).getByRole('button', { name: 'Resend the invitation to zara@brand.test' })).toBeTruthy()
  })

  it('changes nothing when the confirmation is declined', async () => {
    const { calls, user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Disable bina@brand.test' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(calls.patches).toEqual([])
  })

  it.each([
    ['cannot_disable_self', 'You cannot disable your own account.'],
    ['owner_cannot_be_disabled', 'The owner cannot be disabled: a vendor account always keeps its owner.'],
  ])('words the refusal %s', async (code, message) => {
    const { user } = await open('owner', { patch: () => apiErrorResponse(409, code) })
    await user.click(await screen.findByRole('button', { name: 'Disable bina@brand.test' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Disable' }))
    expect((await screen.findByRole('alert')).textContent).toBe(message)
  })
})

describe('staff', () => {
  it('get a 403 page at /team, never the list, and no Team link', async () => {
    const { calls, router } = await open('staff')
    expect(screen.getByRole('heading', { level: 1, name: "You don't have access to this page" })).toBeTruthy()
    expect(screen.getByText(/error 403/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Go to the overview' })).toBeTruthy()
    expect(router.state.location.pathname).toBe('/team')
    expect(screen.queryByRole('link', { name: 'Team' })).toBeNull()
    expect(calls.lists).toBe(0)
    expect(screen.queryByLabelText('Email address')).toBeNull()
  })
})
