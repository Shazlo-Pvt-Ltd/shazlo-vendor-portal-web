// @vitest-environment jsdom
import { ThemeProvider } from '@mui/material'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Banner, EmptyState, Logo, PageHeader, SectionCard, SnackbarProvider, StatFigure, StatusPill, statusPillLabel, theme, useSnackbar, type PillStatus } from '../src'

const wrap = (ui: ReactNode) => render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
afterEach(cleanup)

describe('StatusPill', () => {
  const cases: [PillStatus, string][] = [
    ['live', 'Live'],
    ['pending', 'Pending review'],
    ['sentBack', 'Sent back'],
    ['draft', 'Draft'],
    ['editInReview', 'Edit in review'],
    ['publishing', 'Publishing'],
    ['archived', 'Archived'],
    ['suspended', 'Suspended'],
  ]

  it.each(cases)('shows %s as a word with an icon, never colour alone', (status, label) => {
    wrap(<StatusPill status={status} />)
    const pill = screen.getByText(label).closest('[data-status]') as HTMLElement
    expect(pill).toHaveAttribute('data-status', status)
    expect(pill.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    expect(statusPillLabel[status]).toBe(label)
  })
})

describe('PageHeader', () => {
  it('renders one page heading, the context line and its actions', () => {
    wrap(<PageHeader title="Products" subtitle="27 products · 18 live in the app" actions={<button type="button">Add product</button>} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Products' })).toBeInTheDocument()
    expect(screen.getByText('27 products · 18 live in the app')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add product' })).toBeInTheDocument()
  })

  it('can sit a status next to the title', () => {
    wrap(<PageHeader title="Ajrakh Block-Print Kurta" status={<StatusPill status="sentBack" />} />)
    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading.parentElement).toHaveTextContent('Sent back')
  })
})

describe('StatFigure', () => {
  it('reads as label, number and baseline', () => {
    wrap(<StatFigure label="Pending review" value={4} baseline="Usually reviewed within 24 h" />)
    const figure = screen.getByRole('group', { name: 'Pending review' })
    expect(within(figure).getByText('4')).toBeInTheDocument()
    expect(within(figure).getByText('Usually reviewed within 24 h')).toBeInTheDocument()
  })

  it('becomes a link when it leads somewhere', () => {
    wrap(<StatFigure label="Sent back" value={2} baseline="Needs your changes" href="/products?status=rejected" />)
    expect(screen.getByRole('link', { name: /Sent back/ })).toHaveAttribute('href', '/products?status=rejected')
  })
})

describe('SectionCard', () => {
  it('labels the section with its title', () => {
    wrap(<SectionCard title="Recent review decisions" action={<a href="/review">View all</a>}>rows</SectionCard>)
    const region = screen.getByRole('region', { name: 'Recent review decisions' })
    expect(within(region).getByRole('link', { name: 'View all' })).toBeInTheDocument()
  })
})

describe('Banner', () => {
  it('uses an alert role for problems and a status role otherwise', () => {
    wrap(
      <>
        <Banner tone="warning" title="2 products were sent back by the review team">Fix the notes and resubmit.</Banner>
        <Banner tone="info" title="Most items are reviewed within 24 hours" />
      </>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('2 products were sent back')
    expect(screen.getByRole('status')).toHaveTextContent('Most items are reviewed')
  })

  it('can be closed when it offers to', () => {
    const onClose = vi.fn()
    wrap(<Banner tone="info" title="4 of 5 set up" onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('EmptyState', () => {
  it('says what goes here, offers one action and an optional handwritten tip', () => {
    wrap(<EmptyState illustration="kurta" title="No products yet" body="Add your first product to start selling." tip="Start with your best seller" action={<button type="button">Add product</button>} />)
    expect(screen.getByRole('heading', { name: 'No products yet' })).toBeInTheDocument()
    expect(getComputedStyle(screen.getByText('Start with your best seller')).fontFamily).toContain('Schoolbell')
    expect(screen.getByRole('button', { name: 'Add product' })).toBeInTheDocument()
  })
})

describe('Logo', () => {
  it('names the brand and the product', () => {
    wrap(<Logo product="Seller" />)
    expect(screen.getByRole('img', { name: 'Shazlo' })).toBeInTheDocument()
    expect(screen.getByText('Seller')).toBeInTheDocument()
  })
})

describe('SnackbarProvider', () => {
  function SaveButton() {
    const notify = useSnackbar()
    return <button type="button" onClick={() => notify('Draft saved')}>Save</button>
  }

  it('announces a short confirmation and clears it', () => {
    vi.useFakeTimers()
    wrap(<SnackbarProvider><SaveButton /></SnackbarProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('status')).toHaveTextContent('Draft saved')
    act(() => vi.advanceTimersByTime(6000))
    expect(screen.queryByText('Draft saved')).toBeNull()
    vi.useRealTimers()
  })
})
