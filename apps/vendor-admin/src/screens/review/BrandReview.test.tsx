import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { api, resetMock } from '../../api'
import { renderRoute } from '../../test/render'

describe('A-07 Brand page review', () => {
  beforeEach(() => resetMock())

  it('lists the changed fields and collapses the rest to “Same”', async () => {
    renderRoute('/review/brand/b_nila')
    expect(await screen.findByRole('heading', { name: 'Nila Handloom · brand page', level: 1 })).toBeTruthy()
    expect(screen.getByText('Submitted today, 08:05 · 2 fields changed · live version published 12 Oct')).toBeTruthy()
    expect(screen.getAllByText('Changed')).toHaveLength(2)
    expect(screen.getAllByText('Same')).toHaveLength(4)
    expect(await screen.findByText('3 of 14')).toBeTruthy()
  })

  it('approving publishes the draft and updates the queue', async () => {
    renderRoute('/review/brand/b_nila')
    fireEvent.click(await screen.findByRole('button', { name: 'Approve and publish' }))
    expect(await screen.findByText('Approved the Nila Handloom brand page. It’s on its way to the app.')).toBeTruthy()
    const b = await api.getBrand('b_nila')
    expect(b.status).toBe('approved')
    expect(b.live?.story).toBe(b.draft.story)
    await waitFor(async () => expect((await api.getQueue()).items.some(i => i.id === 'b_nila')).toBe(false))
  })

  it('sends back with the A-06 dialog and leaves the live page untouched', async () => {
    renderRoute('/review/brand/b_nila')
    fireEvent.click(await screen.findByRole('button', { name: 'Send back' }))
    const dialog = await screen.findByRole('dialog', { name: 'Send back to Nila Handloom' })
    fireEvent.change(screen.getByLabelText(/Message to the vendor \(required\)/), { target: { value: 'Please remove the phone number from your story.' } })
    fireEvent.click(dialog.querySelector('button[type="submit"]')!)
    expect(await screen.findByText('Sent the brand page back to Nila Handloom. The live page is unchanged.')).toBeTruthy()
    const b = await api.getBrand('b_nila')
    expect(b.status).toBe('sent_back')
    expect(b.live?.story).toBe('Handwoven sarees and stoles from Patan, Gujarat.')
  })
})
