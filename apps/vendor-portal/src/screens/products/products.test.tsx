import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderRoute } from '../../test/render'

// The first render of a file pays for loading MUI and the kit; give async queries room.
configure({ asyncUtilTimeout: 5000 })
vi.setConfig({ testTimeout: 20_000 })

const rows = () => within(screen.getByRole('table', { name: 'Products' })).getAllByRole('row').slice(1)

describe('V-06 Products', () => {
  it('shows the first page with sent-back products on top and live counts on the tabs', async () => {
    renderRoute('/products')
    expect(await screen.findByText('27 products · 18 live in the app')).toBeTruthy()
    expect(await screen.findByText('Showing 1–8 of 27')).toBeTruthy()
    const first = rows()[0]
    expect(first && within(first).getByText('Ajrakh Block-Print Kurta')).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Sent back\s*2/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Pending review\s*4/ })).toBeTruthy()
  })

  it('narrows rows by tab (from the URL) and by search', async () => {
    renderRoute('/products?tab=sent_back')
    await screen.findByText('Showing 1–2 of 2')
    expect(rows()).toHaveLength(2)
    expect(screen.getByRole('tab', { name: /Sent back/ }).getAttribute('aria-selected')).toBe('true')

    fireEvent.click(screen.getByRole('tab', { name: /^All/ }))
    await screen.findByText('Showing 1–8 of 27')
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search name or SKU' }), { target: { value: 'KS-BDN' } })
    await screen.findByText('Showing 1–1 of 1')
    expect(within(rows()[0]!).getByText('Bandhani Silk Dupatta')).toBeTruthy()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search name or SKU' }), { target: { value: 'velvet' } })
    expect(await screen.findByText('No products match')).toBeTruthy()
  })

  it('shows the navy bulk bar only when rows are selected, and confirms before archiving', async () => {
    renderRoute('/products')
    await screen.findByText('Showing 1–8 of 27')
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).toBeNull()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Ajrakh Block-Print Kurta' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Kutch Mirror-Work Jacket' }))
    const bar = screen.getByRole('region', { name: 'Bulk actions' })
    expect(within(bar).getByText('2 selected')).toBeTruthy()

    fireEvent.click(within(bar).getByRole('button', { name: 'Archive' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive 2 products' }))
    await screen.findByText('Showing 1–8 of 25')
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).toBeNull()
    expect(await screen.findByRole('tab', { name: /Archived\s*2/ })).toBeTruthy()
  })
})

describe('V-07 Product editor', () => {
  it('quotes the reviewer and blocks resubmitting without a back photo', async () => {
    const { router } = renderRoute('/products/p_ajrakh')
    expect(await screen.findByText('Back photo is missing. Add front, back and a fabric close-up.')).toBeTruthy()
    expect(screen.getByText('You receive per sale')).toBeTruthy()
    expect(screen.getByText('₹2,124')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Resubmit for review' }))
    const alert = await screen.findByText(/Add a back photo\. Every product needs front, back and a fabric close-up\./)
    expect(alert).toBeTruthy()
    expect(router.state.location.pathname).toBe('/products/p_ajrakh')
  })

  it('rejects a selling price above the MRP', async () => {
    renderRoute('/products/p_bandhani')
    const price = await screen.findByLabelText('Selling price')
    fireEvent.change(price, { target: { value: '2500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText(/Selling price can’t be more than the MRP \(₹2,200\)/)).toBeTruthy()
    expect(price.getAttribute('aria-invalid')).toBe('true')
  })

  it('starts /products/new as an empty draft and needs a title to save it', async () => {
    renderRoute('/products/new')
    expect(await screen.findByText('New product · not saved yet')).toBeTruthy()
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(await screen.findByText('Add a title so you can find this draft later.')).toBeTruthy()
    await waitFor(() => expect(document.activeElement?.id).toBe('pe-title'))
  })
})
