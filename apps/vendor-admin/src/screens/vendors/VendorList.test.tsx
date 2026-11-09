import { fireEvent, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetMock } from '../../api'
import { renderRoute } from '../../test/render'

const bodyRows = () => [...screen.getByLabelText('Vendors', { selector: 'table' }).querySelectorAll<HTMLElement>('tbody tr')]
const loaded = () => screen.findByLabelText('Vendors', { selector: 'table' }, { timeout: 8000 })

describe('A-08 Vendors', () => {
  beforeEach(() => resetMock())

  it('lists vendors with applications needing a decision first', async () => {
    renderRoute('/vendors')
    await loaded()
    expect(bodyRows()).toHaveLength(36)
    expect(within(bodyRows()[0]!).getByText('Saanjh Label')).toBeTruthy()
    expect(within(bodyRows()[0]!).getByText('Under review')).toBeTruthy()
    expect(within(bodyRows()[0]!).getByText('+91 99241 18850')).toBeTruthy()
    expect(screen.getByText('36 vendors · 3 applications need a decision')).toBeTruthy()
  })

  it('filters by status tab, city and search', async () => {
    renderRoute('/vendors')
    await loaded()
    fireEvent.click(screen.getByText('Suspended', { selector: 'button[role=tab] span' }))
    expect(bodyRows()).toHaveLength(1)
    expect(within(bodyRows()[0]!).getByText('Studio Ivory')).toBeTruthy()

    fireEvent.click(screen.getByText('All', { selector: 'button[role=tab] span' }))
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Patan' } })
    expect(bodyRows()).toHaveLength(3)
    expect(within(bodyRows()[0]!).getByText('Nila Handloom')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'all' } })
    fireEvent.change(screen.getByLabelText('Search brand, owner, email or phone'), { target: { value: '98250 41376' } })
    expect(bodyRows()).toHaveLength(1)
    expect(within(bodyRows()[0]!).getByText('Kalki Studio')).toBeTruthy()
  })

  it('suspends a vendor from the row menu after asking for a reason', async () => {
    renderRoute('/vendors')
    await loaded()
    fireEvent.click(screen.getByLabelText('More actions for Kalki Studio'))
    fireEvent.click(await screen.findByRole('menuitem', { name: /Suspend/ }))
    await screen.findByRole('dialog', { name: 'Suspend Kalki Studio' })
    fireEvent.change(screen.getByLabelText(/Reason \(required\)/), { target: { value: 'Shipped counterfeit stock twice this month.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Suspend vendor' }))
    expect(await screen.findByText('Kalki Studio is suspended. Their products leave the app within minutes.')).toBeTruthy()
    fireEvent.click(screen.getByText('Suspended', { selector: 'button[role=tab] span' }))
    expect(await screen.findByText('Kalki Studio')).toBeTruthy()
    expect(bodyRows()).toHaveLength(2)
  })
})
