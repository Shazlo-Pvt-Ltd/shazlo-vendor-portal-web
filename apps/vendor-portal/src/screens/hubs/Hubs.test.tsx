import { screen, waitFor, within } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'
import { DEMO_LOGIN, DEMO_STAFF } from '../../mocks/db'
import { renderApp } from '../../test/render'
import { setupMockApi } from '../../test/server'

const { db } = setupMockApi()

// The first render loads the page chunk lazily; give it time on a busy machine.
const SLOW = { timeout: 8000 }

// Load the lazily imported screens once up front, so the first test does not time out while
// the chunk is transformed.
beforeAll(async () => {
  await Promise.all([import('./StoreHub'), import('./AccountHub'), import('../team/Team')])
})

const kalki = () => db().vendors.find((v) => v.name === 'Kalki Studio')!

describe('Store page (the phone Store tab)', () => {
  it('lists Brand page, Store details and Commission', async () => {
    await renderApp({ route: '/store', viewport: 'mobile' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Store' }, SLOW)).toBeInTheDocument()
    const list = screen.getByRole('navigation', { name: 'Store pages' })
    expect(within(list).getByRole('link', { name: /^Brand page/ })).toHaveAttribute('href', '/brand')
    expect(within(list).getByRole('link', { name: /^Store details/ })).toHaveAttribute('href', '/store/details')
    const commission = within(list).getByRole('link', { name: /^Commission/ })
    expect(commission).toHaveAttribute('href', '/store/details#commission')
    // Kalki Studio's rate is agreed at 12%.
    expect(await within(commission).findByText('12% of each sale')).toBeInTheDocument()
  })

  it('says "To do" on what is missing and how the commission stands', async () => {
    // The demo store has no payout yet; take away the live brand page and propose a rate too.
    db().brands.set(kalki().id, db().brands.get(kalki().id)!.filter((v) => v.state !== 'published'))
    db().commissions.set(kalki().id, { state: 'proposed', agreed_bps: null, proposed_bps: 1050, note: null })
    await renderApp({ route: '/store', viewport: 'mobile' })
    const list = await screen.findByRole('navigation', { name: 'Store pages' }, SLOW)
    await waitFor(() => expect(within(list).getAllByText('To do')).toHaveLength(2))
    expect(within(list).getByRole('link', { name: /^Brand page.*To do/ })).toBeInTheDocument()
    expect(within(list).getByRole('link', { name: /^Store details.*To do/ })).toBeInTheDocument()
    expect(within(list).getByText('You proposed 10.5%. Waiting for Shazlo.')).toBeInTheDocument()
  })

  it('never shows a default rate', async () => {
    db().commissions.set(kalki().id, { state: 'not_set', agreed_bps: null, proposed_bps: null, note: null })
    await renderApp({ route: '/store', viewport: 'mobile' })
    const list = await screen.findByRole('navigation', { name: 'Store pages' }, SLOW)
    expect(await within(list).findByText('Not agreed yet')).toBeInTheDocument()
    expect(within(list).queryByText(/%/)).toBeNull()
  })

  it('has no yellow button: it is a page of places', async () => {
    await renderApp({ route: '/store', viewport: 'mobile' })
    await screen.findByRole('navigation', { name: 'Store pages' }, SLOW)
    expect(screen.getByRole('main').querySelectorAll('.MuiButton-contained')).toHaveLength(0)
  })
})

describe('Account page (the phone Account tab)', () => {
  it('names the person, shows their details, and lists Team, Password and Help & support', async () => {
    await renderApp({ route: '/account', viewport: 'mobile' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Account' }, SLOW)).toBeInTheDocument()
    expect(await screen.findByText('Kiran Shah · Owner')).toBeInTheDocument()
    const details = screen.getByRole('region', { name: 'Your details' })
    const value = (label: string) => within(details).getByText(label, { selector: 'dt' }).nextElementSibling
    expect(value('Email')).toHaveTextContent(DEMO_LOGIN.email)
    expect(value('Role')).toHaveTextContent('Owner (manages the team)')
    expect(value('Store')).toHaveTextContent('Kalki Studio')
    const list = screen.getByRole('navigation', { name: 'Account pages' })
    expect(within(list).getByRole('link', { name: /^Team/ })).toHaveAttribute('href', '/team')
    expect(within(list).getByRole('link', { name: /^Password/ })).toHaveAttribute('href', '/account/password')
    expect(within(list).getByRole('link', { name: /^Help & support/ })).toHaveAttribute('href', '/help')
    expect(screen.getByRole('main').querySelectorAll('.MuiButton-contained')).toHaveLength(0)
  })

  it('shows staff as staff, without Team', async () => {
    await renderApp({ route: '/account', credentials: DEMO_STAFF })
    const details = await screen.findByRole('region', { name: 'Your details' }, SLOW)
    await waitFor(() => expect(within(details).getByText('Role', { selector: 'dt' }).nextElementSibling).toHaveTextContent(/^Staff$/))
    expect(within(details).getByText('Email', { selector: 'dt' }).nextElementSibling).toHaveTextContent(DEMO_STAFF.email)
    expect(within(screen.getByRole('navigation', { name: 'Account pages' })).queryByRole('link', { name: /^Team/ })).toBeNull()
  })

  it('still shows who is signed in when the details do not load', async () => {
    db().faults.push({ path: '/v1/vendor/me', status: 500 })
    await renderApp({ route: '/account' })
    const details = await screen.findByRole('region', { name: 'Your details' }, SLOW)
    await waitFor(() => expect(within(details).getByText('Email', { selector: 'dt' }).nextElementSibling).toHaveTextContent(DEMO_LOGIN.email))
    expect(within(details).getByText('Store', { selector: 'dt' }).nextElementSibling).toHaveTextContent('Kalki Studio')
  })

  it('keeps a very long email inside the page on a 390 px phone', async () => {
    const kiran = db().users.find((u) => u.email === DEMO_LOGIN.email)!
    const long = `${'kiran.shah.who.signs.in.with.a.very.long.address'.repeat(3)}@kalkistudio.in`
    kiran.email = long
    await renderApp({ route: '/account', viewport: 'mobile', credentials: { email: long, password: DEMO_LOGIN.password } })
    const details = await screen.findByRole('region', { name: 'Your details' }, SLOW)
    const email = await within(details).findByText(long)
    expect(getComputedStyle(email).overflowWrap).toBe('anywhere')
  })

  it('signs out', async () => {
    const { user, router } = await renderApp({ route: '/account', viewport: 'mobile' })
    const list = await screen.findByRole('navigation', { name: 'Account pages' }, SLOW)
    await user.click(within(list).getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  })

  it('leads back to Account from Team on phones', async () => {
    await renderApp({ route: '/team', viewport: 'mobile' })
    expect(await within(await screen.findByRole('banner', undefined, SLOW)).findByRole('link', { name: 'Back to Account' }, SLOW)).toHaveAttribute('href', '/account')
  })
})
