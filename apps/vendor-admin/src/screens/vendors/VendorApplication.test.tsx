import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { api, resetMock } from '../../api'
import { renderRoute } from '../../test/render'

describe('A-09 Vendor application', () => {
  beforeEach(() => resetMock())

  it('approves with commission only after the agreement is ticked, creating the login and invite', async () => {
    renderRoute('/vendors/v_saanjh')
    expect(await screen.findByRole('heading', { name: 'Saanjh Label', level: 1 })).toBeTruthy()
    const approve = screen.getByRole('button', { name: 'Approve and invite' }) as HTMLButtonElement
    expect(approve.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Commission'), { target: { value: '12%' } })
    fireEvent.click(screen.getByLabelText('Vendor agreement signed (offline)'))
    expect(approve.disabled).toBe(false)
    fireEvent.click(approve)
    expect(await screen.findByText('Saanjh Label approved. Invite sent to hello@saanjhlabel.in.')).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Suspend' })).toBeTruthy()
    const v = await api.getVendor('v_saanjh')
    expect(v.status).toBe('approved')
    expect(v.commissionPct).toBe(12)
    expect(v.ownerLogin).toBe('hello@saanjhlabel.in')
    expect(v.activity[0]!.title).toBe('Invite sent to hello@saanjhlabel.in')
    expect((await api.getOutbox()).events.some(e => e.item === 'Saanjh Label · approved')).toBe(true)
    expect((await api.getQueue()).items.some(i => i.id === 'v_saanjh')).toBe(false)
  })

  it('refuses an out-of-range commission and focuses it', async () => {
    renderRoute('/vendors/v_saanjh')
    fireEvent.change(await screen.findByLabelText('Commission'), { target: { value: '80' } })
    fireEvent.click(screen.getByLabelText('Vendor agreement signed (offline)'))
    fireEvent.click(screen.getByRole('button', { name: 'Approve and invite' }))
    expect(await screen.findByText('Enter a rate between 0% and 50%.')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText('Commission'))
  })

  it('opening an applied application moves it to under review', async () => {
    renderRoute('/vendors/v_rann')
    await screen.findByRole('heading', { name: 'Rann Weaves', level: 1 })
    await waitFor(async () => expect((await api.getVendor('v_rann')).status).toBe('under_review'))
    expect(await screen.findByText('applied → under_review')).toBeTruthy()
  })

  it('rejects with a required reason', async () => {
    renderRoute('/vendors/v_kaaya')
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }))
    await screen.findByRole('dialog', { name: 'Reject Kaaya Ethnic' })
    expect((screen.getByRole('button', { name: 'Reject application' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Not enough products' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reject application' }))
    expect(await screen.findByText('Rejected the Kaaya Ethnic application. Pooja Trivedi gets an email.')).toBeTruthy()
    expect((await api.getVendor('v_kaaya')).status).toBe('rejected')
  })
})
