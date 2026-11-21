import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { MockDb, StoreRecord } from '../../mocks/db'
import { renderApp, type Viewport } from '../../test/render'
import { server, setupMockApi } from '../../test/server'

const SLOW = { timeout: 8000 }
vi.setConfig({ testTimeout: 40_000, hookTimeout: 60_000 })

beforeAll(async () => {
  await Promise.all([import('./StoreDetails'), import('./StoreSection')])
})

const { db } = setupMockApi()
const kalki = () => db().vendors.find((v) => v.name === 'Kalki Studio')!
const store = (): StoreRecord => db().stores.get(kalki().id)!

async function openSection(section: string, { viewport, prepare }: { viewport?: Viewport; prepare?: (db: MockDb) => void } = {}) {
  prepare?.(db())
  const view = await renderApp({ route: `/store/details/${section}`, viewport })
  await screen.findByRole('button', { name: 'Save' }, SLOW)
  return view
}

type User = Awaited<ReturnType<typeof renderApp>>['user']
const save = (user: User) => user.click(screen.getByRole('button', { name: 'Save' }))
const summary = () => screen.getByRole('group', { name: 'Some answers need fixing' })
const value = (region: HTMLElement, label: string) => within(region).getByText(label, { selector: 'dt' }).nextElementSibling

async function typeIn(user: User, label: string, text: string) {
  const field = screen.getByRole('textbox', { name: label })
  await user.clear(field)
  await user.click(field)
  await user.paste(text)
}

describe('Store details: changing one topic', () => {
  it('opens the sign-up page for the topic with the saved answers, and Save returns to the summary', async () => {
    const { user, router } = await openSection('returns')
    expect(screen.getByRole('heading', { level: 1, name: 'Returns' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Store details' })).toHaveAttribute('href', '/store/details')
    expect(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByText('Returns')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('radio', { name: '7 days' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Unworn with tags' })).toBeChecked()

    await user.click(screen.getByRole('radio', { name: 'No returns' }))
    expect(screen.queryByRole('group', { name: 'Which returns do you accept?' })).toBeNull()
    await save(user)

    await waitFor(() => expect(router.state.location.pathname).toBe('/store/details'))
    const saved = await screen.findByText('Returns saved.', {}, SLOW)
    expect(saved.closest('[tabindex="-1"]')).toHaveFocus()
    expect(store().returns).toEqual({ window_days: 0, condition: null, refund_days: null })
    expect(value(screen.getByRole('region', { name: 'Returns' }), 'Returns')).toHaveTextContent('No returns')
    // In the page, not a toast.
    expect(document.querySelector('.MuiSnackbar-root')).toBeNull()
  })

  it('checks on Save, then saves a bank account and says the store details are complete', async () => {
    const { user } = await openSection('payout')
    expect(screen.getByRole('heading', { level: 1, name: 'Payouts' })).toBeInTheDocument()
    await save(user)
    expect(summary()).toHaveFocus()
    expect(within(summary()).getAllByRole('link').map((l) => l.textContent)).toEqual(['Choose a bank account or a UPI ID.'])
    expect(store().payout).toBeNull()

    await user.click(screen.getByRole('radio', { name: 'Bank account' }))
    await typeIn(user, 'Account holder name', 'Kalki Studio LLP')
    await typeIn(user, 'Account number', '5010 0123 4548 21')
    await typeIn(user, 'Account number again', '5010 0123 4548 21')
    await typeIn(user, 'IFSC code', 'hdfc0001234')
    // vendor-api names the bank; it has no branch names yet.
    expect(await screen.findByText('HDFC Bank')).toBeInTheDocument()
    await save(user)

    expect(await screen.findByText('Payouts saved.', {}, SLOW)).toBeInTheDocument()
    expect(screen.getByText('Your store details are complete. You can send products for review.')).toBeInTheDocument()
    expect(store().payout).toEqual({ method: 'bank', holder_name: 'Kalki Studio LLP', account_number: '50100123454821', ifsc: 'HDFC0001234' })
    const payouts = screen.getByRole('region', { name: 'Payouts' })
    expect(value(payouts, 'Paid to')).toHaveTextContent('HDFC Bank •••• 4821')
    expect(within(payouts).queryByText('To do')).toBeNull()
    expect(screen.queryByText('Finish these before you can send products for review')).toBeNull()
  })

  it('starts a saved payout from its masked summary: the full number is typed again', async () => {
    const { user } = await openSection('payout', {
      prepare: () => {
        store().payout = { method: 'bank', holder_name: 'Kalki Studio LLP', account_number: '50100123454821', ifsc: 'HDFC0001234' }
      },
    })
    expect(screen.getByText('Now paid to').nextElementSibling).toHaveTextContent('HDFC Bank •••• 4821')
    expect(screen.getByRole('textbox', { name: 'Account holder name' })).toHaveValue('Kalki Studio LLP')
    expect(screen.getByRole('textbox', { name: 'IFSC code' })).toHaveValue('HDFC0001234')
    expect(screen.getByRole('textbox', { name: 'Account number' })).toHaveValue('')
    await save(user)
    expect(within(summary()).getAllByRole('link').map((l) => l.textContent)).toEqual(['Enter the account number.'])
  })

  it('shows what the server refused (422) on the field, and clears it once changed', async () => {
    const { user, router } = await openSection('contact')
    db().faults.push({ path: '/v1/vendor/store-details/contact', method: 'PUT', status: 422, code: 'validation_error', message: 'Request validation failed', details: [{ loc: ['body', 'email'], msg: 'Another store already uses this email.', type: 'value_error' }] })
    expect(screen.getByRole('textbox', { name: 'Mobile number' })).toHaveValue('9825012345')
    await typeIn(user, 'Email', 'orders@kalkistudio.in')
    await save(user)

    const email = screen.getByRole('textbox', { name: 'Email' })
    await waitFor(() => expect(email).toHaveAccessibleDescription('Another store already uses this email.'))
    expect(summary()).toHaveFocus()
    expect(router.state.location.pathname).toBe('/store/details/contact')
    expect(store().contact?.email).toBe('kiran@kalkistudio.in')

    await user.type(email, 'x')
    expect(email).not.toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByRole('group', { name: 'Some answers need fixing' })).toBeNull()
    await user.type(email, '{Backspace}')
    await save(user)
    await waitFor(() => expect(router.state.location.pathname).toBe('/store/details'))
    expect(store().contact?.email).toBe('orders@kalkistudio.in')
  })

  it('keeps the answers and says so when the save fails', async () => {
    const { user, router } = await openSection('payment')
    db().faults.push({ path: '/v1/vendor/store-details/payment', method: 'PUT', network: true })
    await user.click(screen.getByRole('checkbox', { name: 'Cash on delivery' }))
    await save(user)
    expect(await screen.findByRole('alert')).toHaveTextContent(/offline|did not save/)
    expect(router.state.location.pathname).toBe('/store/details/payment')
    expect(screen.getByRole('checkbox', { name: 'Cash on delivery' })).not.toBeChecked()
  })

  it('shows the store name but does not edit it', async () => {
    await openSection('brand')
    expect(screen.queryByRole('textbox', { name: 'Store name' })).toBeNull()
    expect(within(screen.getByRole('main')).getByText('Kalki Studio')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ask us to change it' })).toHaveAttribute('href', 'mailto:partners@shazlo.store')
    expect(screen.getByRole('radio', { name: 'Women' })).toBeChecked()
  })

  it('is a full-screen task on phones with Save in a sticky footer', async () => {
    const { container } = await openSection('delivery', { viewport: 'mobile' })
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
    expect(within(screen.getByRole('banner')).getByRole('link', { name: 'Back to Store details' })).toBeInTheDocument()
    // Back lives in the top bar on phones, so the page does not repeat it.
    expect(screen.getAllByRole('link', { name: 'Back to Store details' })).toHaveLength(1)
    const footer = container.querySelector('[data-sticky-footer]') as HTMLElement
    expect(within(footer).getByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(screen.getByRole('main').querySelectorAll('.MuiButton-contained')).toHaveLength(1)
  })

  it('says so when the address names no topic', async () => {
    await renderApp({ route: '/store/details/bank' })
    expect(await screen.findByRole('heading', { level: 1, name: 'We could not find that part of your store details.' }, SLOW)).toBeInTheDocument()
  })
})

describe('Store details: one topic, when things go wrong', () => {
  it('saves once however often Save is pressed', async () => {
    const puts: string[] = []
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'PUT' && request.url.endsWith('/v1/vendor/store-details/returns')) puts.push(request.url)
    })
    const { user, router } = await openSection('returns')
    await user.click(screen.getByRole('radio', { name: 'No returns' }))
    await user.dblClick(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/store/details'))
    expect(await screen.findByText('Returns saved.', {}, SLOW)).toBeInTheDocument()
    expect(puts).toHaveLength(1)
    // One step back from the summary returns to the topic, not to a second copy of the summary.
    expect(router.state.historyAction).toBe('PUSH')
    server.events.removeAllListeners()
  })

  it.each([
    ['an IFSC without the 0', 'HDFC1001234', 'IFSC code'],
  ])('refuses %s', async (_what, typed, label) => {
    const { user } = await openSection('payout')
    await user.click(screen.getByRole('radio', { name: 'Bank account' }))
    await typeIn(user, 'Account holder name', 'Kalki Studio LLP')
    await typeIn(user, 'Account number', '50100123454821')
    await typeIn(user, 'Account number again', '50100123454821')
    await typeIn(user, label, typed)
    await save(user)
    await waitFor(() => expect(screen.getByRole('textbox', { name: label })).toHaveAttribute('aria-invalid', 'true'))
    expect(store().payout).toBeNull()
  })

  it('saves a payout to a bank vendor-api does not list, without a bank name (PR #281)', async () => {
    const { user } = await openSection('payout')
    await user.click(screen.getByRole('radio', { name: 'Bank account' }))
    await typeIn(user, 'Account holder name', 'Kalki Studio LLP')
    await typeIn(user, 'Account number', '123456789042')
    await typeIn(user, 'Account number again', '123456789042')
    await typeIn(user, 'IFSC code', 'abcd0001234')
    await save(user)
    expect(await screen.findByText('Payouts saved.', {}, SLOW)).toBeInTheDocument()
    expect(store().payout).toEqual({ method: 'bank', holder_name: 'Kalki Studio LLP', account_number: '123456789042', ifsc: 'ABCD0001234' })
    expect(value(screen.getByRole('region', { name: 'Payouts' }), 'Paid to')).toHaveTextContent('Bank account •••• 9042')
  })

  it.each([
    ['a PIN code that does not start 1–9', 'delivery', 'PIN code', '012345'],
    ['a PIN code in Devanagari digits', 'delivery', 'PIN code', '३८००१५'],
    ['a number no mobile has', 'contact', 'Mobile number', '12345 67890'],
    ['a phone with letters', 'contact', 'Mobile number', '98250-ABCDE'],
  ])('refuses %s', async (_what, section, label, typed) => {
    const { user } = await openSection(section)
    await typeIn(user, label, typed)
    await save(user)
    expect(screen.getByRole('textbox', { name: label })).toHaveAttribute('aria-invalid', 'true')
    expect(summary()).toHaveFocus()
  })

  it.each([
    ['a UPI ID without a handle', 'kalki.studio@'],
    ['a UPI ID with a space', 'kalki studio@okhdfcbank'],
    ['a UPI ID that is a link', 'javascript:alert(1)@okhdfc'],
  ])('refuses %s', async (_what, typed) => {
    const { user } = await openSection('payout')
    await user.click(screen.getByRole('radio', { name: 'UPI ID' }))
    await typeIn(user, 'UPI ID', typed)
    await save(user)
    expect(screen.getByRole('textbox', { name: 'UPI ID' })).toHaveAttribute('aria-invalid', 'true')
    expect(store().payout).toBeNull()
  })

  it('refuses a link that is not a website or an Instagram name', async () => {
    const { user } = await openSection('brand')
    await typeIn(user, 'Instagram or website (optional)', 'javascript:alert(1)')
    await save(user)
    expect(screen.getByRole('textbox', { name: 'Instagram or website (optional)' })).toHaveAttribute('aria-invalid', 'true')
    expect(store().instagram_or_website).toBe('@kalki.studio')
  })

  it('does not call every IFSC unknown when vendor-api has no IFSC lookup yet', async () => {
    // vendor-api's answer for a route it does not have: a generic not_found, not "no such bank".
    server.use(http.get('*/v1/public/ifsc/:code', () => HttpResponse.json({ error: { code: 'not_found', message: 'Not Found', request_id: 'r1' } }, { status: 404 })))
    const { user, router } = await openSection('payout')
    await user.click(screen.getByRole('radio', { name: 'Bank account' }))
    await typeIn(user, 'Account holder name', 'Kalki Studio LLP')
    await typeIn(user, 'Account number', '50100123454821')
    await typeIn(user, 'Account number again', '50100123454821')
    await typeIn(user, 'IFSC code', 'HDFC0001234')
    await save(user)
    await waitFor(() => expect(router.state.location.pathname).toBe('/store/details'))
    expect(store().payout).toMatchObject({ method: 'bank', ifsc: 'HDFC0001234' })
  })

  it('shows the save as under way on a slow connection, and the page stays put if it then fails', async () => {
    db().faults.push({ path: '/v1/vendor/store-details/returns', method: 'PUT', status: 503, code: 'unavailable', message: 'Busy, try again.' })
    const { user, router } = await openSection('returns')
    await user.click(screen.getByRole('radio', { name: '14 days' }))
    await save(user)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/store/details/returns')
    expect(screen.getByRole('radio', { name: '14 days' })).toBeChecked()
    // A second try goes through.
    await save(user)
    await waitFor(() => expect(router.state.location.pathname).toBe('/store/details'))
    expect(store().returns?.window_days).toBe(14)
  })
})
