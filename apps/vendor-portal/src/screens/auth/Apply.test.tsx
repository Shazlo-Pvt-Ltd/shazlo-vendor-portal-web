import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { Schemas } from '../../api/model'
import type { ApplyDraft } from './applyModel'
import { checkApplication } from '../../lib/storeDetails'
import { renderApp } from '../../test/render'
import { server } from '../../test/server'

const DRAFT_KEY = 'shazlo.seller.application-draft.v2'
const OLD_DRAFT_KEY = 'shazlo.seller.application-draft'
const SLOW = { timeout: 8000 }

// Tests type through several pages; give them room on a slow machine.
vi.setConfig({ testTimeout: 40_000, hookTimeout: 60_000 })

type User = Awaited<ReturnType<typeof renderApp>>['user']

// The screen is lazy-loaded; transform it once before the first test.
beforeAll(async () => {
  await import('./Apply')
})

// Every answer of a finished sign-up, as the draft on this device holds it (no account number:
// that is never stored). Tests start on a later page by saving this with another `page`.
type Stored = Omit<ApplyDraft, 'page' | 'payout'> & { payout: Omit<ApplyDraft['payout'], 'account_number' | 'account_number_again'> }
const ANSWERS: Stored = {
  checking: false,
  brand: { brand_name: 'Neel Threads', sells: 'both', city: 'Surat', instagram_or_website: '' },
  contact: { name: 'Asha Patel', phone: '98765 43210', email: 'asha@neelthreads.in' },
  delivery: { mode: 'own', pickup_address: { line1: '', area: '', city: '', pin: '' }, areas: { all_india: false, places: ['Surat', '395007'] }, place: '', delivery_days: '2_3' },
  returns: { window_days: 0, condition: null, refund_days: null },
  payment: { cash: true, upi: true },
  payout: { method: 'bank', holder_name: 'Neel Threads', ifsc: 'hdfc0001234', upi_id: '' },
  business: { legal_name: '', gstin: '' },
  terms: { commission: '', agreed_terms: true, agreed_price_rule: true },
}

function saveDraft(page: number, change: (a: Stored) => void = () => {}) {
  const answers = structuredClone(ANSWERS)
  change(answers)
  localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...answers, page }))
}

async function openAt(page: number, options: { change?: (a: Stored) => void; viewport?: 'mobile' | 'desktop' } = {}) {
  saveDraft(page, options.change)
  const view = await renderApp({ route: '/signup', signedIn: false, viewport: options.viewport })
  await screen.findByRole('heading', { level: 1 }, SLOW)
  return view
}

const next = (user: User) => user.click(screen.getByRole('button', { name: 'Continue' }))
const summary = () => screen.getByRole('group', { name: 'Some answers need fixing' })
const stepText = () => screen.getByText(/^Step \d of 7$/).textContent
const group = (name: string) => screen.getByRole('group', { name })
// The answer beside a label on Check your answers.
const answer = (section: HTMLElement, label: string) => within(section).getByText(label, { selector: 'dt' }).nextElementSibling

async function typeIn(user: User, label: string, text: string) {
  const field = screen.getByRole('textbox', { name: label })
  await user.clear(field)
  await user.click(field)
  await user.paste(text)
}

describe('V-02 Apply to sell: the pages', () => {
  it('starts with what you will need, then one topic per page with Step x of 7', async () => {
    const { user } = await renderApp({ route: '/signup', signedIn: false })
    expect(await screen.findByRole('heading', { level: 1, name: 'Apply to sell' }, SLOW)).toBeInTheDocument()
    expect(screen.getByText('Tell us about your brand in 7 short steps. It takes about 8 minutes.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'What you will need' })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Your pickup address', 'Your bank account or UPI ID', 'Your GST number, if you have one'])
    expect(screen.getByText(/We save your answers on this device/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
    // One yellow button per screen.
    expect(document.querySelectorAll('.MuiButton-contained')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Start' }))
    const heading = await screen.findByRole('heading', { level: 1, name: 'Your brand' })
    expect(heading).toHaveFocus()
    expect(stepText()).toBe('Step 1 of 7')
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
    // Labels say "(optional)"; nothing is marked with an asterisk.
    expect(screen.getByRole('textbox', { name: 'Instagram or website (optional)' })).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('*')
    expect(document.querySelectorAll('[required]')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Apply to sell' })).toHaveFocus()
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
    expect(summary()).toHaveFocus()
    const links = within(summary()).getAllByRole('link').map((l) => l.textContent)
    expect(links).toEqual([
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

  it('checks the contact page and gives phones the right keyboards', async () => {
    const { user } = await openAt(2, { change: (a) => (a.contact = { name: '', phone: '', email: '' }) })
    const phone = screen.getByRole('textbox', { name: 'Mobile number' })
    const email = screen.getByRole('textbox', { name: 'Email' })
    expect(screen.getByRole('textbox', { name: 'Your name' })).toHaveAttribute('autocomplete', 'name')
    expect(phone).toHaveAttribute('type', 'tel')
    expect(phone).toHaveAttribute('autocomplete', 'tel')
    expect(phone).toHaveAttribute('inputmode', 'tel')
    expect(email).toHaveAttribute('autocomplete', 'email')
    expect(email).toHaveAttribute('inputmode', 'email')
    expect(email).toHaveAttribute('autocapitalize', 'none')
    expect(email).toHaveAttribute('spellcheck', 'false')

    await typeIn(user, 'Your name', 'Asha Patel')
    await typeIn(user, 'Mobile number', '12345')
    await typeIn(user, 'Email', 'asha@')
    await next(user)
    expect(phone).toHaveAccessibleDescription('Enter a 10-digit Indian mobile number, like 98250 12345.')
    expect(email).toHaveAccessibleDescription('Enter an email like name@brand.in.')
    await typeIn(user, 'Mobile number', '+91 98765 43210')
    await typeIn(user, 'Email', 'asha@neelthreads.in')
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
    expect(screen.getByRole('textbox', { name: 'House or shop number, building and street' })).toHaveAttribute('autocomplete', 'address-line1')
    expect(screen.queryByRole('group', { name: 'Where do you deliver?' })).toBeNull()
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
    expect(screen.getByRole('group', { name: 'How long does delivery take?' })).toBeInTheDocument()
    await next(user)
    expect(within(summary()).getAllByRole('link').map((l) => l.textContent)).toEqual([
      'Choose All of India, or add the cities or PIN codes you deliver to.',
      'Choose how long delivery takes.',
    ])
  })

  it('takes the places a brand delivers to as removable chips', async () => {
    const { user } = await openAt(3, { change: (a) => (a.delivery = { ...a.delivery, areas: { all_india: false, places: [] } }) })
    await next(user)
    const place = screen.getByRole('textbox', { name: 'City or PIN code' })
    expect(place).toHaveAccessibleDescription('Choose All of India, or add the cities or PIN codes you deliver to.')
    expect(within(summary()).getByRole('link')).toHaveAttribute('href', `#${place.id}`)

    await user.type(place, 'Surat{Enter}')
    expect(screen.queryByRole('group', { name: 'Some answers need fixing' })).toBeNull()
    await user.type(place, '39500')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    const places = screen.getByRole('list', { name: 'Places you deliver to' })
    expect(within(places).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Surat', '39500'])
    await next(user)
    expect(place).toHaveAccessibleDescription('"39500" is not a PIN code. A PIN code has 6 digits, like 380015.')
    await user.click(within(places).getByRole('button', { name: 'Remove 39500' }))
    expect(within(places).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Surat'])
    // A place typed but not added is added by Continue.
    await user.type(place, '395007')
    await next(user)
    expect(await screen.findByRole('heading', { level: 1, name: 'Returns' })).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}').delivery.areas.places).toEqual(['Surat', '395007'])
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await screen.findByRole('heading', { level: 1, name: 'Delivery' })
    expect(within(screen.getByRole('list', { name: 'Places you deliver to' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Surat', '395007'])
  })

  it('hides the return conditions and refund time when there are no returns', async () => {
    const { user } = await openAt(4, { change: (a) => (a.returns = { window_days: null, condition: null, refund_days: null }) })
    const windows = group('How long do shoppers have to return an order?')
    expect(within(windows).getAllByRole('radio').map((r) => r.closest('label')?.textContent)).toEqual(['No returns', '7 days', '14 days', '30 days'])
    await next(user)
    expect(within(summary()).getAllByRole('link').map((l) => l.textContent)).toEqual(['Choose a return window.'])

    await user.click(within(windows).getByRole('radio', { name: '7 days' }))
    expect(group('Which returns do you accept?')).toBeInTheDocument()
    await next(user)
    expect(within(summary()).getAllByRole('link').map((l) => l.textContent)).toEqual(['Choose which returns you accept.', 'Choose how soon you refund.'])

    await user.click(within(windows).getByRole('radio', { name: 'No returns' }))
    expect(screen.queryByRole('group', { name: 'Which returns do you accept?' })).toBeNull()
    expect(screen.queryByRole('group', { name: 'How soon do you refund?' })).toBeNull()
    expect(screen.queryByRole('group', { name: 'Some answers need fixing' })).toBeNull()
    await next(user)
    expect(await screen.findByRole('heading', { level: 1, name: 'Payment on delivery' })).toBeInTheDocument()
  })

  it('needs at least one way to pay on delivery', async () => {
    const { user } = await openAt(5, { change: (a) => (a.payment = { cash: false, upi: false }) })
    await next(user)
    expect(within(summary()).getByRole('link', { name: 'Choose at least one: cash on delivery or UPI on delivery.' })).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'UPI on delivery' }))
    expect(screen.queryByRole('group', { name: 'Some answers need fixing' })).toBeNull()
    await next(user)
    expect(await screen.findByRole('heading', { level: 1, name: 'Payouts' })).toBeInTheDocument()
  })
})

describe('V-02 Apply to sell: payouts and business details', () => {
  it('asks for the account number twice, shows the bank for the IFSC, and never stores the number', async () => {
    const { user } = await openAt(6, { change: (a) => (a.payout = { method: '', holder_name: '', ifsc: '', upi_id: '' }) })
    await next(user)
    expect(within(summary()).getAllByRole('link').map((l) => l.textContent)).toEqual(['Choose a bank account or a UPI ID.'])

    await user.click(screen.getByRole('radio', { name: 'Bank account' }))
    const account = screen.getByRole('textbox', { name: 'Account number' })
    expect(account).toHaveAttribute('inputmode', 'numeric')
    expect(account).toHaveAccessibleDescription('We do not keep the account number on this device. Type it again if you come back later.')
    const ifsc = screen.getByRole('textbox', { name: 'IFSC code' })
    expect(ifsc).toHaveAttribute('autocapitalize', 'none')
    expect(ifsc).toHaveAttribute('autocorrect', 'off')
    expect(ifsc).toHaveAttribute('spellcheck', 'false')

    await typeIn(user, 'Account holder name', 'Neel Threads')
    // Pasting is allowed in both fields.
    await typeIn(user, 'Account number', '5010 0123 4567 4821')
    await typeIn(user, 'Account number again', '5010 0123 4567 4812')
    await typeIn(user, 'IFSC code', 'hdfc0001234')
    expect(await screen.findByText('HDFC Bank, Vastrapur, Ahmedabad')).toBeInTheDocument()
    await next(user)
    expect(within(summary()).getAllByRole('link').map((l) => l.textContent)).toEqual(['The account numbers do not match. Type the same number in both fields.'])

    // An IFSC of no known bank is caught on Continue.
    await typeIn(user, 'Account number again', '5010 0123 4567 4821')
    await typeIn(user, 'IFSC code', 'ABCD0001234')
    await waitFor(() => expect(screen.queryByText(/HDFC Bank/)).toBeNull())
    await new Promise((resolve) => setTimeout(resolve, 50))
    await next(user)
    expect(ifsc).toHaveAccessibleDescription('We could not find this IFSC code. Check it on your cheque book or bank app.')

    const stored = localStorage.getItem(DRAFT_KEY) ?? ''
    expect(stored).toContain('Neel Threads')
    expect(stored).not.toContain('4821')
    expect(JSON.parse(stored).payout).not.toHaveProperty('account_number')

    await user.click(screen.getByRole('radio', { name: 'UPI ID' }))
    const upi = screen.getByRole('textbox', { name: 'UPI ID' })
    expect(upi).toHaveAttribute('autocapitalize', 'none')
    await next(user)
    expect(upi).toHaveAccessibleDescription('Enter your UPI ID.')
    await typeIn(user, 'UPI ID', 'neel.threads@okhdfcbank')
    await next(user)
    expect(await screen.findByRole('heading', { level: 1, name: 'Business details and commission' })).toBeInTheDocument()
  })

  it('needs both agreements, and checks the optional GST number and commission when given', async () => {
    const { user } = await openAt(7, { change: (a) => (a.terms = { commission: '', agreed_terms: false, agreed_price_rule: false }) })
    expect(screen.getByRole('textbox', { name: 'Commission you propose, in % (optional)' })).toHaveAccessibleDescription('Leave empty if you have agreed a rate with our team.')
    expect(screen.getByRole('textbox', { name: 'Commission you propose, in % (optional)' })).toHaveAttribute('inputmode', 'decimal')
    expect(screen.getByRole('link', { name: 'seller terms' })).toHaveAttribute('href', 'https://shazlo.store/seller-terms')
    const priceRule = screen.getByRole('checkbox', { name: 'My price on Shazlo will never be higher than my price anywhere else — my website, shop or other apps.' })

    await typeIn(user, 'GST number (optional)', '24ABCDE1234F1Z0')
    await typeIn(user, 'Commission you propose, in % (optional)', '45')
    await next(user)
    expect(within(summary()).getAllByRole('link').map((l) => l.textContent)).toEqual([
      'Check your GST number. It has 15 characters, like 24ABCDE1234F1Z6.',
      'Enter a rate from 0% to 40%.',
      'Agree to the seller terms to send your application.',
      'Agree to the price rule to send your application.',
    ])
    expect(priceRule).toHaveAccessibleDescription('Agree to the price rule to send your application.')

    // Emptying the optional rate fixes it; a new problem shows on the next Continue.
    await typeIn(user, 'Commission you propose, in % (optional)', 'twelve')
    expect(screen.getByRole('textbox', { name: 'Commission you propose, in % (optional)' })).toHaveAccessibleDescription('Leave empty if you have agreed a rate with our team.')
    await next(user)
    expect(screen.getByRole('textbox', { name: 'Commission you propose, in % (optional)' })).toHaveAccessibleDescription('Enter a percentage, like 12 or 12.5.')
    await typeIn(user, 'Commission you propose, in % (optional)', '12.5')
    await user.clear(screen.getByRole('textbox', { name: 'GST number (optional)' }))
    await user.click(screen.getByRole('checkbox', { name: /I agree to the/ }))
    await user.click(priceRule)
    expect(screen.queryByRole('group', { name: 'Some answers need fixing' })).toBeNull()
    await next(user)
    expect(await screen.findByRole('heading', { level: 1, name: 'Check your answers' })).toBeInTheDocument()
  })
})

describe('V-02 Apply to sell: check answers and send', () => {
  it('reads every answer back with Change links that return to Check your answers', async () => {
    const { user } = await openAt(8, { change: (a) => (a.terms.commission = '12.5') })
    expect(screen.getByRole('heading', { level: 2, name: 'Your brand' })).toBeInTheDocument()
    const brand = screen.getByRole('region', { name: 'Your brand' })
    expect(answer(brand, 'Store name')).toHaveTextContent('Neel Threads')
    expect(answer(brand, 'Sells')).toHaveTextContent('Both')
    const delivery = screen.getByRole('region', { name: 'Delivery' })
    expect(answer(delivery, 'Delivers to')).toHaveTextContent('Surat, 395007')
    expect(answer(delivery, 'Delivery time')).toHaveTextContent('2–3 days')
    expect(within(screen.getByRole('region', { name: 'Returns' })).queryByText('Refund time', { selector: 'dt' })).toBeNull()
    const terms = screen.getByRole('region', { name: 'Business details and commission' })
    expect(answer(terms, 'Commission you propose')).toHaveTextContent('12.5%')
    expect(answer(terms, 'Price rule')).toHaveTextContent('Agreed')

    await user.click(within(delivery).getByRole('button', { name: 'Change Delivery time' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Delivery' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '1–2 days' })).toHaveFocus()
    await user.click(screen.getByRole('radio', { name: '3–5 days' }))
    await next(user)
    // Back to the check page, not on to Returns.
    const again = await screen.findByRole('region', { name: 'Delivery' })
    expect(answer(again, 'Delivery time')).toHaveTextContent('3–5 days')
  })

  it('sends the application as the API takes it, clears the draft and says what happens next', async () => {
    let sent: Schemas['VendorApplication'] | null = null
    server.use(
      http.post('*/api/v1/public/vendor-applications', async ({ request }) => {
        sent = (await request.clone().json()) as Schemas['VendorApplication']
      }),
    )
    const { user, db } = await openAt(6)
    expect(screen.getByText('Picked up where you left off')).toBeInTheDocument()
    // The account number was never stored, so it is typed again.
    await typeIn(user, 'Account number', '5010 0123 4567 4821')
    await typeIn(user, 'Account number again', '5010 0123 4567 4821')
    await next(user)
    await screen.findByRole('heading', { level: 1, name: 'Business details and commission' })
    await next(user)
    await screen.findByRole('heading', { level: 1, name: 'Check your answers' })
    expect(answer(screen.getByRole('region', { name: 'Payouts' }), 'Paid to')).toHaveTextContent('HDFC Bank •••• 4821')
    expect(document.querySelectorAll('.MuiButton-contained')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Send application' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Application received' })).toBeInTheDocument()
    expect(sent).toEqual({
      brand_name: 'Neel Threads',
      sells: 'both',
      city: 'Surat',
      owner_name: 'Asha Patel',
      phone: '9876543210',
      email: 'asha@neelthreads.in',
      delivery: { mode: 'own', areas: { all_india: false, places: ['Surat', '395007'] }, delivery_days: '2_3' },
      returns: { window_days: 0, condition: null, refund_days: null },
      pay_on_delivery: { cash: true, upi: true },
      payout: { method: 'bank', holder_name: 'Neel Threads', account_number: '5010012345674821', ifsc: 'HDFC0001234' },
      agreed_terms: true,
      agreed_price_rule: true,
    })
    expect(checkApplication(sent)).toEqual({})
    expect(db.applications).toHaveLength(1)
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
    expect(screen.getByText('Thank you, Asha. We have your application for Neel Threads.')).toBeInTheDocument()
    expect(screen.getByText('Our team reviews it within 2 working days.')).toBeInTheDocument()
    expect(screen.getByText('We agree your commission with you before you start selling.')).toBeInTheDocument()
    expect(screen.getByText('If it is approved, we email asha@neelthreads.in a link to set your password.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login')
  })

  it('adds the proposed commission and business details when given', async () => {
    let sent: Schemas['VendorApplication'] | null = null
    server.use(
      http.post('*/api/v1/public/vendor-applications', async ({ request }) => {
        sent = (await request.clone().json()) as Schemas['VendorApplication']
      }),
    )
    const { user } = await openAt(6, {
      change: (a) => {
        a.payout = { method: 'upi', holder_name: '', ifsc: '', upi_id: 'Neel.Threads@okhdfcbank' }
        a.business = { legal_name: 'Neel Threads LLP', gstin: '24aakfk1234l1zd' }
        a.terms.commission = '12.5'
        a.delivery = { ...a.delivery, mode: 'shazlo', pickup_address: { line1: '4 Ring Road', area: 'Athwa', city: 'Surat', pin: '395 007' } }
        a.returns = { window_days: 7, condition: 'unworn_with_tags', refund_days: 5 }
      },
    })
    await next(user)
    await next(user)
    await user.click(await screen.findByRole('button', { name: 'Send application' }))
    await screen.findByRole('heading', { level: 1, name: 'Application received' })
    expect(sent).toMatchObject({
      delivery: { mode: 'shazlo', pickup_address: { line1: '4 Ring Road', area: 'Athwa', city: 'Surat', pin: '395007' } },
      returns: { window_days: 7, condition: 'unworn_with_tags', refund_days: 5 },
      payout: { method: 'upi', upi_id: 'neel.threads@okhdfcbank' },
      legal_name: 'Neel Threads LLP',
      gstin: '24AAKFK1234L1ZD',
      proposed_commission_bps: 1250,
    })
  })

  it('takes the seller to the earliest page the server questioned, then on to the next', async () => {
    server.use(
      http.post(
        '*/api/v1/public/vendor-applications',
        () =>
          HttpResponse.json(
            {
              message: 'Check the highlighted fields.',
              extra: { code: 'validation_error', fields: { 'payout.ifsc': 'We could not find this IFSC code. Check it on your cheque book or bank app.', owner_name: 'A seller with this name has already applied.' } },
            },
            { status: 422 },
          ),
        { once: true },
      ),
    )
    const { user, db } = await openAt(6)
    await typeIn(user, 'Account number', '5010 0123 4567 4821')
    await typeIn(user, 'Account number again', '5010 0123 4567 4821')
    await next(user)
    await next(user)
    await user.click(await screen.findByRole('button', { name: 'Send application' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Contact' })).toBeInTheDocument()
    expect(summary()).toHaveFocus()
    expect(screen.getByRole('textbox', { name: 'Your name' })).toHaveAccessibleDescription('A seller with this name has already applied.')
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
    expect(db.applications[0]).toMatchObject({ owner_name: 'Asha P.' })
  })

  it('keeps the page and the answers when the network fails', async () => {
    server.use(http.post('*/api/v1/public/vendor-applications', () => HttpResponse.error(), { once: true }))
    const { user } = await openAt(6)
    await typeIn(user, 'Account number', '5010 0123 4567 4821')
    await typeIn(user, 'Account number again', '5010 0123 4567 4821')
    await next(user)
    await next(user)
    await user.click(await screen.findByRole('button', { name: 'Send application' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/offline|did not send/)
    expect(screen.getByRole('heading', { level: 1, name: 'Check your answers' })).toBeInTheDocument()
    expect(localStorage.getItem(DRAFT_KEY)).not.toBeNull()
  })
})

describe('V-02 Apply to sell: the draft on this device', () => {
  it('picks up where the seller left off, and Start over clears it', async () => {
    const { user } = await openAt(3)
    expect(screen.getByText('Picked up where you left off')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Delivery' })).toBeInTheDocument()
    expect(stepText()).toBe('Step 3 of 7')
    expect(screen.getByRole('radio', { name: /^We deliver ourselves/ })).toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Start over' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Apply to sell' })).toBeInTheDocument()
    expect(screen.queryByText('Picked up where you left off')).toBeNull()
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
  })

  it('saves answers as they are typed', async () => {
    const { user } = await renderApp({ route: '/signup', signedIn: false })
    await user.click(await screen.findByRole('button', { name: 'Start' }, SLOW))
    await user.type(await screen.findByRole('textbox', { name: 'Store name' }), 'Neel')
    expect(JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null')).toMatchObject({ page: 1, brand: { brand_name: 'Neel' } })
  })

  it('throws away drafts of the old form and drafts it cannot read', async () => {
    localStorage.setItem(OLD_DRAFT_KEY, JSON.stringify({ step: 2, brand: { brand_name: 'Kalki Studio', city: 'Ahmedabad', instagram_or_website: '' } }))
    localStorage.setItem(DRAFT_KEY, '{"page": 3, "brand": ')
    await renderApp({ route: '/signup', signedIn: false })
    expect(await screen.findByRole('heading', { level: 1, name: 'Apply to sell' }, SLOW)).toBeInTheDocument()
    expect(screen.queryByText('Picked up where you left off')).toBeNull()
    expect(localStorage.getItem(OLD_DRAFT_KEY)).toBeNull()
  })
})

describe('V-02 Apply to sell: phones', () => {
  it('fits a 390 px phone with Continue in a sticky footer', async () => {
    const { container } = await openAt(1, { viewport: 'mobile' })
    for (const el of container.querySelectorAll('*')) {
      const style = getComputedStyle(el)
      for (const value of [style.width, style.minWidth]) {
        if (value.endsWith('px')) expect(parseFloat(value), `${el.className} is ${value} wide`).toBeLessThanOrEqual(358)
      }
    }
    const footer = container.querySelector('[data-sticky-footer]')
    expect(footer).not.toBeNull()
    expect(getComputedStyle(footer!).position).toBe('sticky')
    const button = within(footer as HTMLElement).getByRole('button', { name: 'Continue' })
    expect(parseFloat(getComputedStyle(button).minHeight)).toBeGreaterThanOrEqual(44)
    expect(getComputedStyle(screen.getByRole('button', { name: 'Back' })).minHeight).toBe('44px')
    // No card on phones: the page runs edge to edge.
    expect(container.querySelector('.MuiCard-root')).toBeNull()
  })
})
