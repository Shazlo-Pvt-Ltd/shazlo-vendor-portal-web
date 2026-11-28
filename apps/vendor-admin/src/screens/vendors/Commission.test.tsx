import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, onTestFinished } from 'vitest'
import { renderModule } from '../../test/render'
import { rateErrors } from '../../copy/vendors'
import { server } from '../../test/server'

// Commission is per brand, with no default rate: the card on A-09 for approved brands, and the
// rate asked for when approving an application.

async function open(id: string, name: string) {
  const view = renderModule({ route: `/vendors/${id}` })
  await screen.findByRole('heading', { level: 1, name }, { timeout: 10_000 })
  return view
}

const card = () => screen.getByRole('region', { name: 'Commission' })
const vendorOf = (db: ReturnType<typeof renderModule>['db'], id: string) => db.vendors.find((v) => v.id === id)!

describe('A-09 Commission card', { timeout: 30_000 }, () => {
  it('shows a waiting proposal and approves it', async () => {
    const { user, db, shell } = await open('v_indigo', 'Indigo Loom')
    const c = card()
    expect(within(c).getByText('Rate to review')).toHaveAttribute('data-status', 'pending')
    expect(within(c).getByText('Indigo Loom proposed 10%.')).toBeInTheDocument()
    expect(within(c).getByText('Now 12% of each sale.')).toBeInTheDocument()
    expect(within(c).getByRole('button', { name: 'Send back' })).toBeInTheDocument()
    expect(within(c).getByRole('button', { name: 'Set a different rate' })).toBeInTheDocument()
    const events = db.outbox.length

    await user.click(within(c).getByRole('button', { name: 'Approve 10%' }))
    expect(await screen.findByText('Agreed 10% with Indigo Loom. They see it in their store details.')).toBeInTheDocument()
    const indigo = vendorOf(db, 'v_indigo')
    expect(indigo.commission).toMatchObject({ state: 'agreed', agreed_bps: 1000, proposed_bps: null })
    expect(indigo.history[0]).toMatchObject({ event: 'commission_approved', by: 'Priya Mehta', note: '10% (was 12%)' })
    expect(db.outbox).toHaveLength(events + 1)
    expect(db.outbox[0]).toMatchObject({ event: 'vendor.commission_changed', subject: 'Indigo Loom', payload: { commission_bps: 1000 } })
    expect(shell.toasts()).toContainEqual({ level: 'success', message: 'Agreed 10% with Indigo Loom' })

    await waitFor(() => expect(within(card()).getByText('10%')).toBeInTheDocument())
    expect(within(card()).getByText('of each sale')).toBeInTheDocument()
    expect(within(card()).getByRole('button', { name: 'Change rate' })).toBeInTheDocument()
    expect(within(card()).queryByRole('button', { name: /^Approve/ })).not.toBeInTheDocument()
  })

  it('sends a proposal back only with a note', async () => {
    const { user, db } = await open('v_indigo', 'Indigo Loom')
    await user.click(within(card()).getByRole('button', { name: 'Send back' }))
    const dialog = await screen.findByRole('dialog', { name: 'Send back Indigo Loom’s proposed rate' })
    expect(within(dialog).getByText('The brand sees your note and can propose again. Their rate stays 12% until you agree a new one.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Send back' }))
    expect(await within(dialog).findByText('Write at least 10 characters.')).toBeInTheDocument()
    expect(vendorOf(db, 'v_indigo').commission.state).toBe('proposed')

    const note = 'We can do 10% once you move to Shazlo delivery.'
    await user.type(within(dialog).getByRole('textbox', { name: 'Note to the brand' }), note)
    await user.click(within(dialog).getByRole('button', { name: 'Send back' }))
    expect(await screen.findByText('Sent back Indigo Loom’s proposed rate. Arjun Mehta sees your note in their store details.')).toBeInTheDocument()
    const indigo = vendorOf(db, 'v_indigo')
    expect(indigo.commission).toMatchObject({ state: 'sent_back', agreed_bps: 1200, proposed_bps: 1000, note })
    expect(indigo.history[0]).toMatchObject({ event: 'commission_sent_back', note })

    await waitFor(() => expect(within(card()).getByText('Sent back: waiting for the brand.')).toBeInTheDocument())
    expect(within(card()).getByText(note)).toBeInTheDocument()
    expect(within(card()).getByText('They proposed 10%.')).toBeInTheDocument()
  })

  it('shows a rate that was sent back as waiting for the brand', async () => {
    await open('v_sutra', 'Sutra Collective')
    const c = card()
    expect(within(c).getByText('Sent back', { selector: '[data-status]' })).toBeInTheDocument()
    expect(within(c).getByText('Sent back: waiting for the brand.')).toBeInTheDocument()
    expect(within(c).getByText('They proposed 8%.')).toBeInTheDocument()
    expect(within(c).getByText('Now 15% of each sale.')).toBeInTheDocument()
    expect(within(c).getByText(/^We cannot go to 8% for handloom sarees yet\./)).toBeInTheDocument()
    expect(within(c).queryByRole('button', { name: /^Approve/ })).not.toBeInTheDocument()
    expect(within(c).queryByRole('button', { name: 'Send back' })).not.toBeInTheDocument()
  })

  it('says so when the application was rejected before the rate was saved', async () => {
    const { user, db } = await open('v_kesariya', 'Kesariya Prints')
    await user.click(within(card()).getByRole('button', { name: 'Set rate' }))
    const dialog = await screen.findByRole('dialog', { name: 'Set the commission for Kesariya Prints' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Commission' }), '12')
    vendorOf(db, 'v_kesariya').status = 'rejected'
    await user.click(within(dialog).getByRole('button', { name: 'Save rate' }))

    // vendor-api's `vendor_not_eligible` keeps its own message.
    expect(await screen.findByText('This application was rejected: there is no rate to agree.')).toBeInTheDocument()
    expect(vendorOf(db, 'v_kesariya').commission.agreed_bps).toBeNull()
    // The page reads the vendor again: a rejected brand has no commission card to act on.
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Commission', hidden: true })).not.toBeInTheDocument())
  })

  it('sets a rate for a brand with none, with an optional note', async () => {
    const { user, db } = await open('v_kesariya', 'Kesariya Prints')
    expect(within(card()).getByText('Not agreed yet. The brand has not proposed a rate.')).toBeInTheDocument()
    const events = db.outbox.length
    await user.click(within(card()).getByRole('button', { name: 'Set rate' }))
    const dialog = await screen.findByRole('dialog', { name: 'Set the commission for Kesariya Prints' })
    const rate = within(dialog).getByRole('textbox', { name: 'Commission' })
    expect(rate).toHaveValue('')
    expect(rate).toHaveAttribute('inputmode', 'decimal')

    await user.click(within(dialog).getByRole('button', { name: 'Save rate' }))
    expect(await within(dialog).findByText('Enter the commission, like 12.')).toBeInTheDocument()
    await user.type(rate, '50')
    await user.click(within(dialog).getByRole('button', { name: 'Save rate' }))
    expect(await within(dialog).findByText('Enter a commission between 0% and 40%.')).toBeInTheDocument()
    await user.clear(rate)
    await user.type(rate, '12.5')
    await user.type(within(dialog).getByRole('textbox', { name: 'Note to the brand (optional)' }), 'Agreed on the call with Meera.')
    await user.click(within(dialog).getByRole('button', { name: 'Save rate' }))

    expect(await screen.findByText('Kesariya Prints’s commission is now 12.5% of each sale.')).toBeInTheDocument()
    const kesariya = vendorOf(db, 'v_kesariya')
    expect(kesariya.commission).toMatchObject({ state: 'agreed', agreed_bps: 1250, note: 'Agreed on the call with Meera.' })
    expect(kesariya.history[0]).toMatchObject({ event: 'commission_set', note: '12.5% · Agreed on the call with Meera.' })
    expect(db.outbox).toHaveLength(events + 1)
    expect(db.outbox[0]).toMatchObject({ event: 'vendor.commission_changed', payload: { commission_bps: 1250 } })
    await waitFor(() => expect(within(card()).getByText('12.5%')).toBeInTheDocument())
    expect(within(card()).getByText('Agreed on the call with Meera.')).toBeInTheDocument()
  })

  it('sets a different rate instead of the proposal, which closes it', async () => {
    const { user, db } = await open('v_rangrez', 'Rangrez Studio')
    await user.click(within(card()).getByRole('button', { name: 'Set a different rate' }))
    const dialog = await screen.findByRole('dialog', { name: 'Change the commission for Rangrez Studio' })
    const rate = within(dialog).getByRole('textbox', { name: 'Commission' })
    expect(rate).toHaveValue('15')
    await user.clear(rate)
    await user.type(rate, '13')
    await user.click(within(dialog).getByRole('button', { name: 'Save rate' }))
    expect(await screen.findByText('Rangrez Studio’s commission is now 13% of each sale.')).toBeInTheDocument()
    expect(vendorOf(db, 'v_rangrez').commission).toMatchObject({ state: 'agreed', agreed_bps: 1300, proposed_bps: null, note: null })
    expect(vendorOf(db, 'v_rangrez').history[0]).toMatchObject({ event: 'commission_set', note: '13% (was 15%)' })
  })

  it('changes an agreed rate', async () => {
    const { user, db } = await open('v_kalki', 'Kalki Studio')
    expect(within(card()).getByText('12%')).toBeInTheDocument()
    await user.click(within(card()).getByRole('button', { name: 'Change rate' }))
    const dialog = await screen.findByRole('dialog', { name: 'Change the commission for Kalki Studio' })
    await user.clear(within(dialog).getByRole('textbox', { name: 'Commission' }))
    await user.type(within(dialog).getByRole('textbox', { name: 'Commission' }), '14')
    await user.click(within(dialog).getByRole('button', { name: 'Save rate' }))
    await waitFor(() => expect(vendorOf(db, 'v_kalki').commission.agreed_bps).toBe(1400))
    await waitFor(() => expect(within(card()).getByText('14%')).toBeInTheDocument())
  })

  it('shows a failed approval in an error banner', async () => {
    server.use(http.post('*/v1/admin/vendors/:id/commission/approve', () => HttpResponse.json({ error: { code: 'no_proposal', message: 'There is no proposed rate waiting.', request_id: 'r' } }, { status: 409 })))
    const { user } = await open('v_indigo', 'Indigo Loom')
    await user.click(within(card()).getByRole('button', { name: 'Approve 10%' }))
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('There is no proposed rate waiting.')).toBeInTheDocument()
  })

  it('approves the proposal the card shows, by naming it', async () => {
    const bodies: unknown[] = []
    // Removed even when the test fails, and only this one: other listeners stay.
    const listener = async ({ request }: { request: Request }) => {
      if (request.url.endsWith('/commission/approve')) bodies.push(await request.clone().json())
    }
    server.events.on('request:start', listener)
    onTestFinished(() => {
      server.events.removeListener('request:start', listener)
    })
    const { user } = await open('v_indigo', 'Indigo Loom')
    await user.click(within(card()).getByRole('button', { name: 'Approve 10%' }))
    await screen.findByText('Agreed 10% with Indigo Loom. They see it in their store details.')
    expect(bodies).toEqual([{ proposed_bps: 1000 }])
  })

  it('tells the reviewer when the brand changed its proposal while the card was open, and shows the new rate', async () => {
    const { user, db } = await open('v_indigo', 'Indigo Loom')
    expect(within(card()).getByText('Indigo Loom proposed 10%.')).toBeInTheDocument()
    vendorOf(db, 'v_indigo').commission = { ...vendorOf(db, 'v_indigo').commission, proposed_bps: 900 }
    await user.click(within(card()).getByRole('button', { name: 'Approve 10%' }))
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('The brand changed its proposal. Reload to see the new rate.')).toBeInTheDocument()
    // Nothing was agreed, and the card read the vendor again: it now shows 9%.
    expect(vendorOf(db, 'v_indigo').commission).toMatchObject({ state: 'proposed', agreed_bps: 1200, proposed_bps: 900 })
    expect(await within(card()).findByText('Indigo Loom proposed 9%.')).toBeInTheDocument()
    expect(within(card()).getByRole('button', { name: 'Approve 9%' })).toBeInTheDocument()
  })

  it('refuses the second of two admins approving at once, and shows what the first agreed', async () => {
    const { user, db } = await open('v_indigo', 'Indigo Loom')
    // The other admin approves first.
    vendorOf(db, 'v_indigo').commission = { state: 'agreed', agreed_bps: 1000, proposed_bps: null, note: null, updated_at: new Date().toISOString() }
    await user.click(within(card()).getByRole('button', { name: 'Approve 10%' }))
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('There is no proposed rate waiting.')).toBeInTheDocument()
    expect(await within(card()).findByText('10%')).toBeInTheDocument()
    expect(within(card()).queryByRole('button', { name: /^Approve/ })).not.toBeInTheDocument()
    expect(db.outbox.filter((e) => e.event === 'vendor.commission_changed')).toHaveLength(0)
  })

  it.each([
    ['0', 0],
    ['40', 4000],
  ])('sets %s%% (the ends of the range)', async (typed, bps) => {
    const { user, db } = await open('v_kalki', 'Kalki Studio')
    await user.click(within(card()).getByRole('button', { name: 'Change rate' }))
    const dialog = await screen.findByRole('dialog', { name: 'Change the commission for Kalki Studio' })
    await user.clear(within(dialog).getByRole('textbox', { name: 'Commission' }))
    await user.type(within(dialog).getByRole('textbox', { name: 'Commission' }), typed)
    await user.click(within(dialog).getByRole('button', { name: 'Save rate' }))
    await waitFor(() => expect(vendorOf(db, 'v_kalki').commission.agreed_bps).toBe(bps))
    await waitFor(() => expect(within(card()).getByText(`${typed}%`)).toBeInTheDocument())
  })

  it('refuses a rate above 40% or with more than two decimals before asking vendor-api', async () => {
    const { user, db } = await open('v_kalki', 'Kalki Studio')
    await user.click(within(card()).getByRole('button', { name: 'Change rate' }))
    const dialog = await screen.findByRole('dialog', { name: 'Change the commission for Kalki Studio' })
    const rate = within(dialog).getByRole('textbox', { name: 'Commission' })
    for (const [typed, message] of [['40.1', 'Enter a commission between 0% and 40%.'], ['12.345', rateErrors.number]] as const) {
      await user.clear(rate)
      await user.type(rate, typed)
      await user.click(within(dialog).getByRole('button', { name: 'Save rate' }))
      expect(await within(dialog).findByText(message)).toBeInTheDocument()
    }
    expect(vendorOf(db, 'v_kalki').commission.agreed_bps).toBe(1200)
  })

  it('shows vendor-api’s own words for a rate it refuses (422 on commission_bps)', async () => {
    server.use(http.post('*/v1/admin/vendors/:id/commission/set', () => HttpResponse.json({ error: { code: 'rate_range', message: 'x', request_id: 'r', details: [{ loc: ['body', 'commission_bps'], msg: 'Enter a commission between 0% and 40%.', type: 'value_error' }] } }, { status: 422 })))
    const { user } = await open('v_kalki', 'Kalki Studio')
    await user.click(within(card()).getByRole('button', { name: 'Change rate' }))
    const dialog = await screen.findByRole('dialog', { name: 'Change the commission for Kalki Studio' })
    await user.clear(within(dialog).getByRole('textbox', { name: 'Commission' }))
    await user.type(within(dialog).getByRole('textbox', { name: 'Commission' }), '14')
    await user.click(within(dialog).getByRole('button', { name: 'Save rate' }))
    expect(await within(dialog).findByText('Enter a commission between 0% and 40%.')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Save rate' })).toBeEnabled()
  })

  it('keeps the vendor when the answer is only the commission: the page still shows the same brand', async () => {
    const { user } = await open('v_indigo', 'Indigo Loom')
    await user.click(within(card()).getByRole('button', { name: 'Approve 10%' }))
    await screen.findByText('Agreed 10% with Indigo Loom. They see it in their store details.')
    expect(screen.getByRole('heading', { level: 1, name: 'Indigo Loom' })).toBeInTheDocument()
    expect(within(card()).getByText('10%')).toBeInTheDocument()
  })

  it('has no commission card for a rejected brand', async () => {
    await open('v_quick', 'QuickFashion Hub')
    expect(screen.queryByRole('region', { name: 'Commission' })).not.toBeInTheDocument()
  })
})

describe('A-09 Approving an application asks for the rate', { timeout: 30_000 }, () => {
  it('starts from the brand’s proposal', async () => {
    const { user, db } = await open('v_saanjh', 'Saanjh Label')
    const approval = screen.getByRole('region', { name: 'Approval settings' })
    const rate = within(approval).getByRole('textbox', { name: 'Commission' })
    expect(rate).toHaveValue('10')
    expect(rate).toHaveAccessibleDescription('The brand proposed 10%. Change it if you agreed a different rate.')
    expect(screen.queryByRole('region', { name: 'Commission' })).not.toBeInTheDocument()

    await user.click(within(approval).getByRole('checkbox', { name: 'Vendor agreement signed (offline)' }))
    await user.click(screen.getByRole('button', { name: 'Approve and invite' }))
    expect(await screen.findByText(/^Approved Saanjh Label\./)).toBeInTheDocument()
    expect(vendorOf(db, 'v_saanjh').commission).toMatchObject({ state: 'agreed', agreed_bps: 1000, proposed_bps: null })
    expect(db.outbox.slice(0, 2).map((e) => e.event)).toEqual(['vendor.commission_changed', 'vendor.status_changed'])
    // Now approved, the brand has a commission card with the agreed rate.
    await waitFor(() => expect(within(card()).getByText('10%')).toBeInTheDocument())
  })

  it('starts empty when the brand proposed nothing, and needs a rate to approve', async () => {
    const { user, db } = await open('v_rann', 'Rann Weaves')
    const rate = within(screen.getByRole('region', { name: 'Approval settings' })).getByRole('textbox', { name: 'Commission' })
    expect(rate).toHaveValue('')
    expect(rate).toHaveAccessibleDescription('The brand did not propose a rate. Enter the one you agreed with them.')
    await user.click(screen.getByRole('checkbox', { name: 'Vendor agreement signed (offline)' }))
    const approve = screen.getByRole('button', { name: 'Approve and invite' })
    expect(approve).toBeDisabled()
    expect(approve).toHaveAccessibleDescription('Enter the commission below to approve.')
    await user.type(rate, '12')
    await waitFor(() => expect(approve).toBeEnabled())
    await user.click(approve)
    await waitFor(() => expect(vendorOf(db, 'v_rann').commission).toMatchObject({ state: 'agreed', agreed_bps: 1200 }))
  })
})
