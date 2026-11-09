import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderRoute } from '../test/render'

const timeOut = () => act(() => { vi.advanceTimersByTime(10_000) })

describe('A-03 Module failed to load', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }) })
  afterEach(() => { vi.useRealTimers() })

  it('shows the error panel after the 10 s ready timeout, and Retry reloads only the iframe', async () => {
    renderRoute('/vendors/queue', { as: 'reviewer' })
    expect(await screen.findByTitle('Vendors admin')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /didn’t respond/ })).toBeNull()

    timeOut()
    expect(await screen.findByRole('heading', { name: 'The Vendors module didn’t respond' })).toBeTruthy()
    expect(screen.getByText(/This was attempt 1 of 3\. Your session is fine; only this module is affected\./)).toBeTruthy()
    expect(screen.getByText(/^module {6}vendor-admin$/, { normalizer: s => s })).toBeTruthy()
    expect(screen.getByText(/^origin {6}http:\/\/localhost:5175$/, { normalizer: s => s })).toBeTruthy()
    expect(screen.getByText(/^protocol {4}v1 \(shell supports v1\)$/, { normalizer: s => s })).toBeTruthy()
    expect(screen.getByText(/^waited {6}10 s, no “ready” message$/, { normalizer: s => s })).toBeTruthy()
    expect(screen.getByText(/^request id {2}[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$/, { normalizer: s => s })).toBeTruthy()
    expect(screen.queryByTitle('Vendors admin')).toBeNull()
    // The shell chrome stays.
    expect(screen.getByRole('navigation', { name: 'Shazlo One' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTitle('Vendors admin')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /didn’t respond/ })).toBeNull()

    timeOut()
    expect(await screen.findByText(/This was attempt 2 of 3/)).toBeTruthy()
  })

  it('becomes “Module unavailable” after 3 failures and reports it', async () => {
    renderRoute('/vendors', { as: 'reviewer' })
    await screen.findByTitle('Vendors admin')
    for (let i = 0; i < 2; i++) {
      timeOut()
      fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
      await screen.findByTitle('Vendors admin')
    }
    timeOut()
    expect(await screen.findByRole('heading', { name: 'Module unavailable' })).toBeTruthy()
    expect(await screen.findByText(/Reported automatically at/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to Home' }).getAttribute('href')).toBe('/')
  })
})
