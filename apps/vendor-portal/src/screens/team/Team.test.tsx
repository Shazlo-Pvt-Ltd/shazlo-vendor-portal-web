import { screen, waitFor, within } from '@testing-library/react'
import { http } from 'msw'
import { beforeAll, describe, expect, it } from 'vitest'
import { DEMO_INVITED, DEMO_LOGIN, DEMO_STAFF } from '../../mocks/db'
import { renderApp, type Viewport } from '../../test/render'
import { setupMockApi } from '../../test/server'
import { SESSION_CHANNEL } from '../../session/store'
import { typeFast } from '../../test/typeFast'

const { server, db } = setupMockApi()
const SLOW = { timeout: 8000 }

beforeAll(async () => {
  await import('./Team')
})

function countLists() {
  const calls = { lists: 0 }
  server.use(
    http.get('*/v1/vendor/users', () => {
      calls.lists += 1
    }),
  )
  return calls
}

async function open(viewport: Viewport = 'desktop') {
  const view = await renderApp({ route: '/team', viewport })
  expect(await screen.findByRole('heading', { level: 1, name: 'Team' }, SLOW)).toBeInTheDocument()
  await screen.findByText(DEMO_STAFF.email, undefined, SLOW)
  return view
}

const people = () => screen.getByRole('region', { name: /^People \(\d+\)$/ })
/** A member's row (a table row on desktop, a card on phones), found by their email. */
const row = (email: string) => within(people()).getByText(email).closest('tr, li') as HTMLElement
const inviteField = () => screen.getByRole('textbox', { name: 'Their email' })

async function invite(user: Awaited<ReturnType<typeof renderApp>>['user'], email: string) {
  await user.clear(inviteField())
  await typeFast(user, inviteField(), email)
  await user.click(screen.getByRole('button', { name: 'Send invite' }))
}

describe('Team (owners)', () => {
  it('lists everyone in a table on a 1280 px desktop: the owner first, with role, status and last sign-in', async () => {
    await open(1280)
    const table = within(people()).getByRole('table', { name: 'Team members' })
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Email', 'Role', 'Status', 'Last sign-in', 'Actions'])
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((r) => within(r).getAllByRole('cell')[0]!.textContent)).toEqual([`${DEMO_LOGIN.email} (you)`, DEMO_STAFF.email, DEMO_INVITED])
    expect(within(row(DEMO_STAFF.email)).getByText('Staff')).toBeInTheDocument()
    expect(within(row(DEMO_STAFF.email)).getByText('Active')).toBeInTheDocument()
    expect(within(row(DEMO_STAFF.email)).getByRole('cell', { name: /days? ago|^\d{1,2} \w{3}/ })).toBeInTheDocument()
    expect(within(row(DEMO_INVITED)).getByText('Invited')).toBeInTheDocument()
    expect(within(row(DEMO_INVITED)).getByText('Not yet')).toBeInTheDocument()
    // Nobody can act on the owner, who is also the signed-in user.
    expect(within(row(DEMO_LOGIN.email)).queryByRole('button')).toBeNull()
    // One yellow button: Send invite.
    expect(screen.getByRole('main').querySelectorAll('.MuiButton-contained')).toHaveLength(1)
  })

  it.each([
    ['a 390 px phone', 'mobile' as const],
    ['a 768 px tablet', 'tablet' as const],
  ])('shows one card per person on %s, with nothing wider than the screen', async (_name, viewport) => {
    const { container } = await open(viewport)
    expect(within(people()).queryByRole('table')).toBeNull()
    const cards = within(within(people()).getByRole('list', { name: 'Team members' })).getAllByRole('listitem')
    expect(cards).toHaveLength(3)
    expect(within(row(DEMO_INVITED)).getByText(/Has not signed in yet/)).toBeInTheDocument()
    // Mid-sentence, the relative time starts in lower case.
    expect(row(DEMO_LOGIN.email).textContent).toContain('Last signed in just now')
    expect(within(row(DEMO_INVITED)).getByRole('button', { name: `Resend invite to ${DEMO_INVITED}` })).toBeInTheDocument()
    const limit = viewport === 'mobile' ? 358 : 720
    for (const el of container.querySelectorAll('*')) {
      const { width, minWidth } = getComputedStyle(el)
      for (const value of [width, minWidth]) if (value.endsWith('px')) expect(parseFloat(value), `${el.className} is ${value} wide`).toBeLessThanOrEqual(limit)
    }
  })

  it('names every action button starting with the words it shows, so voice control can find it', async () => {
    await open(1280)
    const buttons = within(people()).getAllByRole('button')
    expect(buttons.length).toBeGreaterThan(0)
    for (const button of buttons) {
      const visible = (button.textContent ?? '').trim()
      expect(button.getAttribute('aria-label') ?? visible, `"${visible}" button`).toMatch(new RegExp(`^${visible.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    }
  })

  it('invites by email, says the same whatever the address, and adds the person to the list', async () => {
    const { user } = await open()
    await invite(user, '  ravi@kalkistudio.in ')
    expect(await screen.findByText('If ravi@kalkistudio.in can be invited, we have sent them an email. Ask them to check their spam folder too.')).toBeInTheDocument()
    expect(inviteField()).toHaveValue('')
    expect(await within(people()).findByText('ravi@kalkistudio.in')).toBeInTheDocument()
    expect(within(row('ravi@kalkistudio.in')).getByText('Invited')).toBeInTheDocument()
    expect(db().emails).toEqual([expect.objectContaining({ to: 'ravi@kalkistudio.in', kind: 'invite' })])
  })

  it('checks the address, and names someone already on the team, before sending anything', async () => {
    const { user } = await open()
    const before = db().users.length
    await user.click(screen.getByRole('button', { name: 'Send invite' }))
    expect(inviteField()).toHaveAccessibleDescription('Enter the email of the person to invite.')
    expect(inviteField()).toHaveFocus()
    await invite(user, 'not-an-email')
    expect(inviteField()).toHaveAccessibleDescription('Enter an email like name@brand.in.')
    await invite(user, DEMO_STAFF.email.toUpperCase())
    expect(inviteField()).toHaveAccessibleDescription(`${DEMO_STAFF.email} is already on your team.`)
    await invite(user, DEMO_INVITED)
    expect(inviteField()).toHaveAccessibleDescription(`${DEMO_INVITED} already has an invite. Use "Resend invite" in the list below.`)
    expect(db().users).toHaveLength(before)
    expect(db().emails).toEqual([])
  })

  it('sends one invite on a double click', async () => {
    const { user } = await open()
    await typeFast(user, inviteField(), 'ravi@kalkistudio.in')
    await user.dblClick(screen.getByRole('button', { name: 'Send invite' }))
    await screen.findByText(/If ravi@kalkistudio.in can be invited/)
    expect(db().emails).toHaveLength(1)
  })

  it('says how long to wait after too many invites', async () => {
    db().faults.push({ method: 'POST', path: '/v1/vendor/users', status: 429, code: 'rate_limited' })
    const { user } = await open()
    await invite(user, 'ravi@kalkistudio.in')
    await waitFor(() => expect(inviteField()).toHaveAccessibleDescription('You have sent many invites in the last hour. Try again in 1 minute.'))
  })

  it('resends an invite', async () => {
    const { user } = await open()
    await user.click(within(row(DEMO_INVITED)).getByRole('button', { name: `Resend invite to ${DEMO_INVITED}` }))
    expect(await screen.findByText(`Invite sent again to ${DEMO_INVITED}.`)).toBeInTheDocument()
    expect(db().emails).toEqual([expect.objectContaining({ to: DEMO_INVITED, kind: 'invite' })])
  })

  it('explains an invite that was already accepted, and brings the list up to date', async () => {
    db().faults.push({ path: '/resend-invite', status: 409, code: 'not_invited' })
    const lists = countLists()
    const { user } = await open()
    const before = lists.lists
    await user.click(within(row(DEMO_INVITED)).getByRole('button', { name: `Resend invite to ${DEMO_INVITED}` }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This person has already chosen a password, so there is no invite to resend.')
    await waitFor(() => expect(lists.lists).toBeGreaterThan(before))
  })

  it('turns someone off after a confirmation, and back on', async () => {
    const { user } = await open()
    await user.click(within(row(DEMO_STAFF.email)).getByRole('button', { name: `Turn off ${DEMO_STAFF.email}` }))
    const dialog = await screen.findByRole('dialog', { name: `Turn off ${DEMO_STAFF.email}?` })
    expect(within(dialog).getByText(/signed out everywhere at once/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Turn off' }))
    expect(await screen.findByText(`${DEMO_STAFF.email} is turned off.`)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 10_000 })
    expect(within(row(DEMO_STAFF.email)).getByText('Turned off')).toBeInTheDocument()
    expect(db().users.find((u) => u.email === DEMO_STAFF.email)?.status).toBe('disabled')

    await user.click(within(row(DEMO_STAFF.email)).getByRole('button', { name: `Turn on ${DEMO_STAFF.email}` }))
    await user.click(within(await screen.findByRole('dialog', { name: `Turn on ${DEMO_STAFF.email}?` })).getByRole('button', { name: 'Turn on' }))
    expect(await screen.findByText(`${DEMO_STAFF.email} is turned on.`)).toBeInTheDocument()
    expect(db().users.find((u) => u.email === DEMO_STAFF.email)?.status).toBe('active')
  })

  it('asks for a new invite after turning on someone who never chose a password', async () => {
    db().users.find((u) => u.email === DEMO_INVITED)!.status = 'disabled'
    const { user } = await open()
    await user.click(within(row(DEMO_INVITED)).getByRole('button', { name: `Turn on ${DEMO_INVITED}` }))
    const dialog = await screen.findByRole('dialog', { name: `Turn on ${DEMO_INVITED}?` })
    expect(within(dialog).getByText(/never chose a password needs a new invite/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Turn on' }))
    expect(await screen.findByText(`${DEMO_INVITED} is turned on. Send the invite again so they can choose a password.`)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 10_000 })
    expect(within(row(DEMO_INVITED)).getByText('Invited')).toBeInTheDocument()
    expect(within(row(DEMO_INVITED)).getByRole('button', { name: `Resend invite to ${DEMO_INVITED}` })).toBeInTheDocument()
  })

  it('changes nothing when the confirmation is cancelled', async () => {
    const { user } = await open()
    await user.click(within(row(DEMO_STAFF.email)).getByRole('button', { name: `Turn off ${DEMO_STAFF.email}` }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 10_000 })
    expect(db().users.find((u) => u.email === DEMO_STAFF.email)?.status).toBe('active')
  })

  it.each([
    ['cannot_disable_self', 409, 'You cannot turn off your own access.'],
    ['user_not_found', 404, 'This person is no longer on your team. The list is up to date now.'],
  ])('words the refusal %s', async (code, status, message) => {
    db().faults.push({ method: 'PATCH', path: `/v1/vendor/users/${db().users.find((u) => u.email === DEMO_STAFF.email)!.id}`, status, code })
    const { user } = await open()
    await user.click(within(row(DEMO_STAFF.email)).getByRole('button', { name: `Turn off ${DEMO_STAFF.email}` }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Turn off' }))
    expect(await screen.findByText(message)).toBeInTheDocument()
  })

  it('sends nothing when the owner signs out in another tab while a confirmation is open', async () => {
    const { user, router } = await open()
    await user.click(within(row(DEMO_STAFF.email)).getByRole('button', { name: `Turn off ${DEMO_STAFF.email}` }))
    await screen.findByRole('dialog')
    const otherTab = new BroadcastChannel(SESSION_CHANNEL)
    otherTab.postMessage({ type: 'logout' })
    otherTab.close()
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(db().users.find((u) => u.email === DEMO_STAFF.email)?.status).toBe('active')
  })

  it('keeps a very long or non-Latin email inside a phone card', async () => {
    const long = `${'राधिका.शर्मा.'.repeat(6)}studio@kalkistudio.in`
    db().users.find((u) => u.email === DEMO_STAFF.email)!.email = long
    await renderApp({ route: '/team', viewport: 'mobile' })
    const email = await screen.findByText(long, undefined, SLOW)
    expect(getComputedStyle(email.parentElement!).overflowWrap).toBe('anywhere')
  })

  it('says when the list does not load, and tries again', async () => {
    db().faults.push({ method: 'GET', path: '/v1/vendor/users', network: true })
    const { user } = await renderApp({ route: '/team' })
    expect(await screen.findByText('Your team did not load.', undefined, SLOW)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText(DEMO_STAFF.email)).toBeInTheDocument()
  })
})

describe('Team (staff)', () => {
  it('shows staff a "no access" page, never the list', async () => {
    const lists = countLists()
    await renderApp({ route: '/team', credentials: DEMO_STAFF })
    expect(await screen.findByRole('heading', { level: 1, name: "You don't have access to this page" }, SLOW)).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Their email' })).toBeNull()
    expect(lists.lists).toBe(0)
  })
})
