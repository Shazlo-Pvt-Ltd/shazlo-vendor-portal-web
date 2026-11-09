import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { api, resetMock } from '../../api'
import { renderRoute } from '../../test/render'

describe('A-05 Product review and A-06 Send back', () => {
  beforeEach(() => resetMock())

  it('shows the diff against the sent-back version and the previous decision', async () => {
    renderRoute('/review/product/p_ajrakh_kurta')
    expect(await screen.findByText('Compared with the version you sent back')).toBeTruthy()
    expect(screen.getByText('1 change')).toBeTruthy()
    expect(screen.getAllByText('Same')).toHaveLength(4)
    expect(screen.getByText('Sent back by Rahul Desai · today, 11:40')).toBeTruthy()
  })

  it('needs a written reason of at least 10 characters to send back', async () => {
    const { router } = renderRoute('/review/product/p_ajrakh_kurta')
    fireEvent.click(await screen.findByRole('button', { name: 'Send back' }))
    const dialog = await screen.findByRole('dialog', { name: 'Send back to Kalki Studio' })
    const submit = () => dialog.querySelector('button[type="submit"]') as HTMLButtonElement
    const message = () => screen.getByLabelText(/Message to the vendor \(required\)/) as HTMLTextAreaElement
    expect(submit().disabled).toBe(true)
    fireEvent.change(message(), { target: { value: 'Too short' } })
    expect(submit().disabled).toBe(true)
    expect(screen.getByText('Write at least 10 characters (9 so far).')).toBeTruthy()

    // A reason template fills the empty message.
    fireEvent.change(message(), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Description doesn’t match photos' }))
    expect(message().value).toContain('description doesn’t match')
    expect(submit().disabled).toBe(false)
    fireEvent.click(submit())

    expect(await screen.findByText('Sent “Ajrakh Block-Print Kurta” back to Kalki Studio.')).toBeTruthy()
    await waitFor(() => expect(router.state.location.pathname).toBe('/review/product/p_handloom_shirt'))
    const p = await api.getProduct('p_ajrakh_kurta')
    expect(p.status).toBe('sent_back')
    expect(p.decision?.reasons).toEqual(['Description doesn’t match photos'])
    expect((await api.getQueue()).stats.waiting).toBe(13)
  })

  it('approves, writes an outbox event and moves to the next item', async () => {
    const { router } = renderRoute('/review/product/p_ajrakh_kurta')
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Front, back and close-up photos' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve and publish' }))
    expect(await screen.findByText('Approved “Ajrakh Block-Print Kurta”. It’s on its way to the app.')).toBeTruthy()
    await waitFor(() => expect(router.state.location.pathname).toBe('/review/product/p_handloom_shirt'))
    const p = await api.getProduct('p_ajrakh_kurta')
    expect(p.status).toBe('approved')
    expect(p.decision?.checklist).toEqual(['Front, back and close-up photos'])
    const outbox = await api.getOutbox()
    expect(outbox.events.some(e => e.item === 'Ajrakh Block-Print Kurta' && e.status === 'waiting')).toBe(true)
    expect((await api.getQueue()).stats.decidedToday).toBe(12)
  })
})
