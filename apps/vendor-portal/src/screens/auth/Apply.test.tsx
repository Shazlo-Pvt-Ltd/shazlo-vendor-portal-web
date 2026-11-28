import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { DEMO_LOGIN } from '../../mocks/db'
import { clearSensitiveState } from '../../security/sensitiveState'
import { countdownClock } from '../../test/countdown'
import { renderApp } from '../../test/render'
import { setupMockApi } from '../../test/server'
import { emptyDraft, readDraft, writeDraft, type ApplyDraft } from './applyModel'

const { server, db } = setupMockApi()
const SLOW = { timeout: 8000 }
const PASSWORD = 'indigo and madder 26'
const EMAIL = 'asha@neelthreads.in'

// Tests type through several pages; give them room on a slow machine.
vi.setConfig({ testTimeout: 40_000, hookTimeout: 60_000 })

type User = Awaited<ReturnType<typeof renderApp>>['user']

// The screens are lazy-loaded; transform them once before the first test.
beforeAll(async () => {
  await Promise.all([import('./Apply'), import('./SignIn')])
})

// Every answer of a finished sign-up, as the draft in memory holds it (no password and no account
// number: those are never kept). Tests start on a later page by keeping this with another `page`.
function answers(page: number, change: (a: ApplyDraft) => void = () => {}): ApplyDraft {
  const a: ApplyDraft = {
    ...emptyDraft(),
    page,
    brand: { brand_name: 'Neel Threads', sells: 'both', city: 'Surat', instagram_or_website: '' },
    contact: { name: 'Asha Patel', phone: '98765 43210', email: EMAIL },
    delivery: { mode: 'own', pickup_address: { line1: '', area: '', city: '', pin: '' }, areas: { all_india: false, places: ['Surat', '395007'] }, place: '', delivery_days: '2_3' },
    returns: { window_days: 0, condition: null, refund_days: null },
    payment: { cash: true, upi: true },
    payout: { method: 'bank', holder_name: 'Neel Threads', account_number: '', account_number_again: '', ifsc: 'hdfc0001234', upi_id: '' },
    business: { legal_name: 'Neel Threads', gstin: '', gst_registered: false },
    terms: { commission_choice: 'team', commission: '', agreed_terms: true, agreed_price_rule: true },
  }
  change(a)
  return a
}

const TITLES = ['Apply to sell', 'Your brand', 'Contact', 'Delivery', 'Returns', 'Payment on delivery', 'Payouts', 'Business details and commission', 'Check your answers']

/**
 * The seller left the sign-up for another page and came back: the draft kept in memory brings
 * them back to `page`. (A fresh app start clears every draft, as a reload does, so the draft is
 * kept once the app is running.)
 */
async function openAt(page: number, options: { change?: (a: ApplyDraft) => void; viewport?: 'mobile' | 'desktop' } = {}) {
  const view = await renderApp({ route: '/login', signedIn: false, viewport: options.viewport })
  await screen.findByRole('heading', { level: 1, name: 'Sign in to your seller account' }, SLOW)
  writeDraft(answers(page, options.change))
  await act(() => view.router.navigate('/signup'))
  await screen.findByRole('heading', { level: 1, name: TITLES[page] }, SLOW)
  return view
}

const next = (user: User) => user.click(screen.getByRole('button', { name: 'Continue' }))
const summary = () => screen.getByRole('group', { name: 'Some answers need fixing' })
const REQUIRED_NOTE = 'Answer every question unless it says (optional).'
const stepText = () => screen.getByText(/^Step \d of 7$/).textContent
const group = (name: string) => screen.getByRole('group', { name })
// The answer beside a label on Check your answers.
const answer = (section: HTMLElement, label: string) => within(section).getByText(label, { selector: 'dt' }).nextElementSibling
const passwordInput = () => screen.getByLabelText('Choose a password', { selector: 'input' })

async function typeIn(user: User, label: string, text: string) {
  const field = screen.getByRole('textbox', { name: label })
  await user.clear(field)
  await user.click(field)
  await user.paste(text)
}

async function typePassword(user: User, text = PASSWORD) {
  await user.clear(passwordInput())
  await user.click(passwordInput())
  await user.paste(text)
}

/** From a kept draft at Check your answers: Send finds the missing password, then the missing account number. */
async function sendWithSecrets(user: User, { account = true } = {}) {
  await user.click(screen.getByRole('button', { name: 'Send application' }))
  await screen.findByRole('heading', { level: 1, name: 'Contact' })
  expect(passwordInput()).toHaveAccessibleDescription('Choose a password.')
  await typePassword(user)
  await next(user)
  await screen.findByRole('heading', { level: 1, name: 'Check your answers' })
  if (account) {
    await user.click(screen.getByRole('button', { name: 'Send application' }))
    await screen.findByRole('heading', { level: 1, name: 'Payouts' })
    await typeIn(user, 'Account number', '5010 0123 4567 4821')
    await typeIn(user, 'Account number again', '5010 0123 4567 4821')
    await next(user)
    await screen.findByRole('heading', { level: 1, name: 'Check your answers' })
  }
  await user.click(screen.getByRole('button', { name: 'Send application' }))
}

const upi = (a: ApplyDraft) => {
  a.payout = { ...a.payout, method: 'upi', holder_name: '', ifsc: '', upi_id: 'neel.threads@okhdfcbank' }
}

describe('V-02 Apply to sell: the pages', () => {
  it('starts with what you will need, says the answers stay in this tab only, then one topic per page', async () => {
    const { user } = await renderApp({ route: '/signup', signedIn: false })
    expect(await screen.findByRole('heading', { level: 1, name: 'Apply to sell' }, SLOW)).toBeInTheDocument()
    expect(screen.getByText('Tell us about your brand in 7 short steps. It takes about 8 minutes.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'What you will need' })).toBeInTheDocument()
    expect(within(screen.getByRole('main')).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Your pickup address', 'Your bank account or UPI ID', 'Your legal business name, and your GST number if you have one'])
    expect(screen.getByText(/We keep your answers while this tab is open/)).toHaveTextContent('Closing or reloading the page clears them.')
    expect(screen.queryByText(/on this device/)).toBeNull()
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
    // One yellow button per screen.
    expect(document.querySelectorAll('.MuiButton-contained')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Start' }))
    const heading = await screen.findByRole('heading', { level: 1, name: 'Your brand' })
    expect(heading).toHaveFocus()
    expect(stepText()).toBe('Step 1 of 7')
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
    // Every answer is needed: one line says so, and only the exception says "(optional)". No asterisks.
    expect(screen.getByText(REQUIRED_NOTE)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Instagram or website (optional)' })).toBeInTheDocument()
    expect(screen.getAllByRole('textbox', { name: /\(optional\)/ })).toHaveLength(1)
    expect(screen.queryAllByRole('group', { name: /\(optional\)/ })).toHaveLength(0)
    expect(document.body.textContent).not.toContain('*')
    expect(document.querySelectorAll('[required]')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Apply to sell' })).toHaveFocus()
  })

  it('moves one page on a double click of Start or Continue, without checking the next page', async () => {
    const { user } = await openAt(3)
    await user.dblClick(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Returns' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Some answers need fixing' })).toBeNull()
    cleanup()
    const fresh = await renderApp({ route: '/signup', signedIn: false })
    await fresh.user.dblClick(await screen.findByRole('button', { name: 'Start' }, SLOW))
    expect(await screen.findByRole('heading', { level: 1, name: 'Your brand' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Some answers need fixing' })).toBeNull()
  })

  it('checks the brand page only on Continue, lists the problems at the top and clears each once fixed', async () => {
    const { user } = await renderApp({ route: '/signup', signedIn: false })
    await user.click(await screen.findByRole('button', { name: 'Start' }, SLOW))
    await screen.findByRole('heading', { level: 1, name: 'Your brand' })
    const name = screen.getByRole('textbox', { name: 'Store name' })
    await user.type(name, 'K')
    expect(name).not.toHaveAttribute('aria-invalid', 'true')

    await user.clear(name)
    await typeIn(user, 'Instagram or website (optional)', 'my shop!')
    await next(user)
    // Continue stays on the page and takes you to the first answer it needs.
    expect(screen.getByRole('heading', { level: 1, name: 'Your brand' })).toBeInTheDocument()
    expect(name).toHaveFocus()
    expect(within(summary()).getAllByRole('link').map((l) => l.textContent)).toEqual([
      'Add your store name.',
      'Choose who you sell for: women, men or both.',
      'Add the city or area you ship from, like Ahmedabad.',
      'Enter an Instagram handle like @kalki.studio or a website like kalkistudio.in.',
    ])
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(name).toHaveAccessibleDescription('Add your store name.')
    expect(group('Who do you sell for?')).toHaveAccessibleDescription('Choose who you sell for: women, men or both.')

    // A summary link takes you to its field.
    await user.click(within(summary()).getByRole('link', { name: 'Add the city or area you ship from, like Ahmedabad.' }))
    expect(screen.getByRole('textbox', { name: 'City or area you ship from' })).toHaveFocus()

    // Fixing an answer clears its message straight away; the rest stay.
    await user.type(name, 'Neel Threads')
    expect(name).not.toHaveAttribute('aria-invalid', 'true')
    expect(within(summary()).queryByText('Add your store name.')).toBeNull()
    await user.click(within(group('Who do you sell for?')).getByRole('radio', { name: 'Both' }))
    await typeIn(user, 'City or area you ship from', 'Surat')
    await user.clear(screen.getByRole('textbox', { name: 'Instagram or website (optional)' }))
    expect(screen.queryByRole('group', { name: 'Some answers need fixing' })).toBeNull()

    await next(user)
    expect(await screen.findByRole('heading', { level: 1, name: 'Contact' })).toHaveFocus()
    expect(stepText()).toBe('Step 2 of 7')
  })

  it('asks for contact details and a password, with the right keyboards and a password the browser can save', async () => {
    const { user } = await openAt(2, { change: (a) => (a.contact = { name: '', phone: '', email: '' }) })
    const phone = screen.getByRole('textbox', { name: 'Mobile number' })
    const email = screen.getByRole('textbox', { name: 'Email' })
    expect(screen.getByRole('textbox', { name: 'Your name' })).toHaveAttribute('autocomplete', 'name')
    expect(phone).toHaveAttribute('type', 'tel')
    expect(phone).toHaveAttribute('inputmode', 'tel')
    expect(email).toHaveAttribute('autocomplete', 'email')
    expect(email).toHaveAttribute('inputmode', 'email')
    const password = passwordInput()
    expect(password).toHaveAttribute('type', 'password')
    expect(password).toHaveAttribute('autocomplete', 'new-password')
    expect(password).toHaveAttribute('autocapitalize', 'none')
    expect(password).toHaveAccessibleDescription('At least 12 characters. You sign in with your email and this password.')
    // The password can be shown while typing, and pasting is never blocked.
    await user.click(screen.getByRole('button', { name: 'Show password' }))
    expect(password).toHaveAttribute('type', 'text')
    await user.click(screen.getByRole('button', { name: 'Hide password' }))

    await typeIn(user, 'Your name', 'Asha Patel')
    await typeIn(user, 'Mobile number', '12345')
    await typeIn(user, 'Email', 'asha@')
    await typePassword(user, 'short')
    await next(user)
    expect(within(summary()).getAllByRole('link').map((l) => l.textContent)).toEqual([
      'Enter a 10-digit Indian mobile number, like 98250 12345.',
      'Enter an email like name@brand.in.',
      'Use at least 12 characters.',
    ])
    expect(password).toHaveAttribute('aria-invalid', 'true')
    await user.click(within(summary()).getByRole('link', { name: 'Use at least 12 characters.' }))
    expect(password).toHaveFocus()

    await typeIn(user, 'Mobile number', '+91 98765 43210')
    await typeIn(user, 'Email', EMAIL)
    // The password cannot be the email address.
    await typePassword(user, ` ${EMAIL.toUpperCase()} `)
    await next(user)
    expect(password).toHaveAccessibleDescription('Your password cannot be your email address.')
    await typePassword(user)
    expect(screen.queryByRole('group', { name: 'Some answers need fixing' })).toBeNull()
    await next(user)
    expect(await screen.findByRole('heading', { level: 1, name: 'Delivery' })).toBeInTheDocument()
  })
})

describe('V-02 Apply to sell: delivery and returns', () => {
  it('asks for the pickup address with Shazlo delivery', async () => {
    const { user } = await openAt(3, { change: (a) => (a.delivery = { ...a.delivery, mode: '', areas: { all_india: null, places: [] }, delivery_days: '' }) })
    expect(screen.queryByRole('textbox', { name: 'PIN code' })).toBeNull()
    await next(user)
    expect(within(summary()).getAllByRole('link').map((l) => l.textContent)).toEqual(['Choose who delivers your orders.'])

    await user.click(screen.getByRole('radio', { name: /^Shazlo delivery service/ }))
    expect(screen.queryByRole('group', { name: 'Some answers need fixing' })).toBeNull()
    expect(screen.getByRole('group', { name: 'Pickup address' })).toBeInTheDocument()
    const pin = screen.getByRole('textbox', { name: 'PIN code' })
    expect(pin).toHaveAttribute('inputmode', 'numeric')
    expect(pin).toHaveAttribute('autocomplete', 'postal-code')
    await typeIn(user, 'PIN code', '38001')
    await next(user)
    expect(within(summary()).getAllByRole('link').map((l) => l.textContent)).toEqual([
      'Add the address: house or shop number, building and street.',
      'Add the area.',
      'Add the city.',
      'Enter a 6-digit PIN code, like 380015.',
    ])

    // Delivering yourself swaps the address for areas and delivery time.
    await user.click(screen.getByRole('radio', { name: /^We deliver ourselves/ }))
    expect(screen.queryByRole('textbox', { name: 'PIN code' })).toBeNull()
    await next(user)
    expect(within(summary()).getAllByRole('link').map((l) => l.textContent)).toEqual([
      'Choose All of India, or add the cities or PIN codes you deliver to.',
      'Choose how long delivery takes.',
    ])
  })

  it('takes the places a brand delivers to as removable chips, and keeps them in the draft', async () => {
    const { user } = await openAt(3, { change: (a) => (a.delivery = { ...a.delivery, areas: { all_india: false, places: [] } }) })
    await next(user)
    const place = screen.getByRole('textbox', { name: 'City or PIN code' })
    expect(within(summary()).getByRole('link')).toHaveAttribute('href', `#${place.id}`)

    await user.type(place, 'Surat{Enter}')
    await user.type(place, '39500')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    const places = screen.getByRole('list', { name: 'Places you deliver to' })
    expect(within(places).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Surat', '39500'])
    await next(user)
    expect(place).toHaveAccessibleDescription('"39500" is not a PIN code. A PIN code has 6 digits, like 380015.')
    await user.click(within(places).getByRole('button', { name: 'Remove 39500' }))
    // A place typed but not added is added by Continue.
    await user.type(place, '395007')
    await next(user)
    expect(await screen.findByRole('heading', { level: 1, name: 'Returns' })).toBeInTheDocument()
    expect(readDraft()?.delivery.areas.places).toEqual(['Surat', '395007'])
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await screen.findByRole('heading', { level: 1, name: 'Delivery' })
    expect(within(screen.getByRole('list', { name: 'Places you deliver to' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Surat', '395007'])
  })

  it('hides the return conditions and refund time when there are no returns', async () => {
    const { user } = await openAt(4, { change: (a) => (a.returns = { window_days: null, condition: null, refund_days: null }) })
    const windows = group('How long do shoppers have to return an order?')
    await next(user)
    expect(within(summary()).getAllByRole('link').map((l) => l.textContent)).toEqual(['Choose a return window.'])
    await user.click(within(windows).getByRole('radio', { name: '7 days' }))
    await next(user)
    expect(within(summary()).getAllByRole('link').map((l) => l.textContent)).toEqual(['Choose which returns you accept.', 'Choose how soon you refund.'])
    await user.click(within(windows).getByRole('radio', { name: 'No returns' }))
    expect(screen.queryByRole('group', { name: 'Which returns do you accept?' })).toBeNull()
    await next(user)
    expect(await screen.findByRole('heading', { level: 1, name: 'Payment on delivery' })).toBeInTheDocument()
  })

  it('needs at least one way to pay on delivery', async () => {
    const { user } = await openAt(5, { change: (a) => (a.payment = { cash: false, upi: false }) })
    await next(user)
    expect(within(summary()).getByRole('link', { name: 'Choose at least one: cash on delivery or UPI on delivery.' })).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'UPI on delivery' }))
    await next(user)
    expect(await screen.findByRole('heading', { level: 1, name: 'Payouts' })).toBeInTheDocument()
  })
})

describe('V-02 Apply to sell: payouts and business details', () => {
  it('asks for the account number twice, shows the bank for the IFSC, and never keeps the number', async () => {
    const { user } = await openAt(6, { change: (a) => (a.payout = { method: '', holder_name: '', account_number: '', account_number_again: '', ifsc: '', upi_id: '' }) })
    await next(user)
    expect(within(summary()).getAllByRole('link').map((l) => l.textContent)).toEqual(['Choose a bank account or a UPI ID.'])

    await user.click(screen.getByRole('radio', { name: 'Bank account' }))
    const account = screen.getByRole('textbox', { name: 'Account number' })
    expect(account).toHaveAttribute('inputmode', 'numeric')
    expect(account).toHaveAccessibleDescription('We do not keep the account number if you leave this page. Type it again if you come back.')

    await typeIn(user, 'Account holder name', 'Neel Threads')
    await typeIn(user, 'Account number', '5010 0123 4567 4821')
    await typeIn(user, 'Account number again', '5010 0123 4567 4812')
    await typeIn(user, 'IFSC code', 'hdfc0001234')
    expect(await screen.findByText('HDFC Bank')).toBeInTheDocument()
    await next(user)
    expect(within(summary()).getAllByRole('link').map((l) => l.textContent)).toEqual(['The account numbers do not match. Type the same number in both fields.'])

    // An IFSC of a bank vendor-api does not list yet is pointed out, so a typo is caught, but it does
    // not stop the seller: vendor-api takes a payout to any well-formed IFSC.
    await typeIn(user, 'Account number again', '5010 0123 4567 4821')
    await typeIn(user, 'IFSC code', 'ABCD0001234')
    expect(await screen.findByText('We do not know the bank for this code yet. Check it on your cheque book or bank app; you can still continue.')).toBeInTheDocument()
    expect(screen.queryByText(/HDFC Bank/)).toBeNull()
    expect(screen.getByRole('textbox', { name: 'IFSC code' })).not.toHaveAttribute('aria-invalid', 'true')

    const kept = JSON.stringify(readDraft())
    expect(kept).toContain('Neel Threads')
    expect(kept).not.toContain('4821')

    await user.click(screen.getByRole('radio', { name: 'UPI ID' }))
    await next(user)
    expect(screen.getByRole('textbox', { name: 'UPI ID' })).toHaveAccessibleDescription('Enter your UPI ID.')
    await typeIn(user, 'UPI ID', 'neel.threads@okhdfcbank')
    await next(user)
    expect(await screen.findByRole('heading', { level: 1, name: 'Business details and commission' })).toBeInTheDocument()
  })

  it('needs the legal name, a GST answer, a commission answer and both agreements', async () => {
    const { user } = await openAt(7, {
      change: (a) => {
        a.business = { legal_name: '', gstin: '', gst_registered: null }
        a.terms = { commission_choice: '', commission: '', agreed_terms: false, agreed_price_rule: false }
      },
    })
    // Nothing on this page is optional, so nothing says so.
    expect(screen.getByText(REQUIRED_NOTE)).toBeInTheDocument()
    expect(screen.queryAllByRole('textbox', { name: /optional/ })).toHaveLength(0)
    expect(screen.queryAllByRole('group', { name: /optional/ })).toHaveLength(0)
    const legal = screen.getByRole('textbox', { name: 'Legal business name' })
    expect(legal).toHaveAccessibleDescription('As on your PAN, GST or bank papers. If you trade under your own name, write that.')
    // The number and the rate appear only once the seller says they have one.
    expect(screen.queryByRole('textbox', { name: 'GST number' })).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Rate you propose, in %' })).toBeNull()
    const terms = screen.getByRole('link', { name: 'seller terms' })
    expect(terms).toHaveAttribute('href', 'https://shazlo.store/seller-terms')
    expect(terms).toHaveAttribute('target', '_blank')
    expect(terms.getAttribute('rel')).toMatch(/noopener|noreferrer/)
    const priceRule = screen.getByRole('checkbox', { name: 'My price on Shazlo will never be higher than my price anywhere else — my website, shop or other apps.' })

    await next(user)
    expect(within(summary()).getAllByRole('link').map((l) => l.textContent)).toEqual([
      'Add your legal business name.',
      'Say whether your business is registered for GST.',
      'Choose how we set your commission.',
      'Agree to the seller terms to send your application.',
      'Agree to the price rule to send your application.',
    ])
    expect(legal).toHaveFocus()
    expect(group('Is your business registered for GST?')).toHaveAccessibleDescription('Say whether your business is registered for GST.')

    await typeIn(user, 'Legal business name', 'Neel Threads LLP')
    await user.click(within(group('Is your business registered for GST?')).getByRole('radio', { name: 'Yes' }))
    const gstin = screen.getByRole('textbox', { name: 'GST number' })
    expect(gstin).toHaveAccessibleDescription('15 characters, like 24ABCDE1234F1Z6.')
    await user.click(within(group('How should we set your commission?')).getByRole('radio', { name: 'Propose a rate' }))
    const rate = screen.getByRole('textbox', { name: 'Rate you propose, in %' })
    expect(rate).toHaveAttribute('inputmode', 'decimal')
    expect(rate).toHaveAccessibleDescription('From 0% to 40%, like 12 or 12.5.')
    await next(user)
    expect(within(summary()).getAllByRole('link').map((l) => l.textContent)).toEqual([
      'Enter your GST number.',
      'Enter the rate you propose, like 12 or 12.5.',
      'Agree to the seller terms to send your application.',
      'Agree to the price rule to send your application.',
    ])
    expect(gstin).toHaveFocus()

    await typeIn(user, 'GST number', '24ABCDE1234F1Z0')
    await typeIn(user, 'Rate you propose, in %', '45')
    await next(user)
    expect(within(summary()).getAllByRole('link').map((l) => l.textContent).slice(0, 2)).toEqual([
      'Check your GST number. It has 15 characters, like 24ABCDE1234F1Z6.',
      'Enter a rate from 0% to 40%.',
    ])

    // Below the GST threshold: say so, and the number goes. Agreeing the rate with the team: the rate goes.
    const notRegistered = within(group('Is your business registered for GST?')).getByRole('radio', { name: /^No, not registered/ })
    expect(notRegistered).toHaveAccessibleName(/below the GST threshold/)
    await user.click(notRegistered)
    expect(screen.queryByRole('textbox', { name: 'GST number' })).toBeNull()
    await user.click(within(group('How should we set your commission?')).getByRole('radio', { name: /^Agree it with the Shazlo team/ }))
    expect(screen.queryByRole('textbox', { name: 'Rate you propose, in %' })).toBeNull()
    await user.click(screen.getByRole('checkbox', { name: /I agree to the/ }))
    await user.click(priceRule)
    expect(screen.queryByRole('group', { name: 'Some answers need fixing' })).toBeNull()
    await next(user)
    expect(await screen.findByRole('heading', { level: 1, name: 'Check your answers' })).toBeInTheDocument()
  })
})

describe('V-02 Apply to sell: check answers', () => {
  it('reads every answer back, the password only as "Chosen", with Change links that return here', async () => {
    const { user } = await openAt(2, { change: (a) => ((a.terms = { ...a.terms, commission_choice: 'propose', commission: '12.5' }), (a.checking = true)) })
    await typePassword(user)
    await next(user)
    await screen.findByRole('heading', { level: 1, name: 'Check your answers' })
    const brand = screen.getByRole('region', { name: 'Your brand' })
    expect(answer(brand, 'Store name')).toHaveTextContent('Neel Threads')
    const contact = screen.getByRole('region', { name: 'Contact' })
    expect(answer(contact, 'Password')).toHaveTextContent('Chosen')
    expect(contact).not.toHaveTextContent(PASSWORD)
    const delivery = screen.getByRole('region', { name: 'Delivery' })
    expect(answer(delivery, 'Delivers to')).toHaveTextContent('Surat, 395007')
    const terms = screen.getByRole('region', { name: 'Business details and commission' })
    expect(answer(terms, 'Commission you propose')).toHaveTextContent('12.5%')

    // Every answer of every page is read back, each with its own Change link.
    const rows = (title: string) => within(screen.getByRole('region', { name: title })).getAllByRole('term').map((dt) => dt.textContent)
    expect(rows('Your brand')).toEqual(['Store name', 'Sells', 'Ships from', 'Instagram or website'])
    expect(rows('Contact')).toEqual(['Name', 'Mobile number', 'Email', 'Password'])
    expect(rows('Delivery')).toEqual(['Who delivers', 'Delivers to', 'Delivery time'])
    expect(rows('Returns')).toEqual(['Returns'])
    expect(rows('Payment on delivery')).toEqual(['Pay on delivery'])
    expect(rows('Payouts')).toEqual(['Paid to', 'Account holder', 'IFSC code'])
    expect(rows('Business details and commission')).toEqual(['Legal business name', 'GST number', 'Commission you propose', 'Seller terms', 'Price rule'])
    for (const region of screen.getAllByRole('region')) {
      expect(within(region).getAllByRole('button', { name: /^Change / })).toHaveLength(within(region).getAllByRole('term').length)
    }
    expect(answer(terms, 'Legal business name')).toHaveTextContent('Neel Threads')
    expect(answer(terms, 'GST number')).toHaveTextContent('Not registered for GST')
    expect(answer(screen.getByRole('region', { name: 'Your brand' }), 'Instagram or website')).toHaveTextContent('Not added')

    // Change on the GST answer opens the question it answers.
    await user.click(within(terms).getByRole('button', { name: 'Change GST number' }))
    await screen.findByRole('heading', { level: 1, name: 'Business details and commission' })
    expect(within(group('Is your business registered for GST?')).getByRole('radio', { name: 'Yes' })).toHaveFocus()
    await next(user)
    await screen.findByRole('heading', { level: 1, name: 'Check your answers' })

    await user.click(within(screen.getByRole('region', { name: 'Delivery' })).getByRole('button', { name: 'Change Delivery time' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Delivery' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '1–2 days' })).toHaveFocus()
    await user.click(screen.getByRole('radio', { name: '3–5 days' }))
    await next(user)
    expect(answer(await screen.findByRole('region', { name: 'Delivery' }), 'Delivery time')).toHaveTextContent('3–5 days')

    await user.click(within(screen.getByRole('region', { name: 'Contact' })).getByRole('button', { name: 'Change Password' }))
    await screen.findByRole('heading', { level: 1, name: 'Contact' })
    expect(passwordInput()).toHaveFocus()
    // The password typed earlier is still there while the page is open.
    expect(passwordInput()).toHaveValue(PASSWORD)
  })
})

describe('V-02 Apply to sell: sending', () => {
  it('creates the account with the store details, clears the draft and asks to confirm the email', async () => {
    let body: Record<string, unknown> | undefined
    server.use(
      http.post('*/v1/auth/signup', async ({ request }) => {
        body = (await request.clone().json()) as Record<string, unknown>
      }),
    )
    const { user } = await openAt(8)
    expect(screen.getByText('Picked up where you left off')).toBeInTheDocument()
    expect(screen.getByText(/We never keep your password or bank account number/)).toBeInTheDocument()
    expect(document.querySelectorAll('.MuiButton-contained')).toHaveLength(1)
    await sendWithSecrets(user)

    expect(await screen.findByRole('heading', { level: 1, name: 'Application received' })).toHaveFocus()
    expect(body).toMatchObject({
      brand_name: 'Neel Threads',
      contact_name: 'Asha Patel',
      email: EMAIL,
      phone: '9876543210',
      password: PASSWORD,
      terms_accepted: true,
      price_rule_accepted: true,
      sells: 'both',
      city: 'Surat',
      store_details: {
        delivery: { mode: 'own', areas: { all_india: false, places: ['Surat', '395007'] }, delivery_days: '2_3' },
        payout: { method: 'bank', holder_name: 'Neel Threads', account_number: '5010012345674821', ifsc: 'HDFC0001234' },
        // Not registered for GST: the legal name goes, the number does not.
        business: { legal_name: 'Neel Threads', gstin: null },
      },
    })
    // The commission is agreed with the team: no proposal is sent.
    expect(body).not.toHaveProperty('proposed_commission_bps')
    // The account exists, waits for its email to be confirmed, and the store waits for review.
    const owner = db().users.find((u) => u.email === EMAIL)!
    expect(owner).toMatchObject({ role: 'owner', verified: false, password: PASSWORD })
    expect(db().vendors.find((v) => v.id === owner.vendor_id)).toMatchObject({ name: 'Neel Threads', status: 'pending' })
    expect(db().emails).toEqual([expect.objectContaining({ to: EMAIL, kind: 'verify' })])
    expect(readDraft()).toBeNull()

    expect(screen.getByText('Thank you, Asha. We have your application for Neel Threads.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Confirm your email' })).toBeInTheDocument()
    expect(screen.getByText(`We sent an email to ${EMAIL}. Open the link in it to confirm your email, then sign in with your password.`)).toBeInTheDocument()
    expect(screen.getByText(/Our team reviews your application within 2 working days/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login')
    expect(document.querySelectorAll('.MuiButton-contained')).toHaveLength(0)
  })

  it('sends another confirmation email on request, then waits before the next', async () => {
    const { user } = await openAt(8, { change: upi })
    await sendWithSecrets(user, { account: false })
    await screen.findByRole('heading', { level: 1, name: 'Application received' })
    // A double click sends one email.
    await user.dblClick(screen.getByRole('button', { name: 'Send the email again' }))
    expect(await screen.findByText(`We sent it again to ${EMAIL}. Check your inbox and spam folder.`)).toBeInTheDocument()
    const again = screen.getByRole('button', { name: /^Send again in \d+ s$/ })
    expect(again).toBeDisabled()
    expect(db().emails.filter((e) => e.kind === 'verify')).toHaveLength(2)
  })

  it('waits as long as the server says after too many emails', async () => {
    const { user } = await openAt(8, { change: upi })
    await sendWithSecrets(user, { account: false })
    await screen.findByRole('heading', { level: 1, name: 'Application received' })
    server.use(http.post('*/v1/auth/resend-verification', () => HttpResponse.json({ error: { code: 'rate_limited', message: 'x' } }, { status: 429, headers: { 'Retry-After': '90' } }), { once: true }))
    const countdown = countdownClock(90)
    await user.click(screen.getByRole('button', { name: 'Send the email again' }))
    expect(await screen.findByText('Too many attempts.')).toBeInTheDocument()
    const again = await screen.findByRole('button', { name: /^Send again in \d+ s$/ })
    expect(again).toBeDisabled()
    countdown(again.textContent, /Send again in (\d+) s/)
  })

  it('gives the same answer for an email that already has an account, so nobody learns which do', async () => {
    const texts: string[] = []
    for (const email of [EMAIL, DEMO_LOGIN.email]) {
      const { user } = await openAt(8, { change: (a) => (upi(a), (a.contact.email = email)) })
      await sendWithSecrets(user, { account: false })
      await screen.findByRole('heading', { level: 1, name: 'Application received' })
      texts.push((screen.getByRole('main').textContent ?? '').split(email).join('EMAIL'))
      cleanup()
    }
    expect(texts[0]).toBe(texts[1])
    expect(texts[1]).not.toMatch(/already|registered|exists|taken/i)
    // The first address was new and gets a link; the second already had an account and is told so by email only.
    expect(db().emails.map((e) => e.kind)).toEqual(['verify', 'exists'])
  })

  it('shows hostile and long non-Latin answers as plain text, and sends them as typed', async () => {
    const brand = '<img src=x onerror=alert(1)> कलकी स्टूडियो 🧵'
    const name = `${'राधिका '.repeat(30).trim()}`
    const { user } = await openAt(8, { change: (a) => (upi(a), (a.brand.brand_name = brand), (a.contact.name = name)) })
    expect(answer(screen.getByRole('region', { name: 'Your brand' }), 'Store name')).toHaveTextContent(brand)
    expect(document.querySelector('img[src="x"]')).toBeNull()
    await sendWithSecrets(user, { account: false })
    await screen.findByRole('heading', { level: 1, name: 'Application received' })
    expect(screen.getByText(`Thank you, राधिका. We have your application for ${brand}.`)).toBeInTheDocument()
    expect(document.querySelector('img[src="x"]')).toBeNull()
    expect(db().vendors.some((v) => v.name === brand)).toBe(true)
  })

  it('adds the proposed commission and business details when given', async () => {
    let body: Record<string, unknown> | undefined
    server.use(
      http.post('*/v1/auth/signup', async ({ request }) => {
        body = (await request.clone().json()) as Record<string, unknown>
      }),
    )
    const { user } = await openAt(8, {
      change: (a) => {
        a.payout = { method: 'upi', holder_name: '', account_number: '', account_number_again: '', ifsc: '', upi_id: 'Neel.Threads@okhdfcbank' }
        a.business = { legal_name: 'Neel Threads LLP', gstin: '24aakfk1234l1zd', gst_registered: true }
        a.terms = { ...a.terms, commission_choice: 'propose', commission: '12.5' }
        a.delivery = { ...a.delivery, mode: 'shazlo', pickup_address: { line1: '4 Ring Road', area: 'Athwa', city: 'Surat', pin: '395 007' } }
        a.returns = { window_days: 7, condition: 'unworn_with_tags', refund_days: 5 }
      },
    })
    await sendWithSecrets(user, { account: false })
    await screen.findByRole('heading', { level: 1, name: 'Application received' })
    expect(body).toMatchObject({
      proposed_commission_bps: 1250,
      store_details: {
        delivery: { mode: 'shazlo', pickup_address: { line1: '4 Ring Road', area: 'Athwa', city: 'Surat', pin: '395007' } },
        returns: { window_days: 7, condition: 'unworn_with_tags', refund_days: 5 },
        payout: { method: 'upi', upi_id: 'neel.threads@okhdfcbank' },
        business: { legal_name: 'Neel Threads LLP', gstin: '24AAKFK1234L1ZD' },
      },
    })
    expect(db().commissions.get(db().users.find((u) => u.email === EMAIL)!.vendor_id)).toMatchObject({ state: 'proposed', proposed_bps: 1250 })
  })

  it('takes the seller to the earliest page the server questioned, then on to the next', async () => {
    const { user } = await openAt(8)
    db().faults.push({
      path: '/v1/auth/signup',
      status: 422,
      code: 'validation_error',
      details: [
        { loc: ['body', 'store_details', 'payout', 'bank', 'ifsc'], msg: 'We could not find this IFSC code. Check it on your cheque book or bank app.' },
        { loc: ['body', 'contact_name'], msg: 'Use letters for your name.' },
      ],
    })
    await sendWithSecrets(user)

    expect(await screen.findByRole('heading', { level: 1, name: 'Contact' })).toBeInTheDocument()
    // Focus goes to the first answer the server questioned, which says what is wrong.
    expect(screen.getByRole('textbox', { name: 'Your name' })).toHaveFocus()
    expect(screen.getByRole('textbox', { name: 'Your name' })).toHaveAccessibleDescription('Use letters for your name.')
    await typeIn(user, 'Your name', 'Asha P.')
    expect(screen.queryByRole('group', { name: 'Some answers need fixing' })).toBeNull()
    await next(user)
    // Next stop: the payout page the server also questioned. The account number is still in memory.
    expect(await screen.findByRole('heading', { level: 1, name: 'Payouts' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'IFSC code' })).toHaveAccessibleDescription('We could not find this IFSC code. Check it on your cheque book or bank app.')
    expect(screen.getByRole('textbox', { name: 'Account number' })).toHaveValue('5010 0123 4567 4821')
    await next(user)
    await user.click(await screen.findByRole('button', { name: 'Send application' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Application received' })).toBeInTheDocument()
    expect(db().stores.get(db().users.find((u) => u.email === EMAIL)!.vendor_id)?.contact?.name).toBe('Asha P.')
  })

  it("puts the server's password refusal on the password field", async () => {
    const { user } = await openAt(8, { change: upi })
    db().faults.push({ path: '/v1/auth/signup', status: 422, code: 'weak_password', message: 'Password is too common' })
    await sendWithSecrets(user, { account: false })
    expect(await screen.findByRole('heading', { level: 1, name: 'Contact' })).toBeInTheDocument()
    expect(passwordInput()).toHaveAccessibleDescription('Password is too common')
    expect(within(summary()).getByRole('link', { name: 'Password is too common' })).toBeInTheDocument()
  })

  it('says plainly when the email already has an account, with a way to sign in', async () => {
    const { user } = await openAt(8, { change: upi })
    db().faults.push({ path: '/v1/auth/signup', status: 409, code: 'email_taken', message: 'Email already registered' })
    await sendWithSecrets(user, { account: false })
    const banner = await screen.findByRole('alert')
    expect(banner).toHaveTextContent(`There is already a seller account for ${EMAIL}.`)
    expect(banner).toHaveTextContent('Sign in with it, or change the email under Contact to apply for another store.')
    expect(within(banner).getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
    expect(screen.getByRole('heading', { level: 1, name: 'Check your answers' })).toBeInTheDocument()
  })

  it('keeps the page and the answers when the network fails, and sends on the next try', async () => {
    const { user } = await openAt(8, { change: upi })
    db().faults.push({ path: '/v1/auth/signup', network: true })
    await sendWithSecrets(user, { account: false })
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server. Check your connection and try again.')
    expect(screen.getByRole('heading', { level: 1, name: 'Check your answers' })).toBeInTheDocument()
    expect(readDraft()?.brand.brand_name).toBe('Neel Threads')
    await user.click(screen.getByRole('button', { name: 'Send application' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Application received' })).toBeInTheDocument()
  })

  it('counts down after too many attempts and does not send until it ends', async () => {
    const { user } = await openAt(8, { change: upi })
    server.use(http.post('*/v1/auth/signup', () => HttpResponse.json({ error: { code: 'rate_limited', message: 'slow down' } }, { status: 429, headers: { 'Retry-After': '42' } }), { once: true }))
    const countdown = countdownClock(42)
    await sendWithSecrets(user, { account: false })
    countdown((await screen.findByText(/Too many attempts. Try again in \d+ s\./)).textContent, /Try again in (\d+) s\./)
    expect(screen.getByRole('button', { name: 'Send application' })).toBeDisabled()
  })

  it('sends once on a double click', async () => {
    let calls = 0
    server.use(
      http.post('*/v1/auth/signup', async () => {
        calls += 1
        await new Promise((resolve) => setTimeout(resolve, 50))
      }),
    )
    const { user } = await openAt(2, { change: (a) => (upi(a), (a.checking = true)) })
    await typePassword(user)
    await next(user)
    await user.dblClick(await screen.findByRole('button', { name: 'Send application' }))
    await screen.findByRole('heading', { level: 1, name: 'Application received' })
    expect(calls).toBe(1)
    expect(db().users.filter((u) => u.email === EMAIL)).toHaveLength(1)
  })

  it('keeps no copy of the password in the query cache once the call has ended', async () => {
    const { user, queryClient } = await openAt(8, { change: upi })
    db().faults.push({ path: '/v1/auth/signup', status: 422, code: 'weak_password', message: 'Password is too common' })
    await sendWithSecrets(user, { account: false })
    await screen.findByRole('heading', { level: 1, name: 'Contact' })
    await waitFor(() => expect(queryClient.getMutationCache().getAll()).toEqual([]))
  })
})

describe('V-02 Apply to sell: the draft in memory', () => {
  it('picks up where the seller left off, and Start over clears it', async () => {
    const { user } = await openAt(3)
    expect(screen.getByText('Picked up where you left off')).toBeInTheDocument()
    expect(stepText()).toBe('Step 3 of 7')
    expect(screen.getByRole('radio', { name: /^We deliver ourselves/ })).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Start over' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Apply to sell' })).toBeInTheDocument()
    expect(screen.queryByText('Picked up where you left off')).toBeNull()
    expect(readDraft()).toBeNull()
  })

  it('keeps answers as they are typed, never in web storage, and never the password', async () => {
    localStorage.clear()
    sessionStorage.clear()
    const { user } = await renderApp({ route: '/signup', signedIn: false })
    await user.click(await screen.findByRole('button', { name: 'Start' }, SLOW))
    await user.type(await screen.findByRole('textbox', { name: 'Store name' }), 'Neel')
    expect(readDraft()).toMatchObject({ page: 1, brand: { brand_name: 'Neel' } })
    await act(() => writeDraft(answers(2)))
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })

  it('is gone after a reload: a new start of the app begins again', async () => {
    writeDraft(answers(3))
    await renderApp({ route: '/signup', signedIn: false })
    expect(await screen.findByRole('heading', { level: 1, name: 'Apply to sell' }, SLOW)).toBeInTheDocument()
    expect(screen.queryByText('Picked up where you left off')).toBeNull()
  })

  it('forgets the typed password when the session state is cleared', async () => {
    const { user } = await openAt(2)
    await typePassword(user)
    act(() => clearSensitiveState())
    await waitFor(() => expect(passwordInput()).toHaveValue(''))
  })
})

describe('V-02 Apply to sell: phones', () => {
  it('fits a 390 px phone with Continue in a sticky footer', async () => {
    const { container } = await openAt(2, { viewport: 'mobile' })
    for (const el of container.querySelectorAll('*')) {
      const style = getComputedStyle(el)
      for (const value of [style.width, style.minWidth]) {
        if (value.endsWith('px')) expect(parseFloat(value), `${el.className} is ${value} wide`).toBeLessThanOrEqual(358)
      }
    }
    const footer = container.querySelector('[data-sticky-footer]')
    expect(footer).not.toBeNull()
    expect(getComputedStyle(footer!).position).toBe('sticky')
    expect(parseFloat(getComputedStyle(within(footer as HTMLElement).getByRole('button', { name: 'Continue' })).minHeight)).toBeGreaterThanOrEqual(44)
    // No card on phones: the page runs edge to edge.
    expect(container.querySelector('.MuiCard-root')).toBeNull()
  })
})
