import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { renderModule } from '../../test/render'
import { server } from '../../test/server'
import { isSecondary, isSemibold } from '../../test/style'

type User = ReturnType<typeof renderModule>['user']

// The first screen in a file compiles on demand; give it room on a busy machine.
async function heading(name: string) {
  return screen.findByRole('heading', { level: 1, name }, { timeout: 10_000 })
}

// The title row: the h1 and the status pill beside it.
function header() {
  return screen.getByRole('heading', { level: 1 }).parentElement!
}

async function openTab(user: User, name: RegExp) {
  await user.click(screen.getByRole('tab', { name }))
}

describe('A-09 Vendor detail', { timeout: 40_000 }, () => {
  it('shows an application with its checks and approval settings, and names itself to the shell', async () => {
    const { shell } = renderModule({ route: '/vendors/v_rann' })
    await heading('Rann Weaves')
    expect(within(header()).getByText('Applied')).toBeInTheDocument()
    const subtitle = screen.getByText(/Applied 2 days ago · Bhuj, Gujarat ·/)
    const site = within(subtitle).getByRole('link', { name: /instagram\.com\/rannweaves/ })
    expect(site).toHaveAttribute('href', 'https://instagram.com/rannweaves')
    expect(site).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('link', { name: 'Vendors' })).toHaveAttribute('href', '/vendors')
    await waitFor(() => expect(shell.titles()).toContainEqual({ path: '/vendors/v_rann', title: 'Rann Weaves' }))

    const app = screen.getByRole('region', { name: 'Application' })
    expect(within(app).getByText('Aarti Chauhan')).toBeInTheDocument()
    expect(within(app).getByText('aarti@rannweaves.in')).toBeInTheDocument()
    expect(within(app).getByText('Women and men')).toBeInTheDocument()

    const checks = screen.getByRole('region', { name: 'Automatic checks' })
    expect(within(checks).getByText('All passed')).toBeInTheDocument()
    expect(within(checks).getByText('GST number format')).toBeInTheDocument()

    const approval = screen.getByRole('region', { name: 'Approval settings' })
    expect(within(approval).getByRole('textbox', { name: 'Commission' })).toHaveValue('')
    expect(within(approval).getByRole('textbox', { name: 'Owner login email' })).toHaveValue('aarti@rannweaves.in')
    expect(screen.getByRole('button', { name: 'Ask for more info' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve and invite' })).toBeDisabled()
    expect(screen.getByText('Enter the commission below to approve.')).toBeInTheDocument()
  })

  it('shows everything the brand gave at sign-up: Shazlo delivery and a bank account', async () => {
    renderModule({ route: '/vendors/v_kalki' })
    await heading('Kalki Studio')
    const app = screen.getByRole('region', { name: 'Application' })
    const value = (term: string) => within(app).getByText(term, { selector: 'dt' }).nextElementSibling as HTMLElement
    for (const name of ['Brand', 'Contact', 'Delivery', 'Returns', 'Payment on delivery', 'Payouts', 'Business details and commission']) {
      expect(within(app).getByRole('heading', { level: 3, name })).toBeInTheDocument()
    }
    expect(value('Sells')).toHaveTextContent('Women')
    expect(value('Ships from')).toHaveTextContent('Ahmedabad, Gujarat')
    expect(within(value('Instagram or website')).getByRole('link', { name: /instagram\.com\/kalkistudio/ })).toHaveAttribute('href', 'https://instagram.com/kalkistudio')
    expect(value('Name')).toHaveTextContent('Kiran Shah')
    expect(value('Mobile')).toHaveTextContent(/^\+91 /)
    expect(value('Email')).toHaveTextContent('kiran@kalkistudio.in')
    expect(value('Who delivers')).toHaveTextContent('Shazlo delivery service, picked up from them')
    expect(value('Pickup address')).toHaveTextContent('14 Pol Road, near Manek Chowk, Khadia, Ahmedabad 380001')
    expect(value('Return window')).toHaveTextContent('7 days')
    expect(value('Conditions')).toHaveTextContent('Unworn with tags')
    expect(value('Refund time')).toHaveTextContent('5 working days after pickup')
    expect(value('Takes')).toHaveTextContent('Cash and UPI')
    expect(value('Paid to')).toHaveTextContent('Bank account')
    expect(value('Account')).toHaveTextContent('HDFC Bank · •••• 4821')
    expect(value('IFSC')).toHaveTextContent('HDFC0000146')
    expect(value('Account holder')).toHaveTextContent('Kalki Studio LLP')
    expect(value('Legal business name')).toHaveTextContent('Kalki Studio LLP')
    expect(value('GST number')).toHaveTextContent('24AAQFK3912M1Z6')
    expect(value('Proposed commission')).toHaveTextContent('None. They will agree a rate with our team.')
    expect(value('Seller terms')).toHaveTextContent('Agreed')
    expect(value('Price rule')).toHaveTextContent('Agreed. Their price on Shazlo will never be higher than anywhere else.')
    // No full account number anywhere on the page.
    expect(document.body.textContent).not.toMatch(/\d{9,}/)
    // Price range, about and product categories are no longer asked.
    expect(within(app).queryByText('Typical price range')).not.toBeInTheDocument()
    expect(within(app).queryByText('About', { selector: 'dt' })).not.toBeInTheDocument()
  })

  it('sets the page in a hierarchy: semibold titles, labels and names, regular supporting text, an icon per part', async () => {
    renderModule({ route: '/vendors/v_kaaya' })
    await heading('Kaaya Ethnic')
    const app = screen.getByRole('region', { name: 'Application' })
    const checks = screen.getByRole('region', { name: 'Automatic checks' })
    const approval = screen.getByRole('region', { name: 'Approval settings' })
    // Each card and each topic of the application has a small decorative icon before its title.
    for (const region of [app, checks, approval]) {
      expect(within(region).getAllByRole('heading')[0]!.querySelector('[data-title-icon] svg[aria-hidden="true"]')).not.toBeNull()
    }
    for (const topic of within(app).getAllByRole('heading', { level: 3 })) {
      expect(topic.querySelector('[data-title-icon] svg[aria-hidden="true"]')).not.toBeNull()
    }
    // Labels in semibold, their answers in regular ink.
    const sells = within(app).getByText('Sells', { selector: 'dt' })
    expect(isSemibold(sells)).toBe(true)
    expect(isSemibold(sells.nextElementSibling!)).toBe(false)
    // Each check's name in semibold over its note in the secondary ink.
    const failing = within(checks).getByText('Instagram or website shows their own work')
    expect(isSemibold(failing)).toBe(true)
    expect(isSecondary(within(checks).getByText('Several posts are stock photos from other labels'))).toBe(true)
  })

  it('draws its tabs as pressable, in semibold', async () => {
    renderModule({ route: '/vendors/v_kalki' })
    await heading('Kalki Studio')
    const tabs = within(screen.getByRole('tablist', { name: 'Vendor details' })).getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Application', 'Products 4', 'Brand page', expect.stringMatching(/^Activity \d+$/)])
    for (const tab of tabs) {
      expect(getComputedStyle(tab).cursor).toBe('pointer')
      expect(isSemibold(tab)).toBe(true)
    }
  })

  it('shows own delivery, a UPI payout and a proposed rate', async () => {
    renderModule({ route: '/vendors/v_nila' })
    await heading('Nila Handloom')
    const app = screen.getByRole('region', { name: 'Application' })
    const value = (term: string) => within(app).getByText(term, { selector: 'dt' }).nextElementSibling as HTMLElement
    expect(value('Who delivers')).toHaveTextContent('They deliver themselves')
    const areas = value('Areas they deliver to')
    for (const place of ['Bengaluru', 'Mysuru', 'Hubballi', '560001']) expect(within(areas).getByText(place)).toBeInTheDocument()
    expect(value('Delivery time')).toHaveTextContent('2–3 days')
    expect(value('Return window')).toHaveTextContent('14 days')
    expect(value('Conditions')).toHaveTextContent('Any reason')
    expect(value('Refund time')).toHaveTextContent('7 working days after pickup')
    expect(value('Takes')).toHaveTextContent('UPI only')
    expect(value('Paid to')).toHaveTextContent('UPI ID')
    expect(value('UPI ID')).toHaveTextContent('nila••••@okaxis')
    expect(value('Proposed commission')).toHaveTextContent('10%')
  })

  it('says what a brand did not give, and keeps no returns plain', async () => {
    renderModule({ route: '/vendors/v_kutch' })
    await heading('Kutch Kala')
    const app = screen.getByRole('region', { name: 'Application' })
    const value = (term: string) => within(app).getByText(term, { selector: 'dt' }).nextElementSibling as HTMLElement
    expect(value('Legal business name')).toHaveTextContent('Not given')
    expect(value('GST number')).toHaveTextContent('Not given')
    expect(value('Areas they deliver to')).toHaveTextContent('All of India')
    expect(value('Return window')).toHaveTextContent('No returns')
    expect(within(app).queryByText('Conditions', { selector: 'dt' })).not.toBeInTheDocument()
    const checks = screen.getByRole('region', { name: 'Automatic checks' })
    expect(within(checks).queryByText('GST number format')).not.toBeInTheDocument()
  })

  it('flags a GST number in the wrong format', async () => {
    renderModule({ route: '/vendors/v_quick' })
    await heading('QuickFashion Hub')
    const checks = screen.getByRole('region', { name: 'Automatic checks' })
    const gst = within(checks).getByText('GST number format').closest('li')!
    expect(gst).toHaveAttribute('data-state', 'fail')
    expect(within(gst).getByText('07AAACQ123 is not a GST number. It should be 15 characters, like 24AAQFK3912M1Z6.')).toBeInTheDocument()
  })

  it('flags a brand that gave no Instagram or website', async () => {
    renderModule({ route: '/vendors/v_saanjh' })
    await heading('Saanjh Label')
    const app = screen.getByRole('region', { name: 'Application' })
    expect(within(app).getByText('Instagram or website', { selector: 'dt' }).nextElementSibling).toHaveTextContent('Not given')
    const checks = screen.getByRole('region', { name: 'Automatic checks' })
    const link = within(checks).getByText('Instagram or website shows their own work').closest('li')!
    expect(link).toHaveAttribute('data-state', 'fail')
    expect(within(link).getByText('No link given. Ask for photos of pieces they made.')).toBeInTheDocument()
  })

  it('approves an application with a commission of 12% once the agreement is ticked', async () => {
    const { user, db, shell } = renderModule({ route: '/vendors/v_rann' })
    await heading('Rann Weaves')
    const commission = screen.getByRole('textbox', { name: 'Commission' })
    await user.type(commission, '12')
    await user.click(screen.getByRole('checkbox', { name: 'Vendor agreement signed (offline)' }))
    const approve = screen.getByRole('button', { name: 'Approve and invite' })
    await waitFor(() => expect(approve).toBeEnabled())
    await user.click(approve)

    expect(await screen.findByText('Approved Rann Weaves. Aarti Chauhan has been sent an invite to set a password.')).toBeInTheDocument()
    const rann = db.vendors.find((v) => v.id === 'v_rann')!
    expect(rann.status).toBe('approved')
    expect(rann.commission.agreed_bps).toBe(1200)
    expect(rann.history[0]).toMatchObject({ event: 'invited', by: 'Priya Mehta', note: 'Commission 12% · invite sent to aarti@rannweaves.in' })
    expect(shell.toasts()).toContainEqual({ level: 'success', message: 'Approved Rann Weaves' })
    await waitFor(() => expect(within(header()).getByText('Approved')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Suspend' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve and invite' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Approval settings' })).not.toBeInTheDocument()
  })

  it('keeps Approve disabled until the settings are valid, and explains why', async () => {
    const { user, db } = renderModule({ route: '/vendors/v_saanjh' })
    await heading('Saanjh Label')
    const approve = screen.getByRole('button', { name: 'Approve and invite' })
    expect(approve).toBeDisabled()
    expect(approve).toHaveAccessibleDescription('Tick “Vendor agreement signed” below to approve.')

    const commission = screen.getByRole('textbox', { name: 'Commission' })
    await user.clear(commission)
    await user.type(commission, '50')
    expect(await screen.findByText('Enter a commission between 0% and 40%.')).toBeInTheDocument()
    expect(commission).toHaveAccessibleDescription('Enter a commission between 0% and 40%.')
    await user.click(screen.getByRole('checkbox', { name: 'Vendor agreement signed (offline)' }))
    expect(approve).toBeDisabled()
    expect(approve).toHaveAccessibleDescription('Fix the approval settings below to approve.')

    await user.clear(commission)
    await user.type(commission, '40')
    await waitFor(() => expect(approve).toBeEnabled())
    await user.click(screen.getByRole('checkbox', { name: 'Vendor agreement signed (offline)' }))
    await waitFor(() => expect(approve).toBeDisabled())
    expect(db.vendors.find((v) => v.id === 'v_saanjh')!.status).toBe('applied')
  })

  it('puts field errors from the API on the matching fields', async () => {
    server.use(
      http.post('*/api/v1/admin/vendors/:id/approve', () =>
        HttpResponse.json({ error: { code: 'validation_error', message: 'Request validation failed', request_id: 'r', details: [{ loc: ['body', 'commission_bps'], msg: 'Commission for this category is capped at 20%.', type: 'value_error' }] } }, { status: 422 }),
      ),
    )
    const { user } = renderModule({ route: '/vendors/v_rann' })
    await heading('Rann Weaves')
    const commission = screen.getByRole('textbox', { name: 'Commission' })
    await user.type(commission, '30')
    await user.click(screen.getByRole('checkbox', { name: 'Vendor agreement signed (offline)' }))
    await user.click(screen.getByRole('button', { name: 'Approve and invite' }))
    expect(await screen.findByText('Commission for this category is capped at 20%.')).toBeInTheDocument()
    await waitFor(() => expect(commission).toHaveFocus())
  })

  it('shows a 409 from the API in an error banner', async () => {
    server.use(http.post('*/api/v1/admin/vendors/:id/approve', () => HttpResponse.json({ error: { code: 'invalid_status_transition', message: 'Only applications can be approved.', request_id: 'r' } }, { status: 409 })))
    const { user } = renderModule({ route: '/vendors/v_saanjh' })
    await heading('Saanjh Label')
    await user.click(screen.getByRole('checkbox', { name: 'Vendor agreement signed (offline)' }))
    await user.click(screen.getByRole('button', { name: 'Approve and invite' }))
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('This vendor’s status changed. Reload and try again.')).toBeInTheDocument()
  })

  it('asks the applicant for more information', async () => {
    const { user, db, shell } = renderModule({ route: '/vendors/v_rann' })
    await heading('Rann Weaves')
    await user.click(screen.getByRole('button', { name: 'Ask for more info' }))
    const dialog = await screen.findByRole('dialog', { name: 'Ask Rann Weaves for more information' })
    expect(within(dialog).getByText('The applicant gets this by email and their application stays open.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Send question' }))
    expect(await within(dialog).findByText('Write at least 10 characters.')).toBeInTheDocument()
    await user.type(within(dialog).getByRole('textbox', { name: 'What do you need to know?' }), 'Do you weave the wool shawls yourselves?')
    await user.click(within(dialog).getByRole('button', { name: 'Send question' }))

    expect(await screen.findByText('Asked Rann Weaves for more information. Aarti Chauhan gets your question by email.')).toBeInTheDocument()
    const rann = db.vendors.find((v) => v.id === 'v_rann')!
    expect(rann.status).toBe('under_review')
    expect(rann.history[0]).toMatchObject({ event: 'info_requested', note: 'Do you weave the wool shawls yourselves?' })
    expect(shell.toasts()).toContainEqual({ level: 'success', message: 'Asked Rann Weaves for more information' })
    await waitFor(() => expect(within(header()).getByText('More info asked')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Approve and invite' })).toBeInTheDocument()
  })

  it('rejects an application with a reason', async () => {
    const { user, db, shell } = renderModule({ route: '/vendors/v_rann' })
    await heading('Rann Weaves')
    await user.click(screen.getByRole('button', { name: 'Reject' }))
    const dialog = await screen.findByRole('dialog', { name: 'Reject Rann Weaves?' })
    expect(within(dialog).getByText('The applicant sees this reason.')).toBeInTheDocument()
    await user.type(within(dialog).getByRole('textbox', { name: 'Reason for rejecting' }), 'We are not taking shawls this season.')
    await user.click(within(dialog).getByRole('button', { name: 'Reject application' }))

    expect(await screen.findByText('Rejected Rann Weaves. Aarti Chauhan has been emailed your reason.')).toBeInTheDocument()
    expect(db.vendors.find((v) => v.id === 'v_rann')!.status).toBe('rejected')
    expect(shell.toasts()).toContainEqual({ level: 'success', message: 'Rejected Rann Weaves' })
    await waitFor(() => expect(within(header()).getByText('Rejected')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Approve and invite' })).not.toBeInTheDocument()
    expect(screen.getByText('“We are not taking shawls this season.”')).toBeInTheDocument()
  })

  it('highlights a failing automatic check', async () => {
    renderModule({ route: '/vendors/v_kaaya' })
    await heading('Kaaya Ethnic')
    const checks = screen.getByRole('region', { name: 'Automatic checks' })
    expect(within(checks).getByText('1 needs a look')).toBeInTheDocument()
    const failing = within(checks).getByText('Instagram or website shows their own work').closest('li')!
    expect(failing).toHaveAttribute('data-state', 'fail')
    expect(within(failing).getByText('Needs a look:')).toBeInTheDocument()
    expect(within(failing).getByText('Several posts are stock photos from other labels')).toBeInTheDocument()
    const passing = within(checks).getByText('Not on the blocked-sellers list').closest('li')!
    expect(passing).toHaveAttribute('data-state', 'pass')
  })

  it('lists an approved vendor’s products and suspends them', async () => {
    const { user, db, shell, router } = renderModule({ route: '/vendors/v_kalki' })
    // One of the four is live, so it has nothing to review.
    db.products.find((p) => p.id === 'p_handloom')!.status = 'approved'
    await heading('Kalki Studio')
    expect(screen.queryByRole('region', { name: 'Approval settings' })).not.toBeInTheDocument()
    await openTab(user, /^Products 4/)
    expect(new URLSearchParams(router.state.location.search).get('tab')).toBe('products')
    const list = screen.getByRole('list', { name: 'Products from this vendor' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(4)
    // Its review page is keyed by the review's id, found in the queue.
    const ajrakh = await within(list).findByRole('link', { name: /Ajrakh Block-Print Kurta/ })
    expect(ajrakh).toHaveAttribute('href', '/review/product/rev_p_ajrakh')
    expect(within(ajrakh).getByText('Pending review')).toBeInTheDocument()
    expect(within(ajrakh).getByText('₹2,499')).toBeInTheDocument()
    // Only a product waiting for review opens; it says so with a chevron. Names in semibold.
    expect(within(list).getAllByRole('link')).toHaveLength(3)
    expect(ajrakh.querySelector('[data-chevron]')!.closest('[aria-hidden="true"]')).not.toBeNull()
    expect(getComputedStyle(ajrakh).cursor).toBe('pointer')
    expect(isSemibold(within(ajrakh).getByText('Ajrakh Block-Print Kurta'))).toBe(true)
    const live = within(list).getByText('Handloom Cotton Shirt — Rust').closest('li')!
    expect(within(live).queryByRole('link')).toBeNull()
    expect(within(live).getByText('Live')).toBeInTheDocument()
    expect(live.querySelector('[data-chevron]')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Suspend' }))
    const dialog = await screen.findByRole('dialog', { name: 'Suspend Kalki Studio?' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Reason for suspending' }), 'Counterfeit labels reported by two buyers.')
    await user.click(within(dialog).getByRole('button', { name: 'Suspend vendor' }))
    expect(await screen.findByText('Suspended Kalki Studio. Their products are hidden from the app and new orders are paused.')).toBeInTheDocument()
    expect(db.vendors.find((v) => v.id === 'v_kalki')!.status).toBe('suspended')
    expect(shell.toasts()).toContainEqual({ level: 'success', message: 'Suspended Kalki Studio' })
    expect(await screen.findByRole('button', { name: 'Reactivate' })).toBeInTheDocument()
  })

  it('reactivates a suspended vendor', async () => {
    const { user, db } = renderModule({ route: '/vendors/v_trendz' })
    await heading('Trendz Outlet')
    expect(screen.getByText('“Three orders shipped with different products than listed.”')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reactivate' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'Reactivate Trendz Outlet?' })).getByRole('button', { name: 'Reactivate vendor' }))
    expect(await screen.findByText(/^Reactivated Trendz Outlet\./)).toBeInTheDocument()
    expect(db.vendors.find((v) => v.id === 'v_trendz')!.status).toBe('approved')
  })

  it('shows a rejected vendor’s recorded reason and offers no actions', async () => {
    renderModule({ route: '/vendors/v_quick' })
    await heading('QuickFashion Hub')
    const banner = screen.getByRole('status', { name: 'Why this application was rejected' })
    expect(within(banner).getByText(/^Rejected on .* by Priya Mehta$/)).toBeInTheDocument()
    expect(within(banner).getByText('“Shazlo lists independent labels that make their own pieces.”')).toBeInTheDocument()
    for (const name of ['Approve and invite', 'Reject', 'Ask for more info', 'Suspend', 'Reactivate']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
  })

  it('shows the activity timeline in words', async () => {
    const { user } = renderModule({ route: '/vendors/v_kaaya?tab=activity' })
    await heading('Kaaya Ethnic')
    expect(screen.getByRole('tab', { name: 'Activity 2' })).toHaveAttribute('aria-selected', 'true')
    const timeline = screen.getByRole('list', { name: 'Activity, newest first' })
    const items = within(timeline).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(within(items[0]!).getByText('Asked for more information')).toBeInTheDocument()
    expect(isSemibold(within(items[0]!).getByText('Asked for more information'))).toBe(true)
    expect(within(items[0]!).getByText(/by Rahul Desai/)).toBeInTheDocument()
    expect(within(items[0]!).getByText('“Which pieces do you make yourselves, and which do you resell?”')).toBeInTheDocument()
    expect(within(items[1]!).getByText('Applied')).toBeInTheDocument()
    expect(within(items[1]!).getByText(/by Sana Mirza/)).toBeInTheDocument()

    await openTab(user, /^Products 0/)
    expect(await screen.findByRole('heading', { name: 'No products yet' })).toBeInTheDocument()
  })

  it('links to a brand page waiting for review', async () => {
    const { user } = renderModule({ route: '/vendors/v_nila' })
    await heading('Nila Handloom')
    await openTab(user, /^Brand page/)
    expect(await screen.findByRole('link', { name: 'Review the submitted brand page' })).toHaveAttribute('href', '/review/brand/rev_brand_v_nila')
    expect(screen.getByText('Their brand page is live in the app.')).toBeInTheDocument()
  })

  it('says when no brand page is waiting', async () => {
    const { user } = renderModule({ route: '/vendors/v_rann?tab=brand' })
    await heading('Rann Weaves')
    expect(await screen.findByText('No brand page changes are waiting for review.')).toBeInTheDocument()
    expect(screen.getByText('No brand page is live in the app yet.')).toBeInTheDocument()
    await openTab(user, /^Application/)
    expect(screen.getByRole('region', { name: 'Approval settings' })).toBeInTheDocument()
  })

  it('shows not found for an unknown vendor', async () => {
    const { shell } = renderModule({ route: '/vendors/v_nope' })
    expect(await screen.findByRole('heading', { name: 'We could not find that vendor' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Vendors' })).toHaveAttribute('href', '/vendors')
    await waitFor(() => expect(shell.titles()).toContainEqual({ path: '/vendors/v_nope', title: 'Vendor not found' }))
  })
})
