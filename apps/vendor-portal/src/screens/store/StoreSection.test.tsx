import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { MockDb } from '../../mocks/db'
import { renderApp, type Viewport } from '../../test/render'
import { mockDb, server } from '../../test/server'

const SLOW = { timeout: 8000 }
vi.setConfig({ testTimeout: 40_000, hookTimeout: 60_000 })

beforeAll(async () => {
  await Promise.all([import('./StoreDetails'), import('./StoreSection')])
})

function seed(change: (db: MockDb) => void) {
  let changed: MockDb | null = null
  server.use(
    http.all('*/api/v1/*', () => {
      if (changed !== mockDb) {
        change(mockDb)
        changed = mockDb
      }
    }),
  )
}

async function openSection(section: string, { viewport, prepare }: { viewport?: Viewport; prepare?: (db: MockDb) => void } = {}) {
  if (prepare) seed(prepare)
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
    const { user, db, router } = await openSection('returns')
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
    expect(db.store.returns).toEqual({ window_days: 0, condition: null, refund_days: null })
    expect(value(screen.getByRole('region', { name: 'Returns' }), 'Returns')).toHaveTextContent('No returns')
    // In the page, not a toast.
    expect(document.querySelector('.MuiSnackbar-root')).toBeNull()
  })

  it('checks on Save, then saves a bank account and says the store details are complete', async () => {
    const { user, db } = await openSection('payout')
    expect(screen.getByRole('heading', { level: 1, name: 'Payouts' })).toBeInTheDocument()
    await save(user)
    expect(summary()).toHaveFocus()
    expect(within(summary()).getAllByRole('link').map((l) => l.textContent)).toEqual(['Choose a bank account or a UPI ID.'])
    expect(db.store.payout).toBeNull()

    await user.click(screen.getByRole('radio', { name: 'Bank account' }))
    await typeIn(user, 'Account holder name', 'Kalki Studio LLP')
    await typeIn(user, 'Account number', '5010 0123 4548 21')
    await typeIn(user, 'Account number again', '5010 0123 4548 21')
    await typeIn(user, 'IFSC code', 'hdfc0001234')
    expect(await screen.findByText(/^HDFC Bank, /)).toBeInTheDocument()
    await save(user)

    expect(await screen.findByText('Payouts saved.', {}, SLOW)).toBeInTheDocument()
    expect(screen.getByText('Your store details are complete. You can send products for review.')).toBeInTheDocument()
    expect(db.store.payout).toEqual({ method: 'bank', holder_name: 'Kalki Studio LLP', account_number: '50100123454821', ifsc: 'HDFC0001234' })
    const payouts = screen.getByRole('region', { name: 'Payouts' })
    expect(value(payouts, 'Paid to')).toHaveTextContent('HDFC Bank •••• 4821')
    expect(within(payouts).queryByText('To do')).toBeNull()
    expect(screen.queryByText('Finish these before you can send products for review')).toBeNull()
  })

  it('starts a saved payout from its masked summary: the full number is typed again', async () => {
    const { user } = await openSection('payout', {
      prepare: (db) => {
        db.store.payout = { method: 'bank', holder_name: 'Kalki Studio LLP', account_number: '50100123454821', ifsc: 'HDFC0001234' }
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
    server.use(
      http.put(
        '*/api/v1/vendor/store-details/contact',
        () => HttpResponse.json({ message: 'Check the highlighted fields.', extra: { code: 'validation_error', fields: { email: 'Another store already uses this email.' } } }, { status: 422 }),
        { once: true },
      ),
    )
    const { user, db, router } = await openSection('contact')
    expect(screen.getByRole('textbox', { name: 'Mobile number' })).toHaveValue('9825012345')
    await typeIn(user, 'Email', 'orders@kalkistudio.in')
    await save(user)

    const email = screen.getByRole('textbox', { name: 'Email' })
    await waitFor(() => expect(email).toHaveAccessibleDescription('Another store already uses this email.'))
    expect(summary()).toHaveFocus()
    expect(router.state.location.pathname).toBe('/store/details/contact')
    expect(db.store.contact?.email).toBe('kiran@kalkistudio.in')

    await user.type(email, 'x')
    expect(email).not.toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByRole('group', { name: 'Some answers need fixing' })).toBeNull()
    await user.type(email, '{Backspace}')
    await save(user)
    await waitFor(() => expect(router.state.location.pathname).toBe('/store/details'))
    expect(db.store.contact?.email).toBe('orders@kalkistudio.in')
  })

  it('keeps the answers and says so when the save fails', async () => {
    server.use(http.put('*/api/v1/vendor/store-details/payment', () => HttpResponse.error(), { once: true }))
    const { user, router } = await openSection('payment')
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
