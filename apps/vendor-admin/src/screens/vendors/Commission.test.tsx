import { onlineManager } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { renderModule } from '../../test/render'
import { server } from '../../test/server'
import { setViewport } from '../../test/viewport'

// Commission is per brand, with no default rate: the card on A-09 for approved brands, and the
// rate asked for when approving an application.

async function open(id: string, name: string) {
  const view = renderModule({ route: `/vendors/${id}` })
  await screen.findByRole('heading', { level: 1, name }, { timeout: 10_000 })
  return view
}

const card = () => screen.getByRole('region', { name: 'Commission' })

// Counts the commission POSTs the module sends. A second approve or send back would be refused by the
// mock (409) and leave the data as it was, so only the requests (and an error banner) show a duplicate.
function countPosts(step: 'approve' | 'send-back' | 'set') {
  let n = 0
  const listener = ({ request }: { request: Request }) => {
    if (request.method === 'POST' && new URL(request.url).pathname.endsWith(`/commission/${step}`)) n += 1
  }
  server.events.on('request:start', listener)
  return {
    get count() {
      return n
    },
    stop: () => server.events.removeListener('request:start', listener),
  }
}

// Lets a late second request finish and draw its banner, if there was one.
const settle = () => new Promise((resolve) => setTimeout(resolve, 300))
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
    // The note is signed by the reviewer who wrote it (from the token, via the history).
    expect(within(card()).getByText(/^Note from Priya Mehta, /)).toBeInTheDocument()
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
    // Rahul Desai sent it back; Priya is reading it. "Your note" would be wrong.
    expect(within(c).getByText(/^Note from Rahul Desai, /)).toBeInTheDocument()
    expect(within(c).queryByText(/^Your note/)).not.toBeInTheDocument()
  })

  it('labels the sign-up proposal as such, so it never contradicts a later one', async () => {
    await open('v_rangrez', 'Rangrez Studio')
    const term = screen.getByText('Proposed at sign-up', { selector: 'dt' })
    expect(term.nextElementSibling).toHaveTextContent('None. They will agree a rate with our team.')
    expect(screen.queryByText('Proposed commission')).not.toBeInTheDocument()
    expect(within(card()).getByText('Rangrez Studio proposed 12%.')).toBeInTheDocument()
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
    // A refused rate puts focus back on the field, once the dialog stops submitting.
    await waitFor(() => expect(rate).toHaveFocus())
    await user.type(rate, '50')
    await user.click(within(dialog).getByRole('button', { name: 'Save rate' }))
    expect(await within(dialog).findByText('Enter a commission between 0% and 40%.')).toBeInTheDocument()
    await waitFor(() => expect(rate).toHaveFocus())
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
    server.use(http.post('*/api/v1/admin/vendors/:id/commission/approve', () => HttpResponse.json({ message: 'There is no proposed rate waiting.', extra: { code: 'invalid_transition' } }, { status: 409 })))
    const { user } = await open('v_indigo', 'Indigo Loom')
    await user.click(within(card()).getByRole('button', { name: 'Approve 10%' }))
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('There is no proposed rate waiting.')).toBeInTheDocument()
  })

  it('has no commission card for a rejected brand', async () => {
    await open('v_quick', 'QuickFashion Hub')
    expect(screen.queryByRole('region', { name: 'Commission' })).not.toBeInTheDocument()
  })

  it('takes a decimal comma in the rate', async () => {
    const { user, db } = await open('v_kesariya', 'Kesariya Prints')
    await user.click(within(card()).getByRole('button', { name: 'Set rate' }))
    const dialog = await screen.findByRole('dialog', { name: 'Set the commission for Kesariya Prints' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Commission' }), '12,5')
    await user.click(within(dialog).getByRole('button', { name: 'Save rate' }))
    await waitFor(() => expect(vendorOf(db, 'v_kesariya').commission).toMatchObject({ state: 'agreed', agreed_bps: 1250 }))
  })

  it('keeps the note to 600 characters', async () => {
    const { user, db } = await open('v_kesariya', 'Kesariya Prints')
    await user.click(within(card()).getByRole('button', { name: 'Set rate' }))
    const dialog = await screen.findByRole('dialog', { name: 'Set the commission for Kesariya Prints' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Commission' }), '12')
    const note = within(dialog).getByRole('textbox', { name: 'Note to the brand (optional)' })
    await user.click(note)
    await user.paste('a'.repeat(601))
    await user.click(within(dialog).getByRole('button', { name: 'Save rate' }))
    expect(await within(dialog).findByText('Keep the note to 600 characters.')).toBeInTheDocument()
    expect(vendorOf(db, 'v_kesariya').commission.state).toBe('not_set')
    await user.type(note, '{Backspace}')
    await user.click(within(dialog).getByRole('button', { name: 'Save rate' }))
    await waitFor(() => expect(vendorOf(db, 'v_kesariya').commission).toMatchObject({ agreed_bps: 1200, note: 'a'.repeat(600) }))
  })
})

// What happens when the page is out of date: the brand changed its proposal, another reviewer
// decided first, or the reviewer clicks twice.
describe('A-09 Commission card when the data moves underneath', { timeout: 30_000 }, () => {
  it('approves only the rate the reviewer saw: a changed proposal is refused and shown', async () => {
    const { user, db } = await open('v_indigo', 'Indigo Loom')
    const events = db.outbox.length
    // The brand proposes 20% after the page loaded with 10%.
    const indigo = vendorOf(db, 'v_indigo')
    indigo.commission = { ...indigo.commission, proposed_bps: 2000 }

    await user.click(within(card()).getByRole('button', { name: 'Approve 10%' }))
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Indigo Loom changed its proposal to 20%. Check it before you decide.')).toBeInTheDocument()
    expect(indigo.commission).toMatchObject({ state: 'proposed', agreed_bps: 1200, proposed_bps: 2000 })
    expect(db.outbox).toHaveLength(events)
    // The card catches up with what the brand now proposes.
    expect(await within(card()).findByRole('button', { name: 'Approve 20%' })).toBeInTheDocument()
  })

  it('sends back only the proposal the reviewer saw', async () => {
    const { user, db } = await open('v_indigo', 'Indigo Loom')
    const indigo = vendorOf(db, 'v_indigo')
    indigo.commission = { ...indigo.commission, proposed_bps: 2000 }

    await user.click(within(card()).getByRole('button', { name: 'Send back' }))
    const dialog = await screen.findByRole('dialog', { name: 'Send back Indigo Loom’s proposed rate' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Note to the brand' }), 'We cannot do 10% yet, sorry.')
    await user.click(within(dialog).getByRole('button', { name: 'Send back' }))
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Indigo Loom changed its proposal to 20%. Check it before you decide.')).toBeInTheDocument()
    expect(indigo.commission.state).toBe('proposed')
    expect(await within(card()).findByText('Indigo Loom proposed 20%.')).toBeInTheDocument()
  })

  it('sends back the proposal shown when the dialog opened, even if the card refreshes meanwhile', async () => {
    const { user, db } = await open('v_indigo', 'Indigo Loom')
    await user.click(within(card()).getByRole('button', { name: 'Send back' }))
    const dialog = await screen.findByRole('dialog', { name: 'Send back Indigo Loom’s proposed rate' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Note to the brand' }), 'We cannot do 10% for handloom yet.')

    // While the reviewer writes about 10%, the brand proposes 20% and the page refetches (here on
    // reconnecting, once the data is stale).
    const indigo = vendorOf(db, 'v_indigo')
    indigo.commission = { ...indigo.commission, proposed_bps: 2000 }
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(Date.now() + 60_000)
      onlineManager.setOnline(false)
      onlineManager.setOnline(true)
      await waitFor(() => expect(screen.getByText('Indigo Loom proposed 20%.')).toBeInTheDocument())
    } finally {
      vi.useRealTimers()
    }

    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Send back' }))
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Indigo Loom changed its proposal to 20%. Check it before you decide.')).toBeInTheDocument()
    expect(indigo.commission.state).toBe('proposed')
  })

  it('refreshes the card when another reviewer decided first', async () => {
    const { user, db } = await open('v_indigo', 'Indigo Loom')
    const indigo = vendorOf(db, 'v_indigo')
    indigo.commission = { ...indigo.commission, state: 'sent_back', note: 'Rahul sent this back on the phone.' }

    await user.click(within(card()).getByRole('button', { name: 'Approve 10%' }))
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('There is no proposed rate waiting.')).toBeInTheDocument()
    await waitFor(() => expect(within(card()).queryByRole('button', { name: /^Approve/ })).not.toBeInTheDocument())
    expect(within(card()).getByText('Sent back: waiting for the brand.')).toBeInTheDocument()
  })

  it('sends one approval for a double click, and shows no error', async () => {
    const { user, db } = await open('v_indigo', 'Indigo Loom')
    const posts = countPosts('approve')
    const events = db.outbox.length
    await user.dblClick(within(card()).getByRole('button', { name: 'Approve 10%' }))
    expect(await screen.findByText('Agreed 10% with Indigo Loom. They see it in their store details.')).toBeInTheDocument()
    await settle()
    posts.stop()
    expect(posts.count).toBe(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(db.outbox).toHaveLength(events + 1)
  })

  it('saves a rate once when Save is clicked twice', async () => {
    const { user, db } = await open('v_kesariya', 'Kesariya Prints')
    const events = db.outbox.length
    await user.click(within(card()).getByRole('button', { name: 'Set rate' }))
    const dialog = await screen.findByRole('dialog', { name: 'Set the commission for Kesariya Prints' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Commission' }), '12')
    const posts = countPosts('set')
    await user.dblClick(within(dialog).getByRole('button', { name: 'Save rate' }))
    expect(await screen.findByText('Kesariya Prints’s commission is now 12% of each sale.')).toBeInTheDocument()
    await settle()
    posts.stop()
    expect(posts.count).toBe(1)
    expect(db.outbox).toHaveLength(events + 1)
    expect(vendorOf(db, 'v_kesariya').history.filter((h) => h.event === 'commission_set')).toHaveLength(1)
  })

  it('sends a proposal back once when Send back is clicked twice', async () => {
    const { user, db } = await open('v_indigo', 'Indigo Loom')
    await user.click(within(card()).getByRole('button', { name: 'Send back' }))
    const dialog = await screen.findByRole('dialog', { name: 'Send back Indigo Loom’s proposed rate' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Note to the brand' }), 'Let us talk about 10% on Friday.')
    const posts = countPosts('send-back')
    await user.dblClick(within(dialog).getByRole('button', { name: 'Send back' }))
    expect(await screen.findByText('Sent back Indigo Loom’s proposed rate. Arjun Mehta sees your note in their store details.')).toBeInTheDocument()
    await settle()
    posts.stop()
    expect(posts.count).toBe(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(vendorOf(db, 'v_indigo').history.filter((h) => h.event === 'commission_sent_back')).toHaveLength(1)
  })

  it('stays usable when a save changes nothing (the API answers with the same vendor)', async () => {
    // An idempotent API may answer "set 12%" on a 12% brand with the vendor exactly as it was. The
    // card must not treat that unchanged state as already decided and ignore every later action.
    let unchanged: unknown
    const capture = async ({ request, response }: { request: Request; response: Response }) => {
      if (request.method === 'GET' && new URL(request.url).pathname.endsWith('/vendors/v_kalki')) unchanged = await response.clone().json()
    }
    server.events.on('response:mocked', capture)
    const { user, db } = await open('v_kalki', 'Kalki Studio')
    server.events.removeListener('response:mocked', capture)
    expect(unchanged).toBeDefined()
    server.use(http.post('*/api/v1/admin/vendors/:id/commission/set', () => HttpResponse.json(unchanged as Record<string, unknown>), { once: true }))

    const save = async (rate: string) => {
      await user.click(within(card()).getByRole('button', { name: 'Change rate' }))
      const dialog = await screen.findByRole('dialog', { name: 'Change the commission for Kalki Studio' })
      const field = within(dialog).getByRole('textbox', { name: 'Commission' })
      await user.clear(field)
      await user.type(field, rate)
      await user.click(within(dialog).getByRole('button', { name: 'Save rate' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    }
    await save('12')
    // The next change goes through.
    await save('14')
    await waitFor(() => expect(vendorOf(db, 'v_kalki').commission.agreed_bps).toBe(1400))
  })

  it('shows a note with markup as plain words', async () => {
    const { user, db } = await open('v_indigo', 'Indigo Loom')
    await user.click(within(card()).getByRole('button', { name: 'Send back' }))
    const dialog = await screen.findByRole('dialog', { name: 'Send back Indigo Loom’s proposed rate' })
    const note = '<img src=x onerror="alert(1)"> <b>10%</b> is too low'
    await user.click(within(dialog).getByRole('textbox', { name: 'Note to the brand' }))
    await user.paste(note)
    await user.click(within(dialog).getByRole('button', { name: 'Send back' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(within(card()).getByText(note)).toBeInTheDocument()
    expect(card().querySelector('img, b')).toBeNull()
    expect(vendorOf(db, 'v_indigo').commission.note).toBe(note)
  })

  it('shows a friendly message when the network drops', async () => {
    server.use(http.post('*/api/v1/admin/vendors/:id/commission/approve', () => HttpResponse.error()))
    const { user, db } = await open('v_indigo', 'Indigo Loom')
    await user.click(within(card()).getByRole('button', { name: 'Approve 10%' }))
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('You seem to be offline. Check your connection and try again.')).toBeInTheDocument()
    expect(vendorOf(db, 'v_indigo').commission.state).toBe('proposed')
    // Nothing changed, so the reviewer can try again.
    expect(within(card()).getByRole('button', { name: 'Approve 10%' })).toBeEnabled()
  })
})

// A refused field gets focus back once it can take it. The fields are disabled while a dialog
// submits, so a focus made during the submit lands on nothing and the button keeps it.
describe('A-09 Commission card focus after a refusal', { timeout: 30_000 }, () => {
  it('returns focus to the note when the API refuses it', async () => {
    const { user, db } = await open('v_rangrez', 'Rangrez Studio')
    await user.click(within(card()).getByRole('button', { name: 'Send back' }))
    const dialog = await screen.findByRole('dialog')
    const note = within(dialog).getByRole('textbox', { name: 'Note to the brand' })
    await user.click(note)
    await user.paste('a'.repeat(601))
    await user.click(within(dialog).getByRole('button', { name: 'Send back' }))
    await within(dialog).findByText('Keep the note to 600 characters.')
    await settle()
    expect(vendorOf(db, 'v_rangrez').commission.state).toBe('proposed')
    expect(note).toHaveFocus()
  })

  it('returns focus to the rate when the API refuses it', async () => {
    server.use(
      http.post('*/api/v1/admin/vendors/:id/commission/set', () =>
        HttpResponse.json({ message: 'No.', extra: { code: 'validation_error', fields: { commission_bps: 'The API refuses this rate.' } } }, { status: 422 }),
      ),
    )
    const { user } = await open('v_kesariya', 'Kesariya Prints')
    await user.click(within(card()).getByRole('button', { name: 'Set rate' }))
    const dialog = await screen.findByRole('dialog')
    const rate = within(dialog).getByRole('textbox', { name: 'Commission' })
    await user.type(rate, '12')
    await user.click(within(dialog).getByRole('button', { name: 'Save rate' }))
    await within(dialog).findByText('The API refuses this rate.')
    await settle()
    expect(rate).toHaveFocus()
  })

  it('focuses the note, not the rate, when only the note is refused', async () => {
    const { user } = await open('v_kesariya', 'Kesariya Prints')
    await user.click(within(card()).getByRole('button', { name: 'Set rate' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByRole('textbox', { name: 'Commission' }), '12')
    const note = within(dialog).getByRole('textbox', { name: 'Note to the brand (optional)' })
    await user.click(note)
    await user.paste('a'.repeat(601))
    await user.click(within(dialog).getByRole('button', { name: 'Save rate' }))
    await within(dialog).findByText('Keep the note to 600 characters.')
    await settle()
    expect(note).toHaveFocus()
  })

  // Only a refused submit moves focus. Fixing one of two refused fields must not send the next
  // keystrokes into the other.
  it('leaves focus where the reviewer types while they fix one of two refused fields', async () => {
    const { user } = await open('v_kesariya', 'Kesariya Prints')
    await user.click(within(card()).getByRole('button', { name: 'Set rate' }))
    const dialog = await screen.findByRole('dialog')
    const rate = within(dialog).getByRole('textbox', { name: 'Commission' })
    await user.type(rate, '45')
    const note = within(dialog).getByRole('textbox', { name: 'Note to the brand (optional)' })
    await user.click(note)
    await user.paste('a'.repeat(601))
    await user.click(within(dialog).getByRole('button', { name: 'Save rate' }))
    await within(dialog).findByText('Enter a commission between 0% and 40%.')
    await settle()
    expect(rate).toHaveFocus()

    await user.clear(rate)
    await user.type(rate, '12')
    await settle()
    expect(rate).toHaveFocus()
    expect(rate).toHaveValue('12')
    expect(note).toHaveValue('a'.repeat(601))
  })

  it('does not pull focus into the card on a later refresh after a failed approve', async () => {
    server.use(
      http.post('*/api/v1/admin/vendors/:id/commission/approve', () => HttpResponse.json({ message: 'Boom', extra: { code: 'server_error' } }, { status: 500 }), {
        once: true,
      }),
    )
    const { user, db } = await open('v_indigo', 'Indigo Loom')
    await user.click(within(card()).getByRole('button', { name: 'Approve 10%' }))
    await screen.findByRole('alert')
    // The reviewer clicks on empty space to read the banner.
    ;(document.activeElement as HTMLElement | null)?.blur()
    expect(document.activeElement).toBe(document.body)
    // The brand changes its proposal, and the page refetches when the connection comes back.
    vendorOf(db, 'v_indigo').commission = { ...vendorOf(db, 'v_indigo').commission, proposed_bps: 1100 }
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(Date.now() + 60_000)
      onlineManager.setOnline(false)
      onlineManager.setOnline(true)
      await waitFor(() => expect(within(card()).getByRole('button', { name: 'Approve 11%' })).toBeInTheDocument())
    } finally {
      vi.useRealTimers()
    }
    expect(document.activeElement).toBe(document.body)
  })
})

// The card is the page's one decision for an approved brand. Wherever the page is one column
// (phones, tablets, and a laptop beside the shell's sidebar) it comes before the long application.
describe('A-09 Commission card placement', { timeout: 30_000 }, () => {
  it.each([
    [390, 'a phone'],
    [768, 'a tablet'],
    [820, 'a 1,100 px laptop beside the sidebar'],
  ])('comes before the application in a %i px frame (%s)', async (width) => {
    setViewport(width)
    await open('v_rangrez', 'Rangrez Studio')
    const application = screen.getByRole('region', { name: 'Application' })
    expect(card().compareDocumentPosition(application) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('sits after the application, in the side column, from 900 px', async () => {
    setViewport(1024)
    await open('v_rangrez', 'Rangrez Studio')
    const application = screen.getByRole('region', { name: 'Application' })
    expect(card().compareDocumentPosition(application) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
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
