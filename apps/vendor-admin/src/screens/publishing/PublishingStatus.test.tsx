import { fireEvent, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { api, resetMock } from '../../api'
import { renderRoute } from '../../test/render'

describe('A-10 Publishing status', () => {
  beforeEach(() => resetMock())

  it('shows outbox counts and the failed event first with the central app’s response', async () => {
    renderRoute('/publishing')
    const detail = await screen.findByRole('region', { name: 'Event detail' }, { timeout: 8000 })
    expect(within(detail).getByText('Phulkari Dupatta — Mustard')).toBeTruthy()
    expect(within(detail).getByText('HTTP 422 from central app')).toBeTruthy()
    expect(screen.getByRole('tab', { name: /^All/ }).textContent).toContain('316')
    expect(screen.getByRole('tab', { name: /Delivered/ }).textContent).toContain('312')
  })

  it('retries a failed event', async () => {
    renderRoute('/publishing')
    const detail = await screen.findByRole('region', { name: 'Event detail' }, { timeout: 8000 })
    fireEvent.click(within(detail).getByRole('button', { name: 'Retry now' }))
    expect(await screen.findByText('Retry queued for “Phulkari Dupatta — Mustard”.')).toBeTruthy()
    const outbox = await api.getOutbox()
    expect(outbox.counts.failed).toBe(0)
    expect(outbox.events.find(e => e.item === 'Phulkari Dupatta — Mustard')?.status).toBe('waiting')
    expect(await screen.findByText('Nothing needs a look')).toBeTruthy()
  })

  it('selects another event to see its details', async () => {
    renderRoute('/publishing')
    await screen.findByRole('region', { name: 'Event detail' }, { timeout: 8000 })
    fireEvent.click(screen.getByText('Bandhani Silk Dupatta'))
    const detail = screen.getByRole('region', { name: 'Event detail' })
    expect(within(detail).getByText('product:BH-BSD-011:rev-1')).toBeTruthy()
    expect(within(detail).queryByRole('button', { name: 'Retry now' })).toBeNull()
  })
})
