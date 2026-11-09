import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { renderModule } from '../../test/render'
import { server } from '../../test/server'

type User = ReturnType<typeof renderModule>['user']

async function heading(name: string) {
  return screen.findByRole('heading', { level: 1, name })
}

// The title row: the h1 and the status pill beside it.
function header() {
  return screen.getByRole('heading', { level: 1 }).parentElement!
}

async function openTab(user: User, name: RegExp) {
  await user.click(screen.getByRole('tab', { name }))
}

describe('A-09 Vendor detail', () => {
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
    expect(within(app).getByText('Shawls')).toBeInTheDocument()
    expect(within(app).getByText('₹999 – ₹6,499')).toBeInTheDocument()
    expect(within(app).getByText(/Hand-woven Kala cotton/)).toBeInTheDocument()

    const checks = screen.getByRole('region', { name: 'Automatic checks' })
    expect(within(checks).getByText('All passed')).toBeInTheDocument()

    const approval = screen.getByRole('region', { name: 'Approval settings' })
    expect(within(approval).getByRole('spinbutton', { name: 'Commission %' })).toHaveValue(15)
    expect(within(approval).getByRole('textbox', { name: 'Owner login email' })).toHaveValue('aarti@rannweaves.in')
    expect(screen.getByRole('button', { name: 'Ask for more info' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve and invite' })).toBeDisabled()
    expect(screen.getByText('Tick “Vendor agreement signed” below to approve.')).toBeInTheDocument()
  })

  it('approves an application with a commission of 12% once the agreement is ticked', async () => {
    const { user, db, shell } = renderModule({ route: '/vendors/v_rann' })
    await heading('Rann Weaves')
    const commission = screen.getByRole('spinbutton', { name: 'Commission %' })
    await user.clear(commission)
    await user.type(commission, '12')
    await user.click(screen.getByRole('checkbox', { name: 'Vendor agreement signed (offline)' }))
    const approve = screen.getByRole('button', { name: 'Approve and invite' })
    await waitFor(() => expect(approve).toBeEnabled())
    await user.click(approve)

    expect(await screen.findByText('Approved Rann Weaves. Aarti Chauhan has been sent an invite to set a password.')).toBeInTheDocument()
    const rann = db.vendors.find((v) => v.id === 'v_rann')!
    expect(rann.status).toBe('approved')
    expect(rann.commission_bps).toBe(1200)
    expect(rann.history[0]).toMatchObject({ event: 'invited', by: 'Priya Mehta' })
    expect(shell.toasts()).toContainEqual({ level: 'success', message: 'Approved Rann Weaves' })
    await waitFor(() => expect(within(header()).getByText('Approved')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Suspend' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve and invite' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Approval settings' })).not.toBeInTheDocument()
  })

  it('keeps Approve disabled until the settings are valid, and explains why', async () => {
    const { user, db } = renderModule({ route: '/vendors/v_rann' })
    await heading('Rann Weaves')
    const approve = screen.getByRole('button', { name: 'Approve and invite' })
    expect(approve).toBeDisabled()
    expect(approve).toHaveAccessibleDescription('Tick “Vendor agreement signed” below to approve.')

    const commission = screen.getByRole('spinbutton', { name: 'Commission %' })
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
    expect(db.vendors.find((v) => v.id === 'v_rann')!.status).toBe('applied')
  })

  it('puts field errors from the API on the matching fields', async () => {
    server.use(
      http.post('*/api/v1/admin/vendors/:id/approve', () =>
        HttpResponse.json({ message: 'Check the commission.', extra: { code: 'validation_error', fields: { commission_bps: 'Commission for this category is capped at 20%.' } } }, { status: 422 }),
      ),
    )
    const { user } = renderModule({ route: '/vendors/v_rann' })
    await heading('Rann Weaves')
    const commission = screen.getByRole('spinbutton', { name: 'Commission %' })
    await user.clear(commission)
    await user.type(commission, '30')
    await user.click(screen.getByRole('checkbox', { name: 'Vendor agreement signed (offline)' }))
    await user.click(screen.getByRole('button', { name: 'Approve and invite' }))
    expect(await screen.findByText('Commission for this category is capped at 20%.')).toBeInTheDocument()
    await waitFor(() => expect(commission).toHaveFocus())
  })

  it('shows a 409 from the API in an error banner', async () => {
    server.use(http.post('*/api/v1/admin/vendors/:id/approve', () => HttpResponse.json({ message: 'Only applications can be approved.', extra: { code: 'invalid_transition' } }, { status: 409 })))
    const { user } = renderModule({ route: '/vendors/v_rann' })
    await heading('Rann Weaves')
    await user.click(screen.getByRole('checkbox', { name: 'Vendor agreement signed (offline)' }))
    await user.click(screen.getByRole('button', { name: 'Approve and invite' }))
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Only applications can be approved.')).toBeInTheDocument()
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
    await heading('Kalki Studio')
    expect(screen.queryByRole('region', { name: 'Approval settings' })).not.toBeInTheDocument()
    await openTab(user, /^Products 4/)
    expect(new URLSearchParams(router.state.location.search).get('tab')).toBe('products')
    const list = screen.getByRole('list', { name: 'Products from this vendor' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(4)
    const ajrakh = within(list).getByRole('link', { name: /Ajrakh Block-Print Kurta/ })
    expect(ajrakh).toHaveAttribute('href', '/review/product/p_ajrakh')
    expect(within(ajrakh).getByText('Pending review')).toBeInTheDocument()
    expect(within(ajrakh).getByText('₹2,499')).toBeInTheDocument()

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
    expect(await screen.findByRole('link', { name: 'Review the submitted brand page' })).toHaveAttribute('href', '/review/brand/v_nila')
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
