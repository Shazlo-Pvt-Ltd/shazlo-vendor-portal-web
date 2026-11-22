// @vitest-environment jsdom
import { Chip, ThemeProvider } from '@mui/material'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Banner, EmptyState, Logo, Monogram, PageHeader, SectionCard, SnackbarProvider, StatFigure, StatusPill, statusPillLabel, theme, useSnackbar, type PillStatus } from '../src'
import { Store } from 'lucide-react'
import { forwardRef, type AnchorHTMLAttributes } from 'react'

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

  it('draws the new wordmark as a mask in the tone asked for, navy on light pages by default', () => {
    wrap(<Logo />)
    const mark = screen.getByRole('img', { name: 'Shazlo' })
    expect(mark).toHaveAttribute('data-tone', 'navy')
    expect(mark.tagName).not.toBe('IMG')
    cleanup()
    wrap(<Logo tone="amber" product="One" />)
    expect(screen.getByRole('img', { name: 'Shazlo' })).toHaveAttribute('data-tone', 'amber')
  })

  it('keeps the wordmark proportions at any height', () => {
    wrap(<Logo height={40} />)
    const mark = screen.getByRole('img', { name: 'Shazlo' })
    expect(mark.style.height || getComputedStyle(mark).height).toBe('40px')
    // 312 × 93 px source: width follows the height.
    expect(getComputedStyle(mark).width).toBe(`${Math.round((40 * 312) / 93)}px`)
  })
})

describe('Monogram', () => {
  it('is the S mark, named for screen readers unless it is decoration', () => {
    wrap(<Monogram size={32} />)
    const mark = screen.getByRole('img', { name: 'Shazlo' })
    expect(getComputedStyle(mark).width).toBe('32px')
    cleanup()
    wrap(<Monogram decorative />)
    expect(screen.queryByRole('img')).toBeNull()
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

describe('layout: figures that open a page, and card titles with an icon', () => {
  // Stands in for react-router's Link: it takes `to` and renders the anchor itself.
  const RouterLink = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }>(function RouterLink({ to, ...rest }, ref) {
    return <a ref={ref} {...rest} href={to} data-router-link="" />
  })

  it('opens its page through the router link it is given, as one link with a chevron', () => {
    wrap(<StatFigure label="Failed" value={1} baseline="Needs a look" href="/vendors/publishing?status=failed" linkComponent={RouterLink} />)
    const figure = screen.getByRole('group', { name: 'Failed' })
    const links = within(figure).getAllByRole('link')
    expect(links).toHaveLength(1)
    const link = links[0]!
    expect(link).toHaveAttribute('href', '/vendors/publishing?status=failed')
    expect(link).toHaveAttribute('data-router-link')
    // The whole tile is the link: label, figure and baseline all sit inside it.
    expect(within(link).getByText('Failed')).toBeInTheDocument()
    expect(within(link).getByText('1')).toBeInTheDocument()
    expect(within(link).getByText('Needs a look')).toBeInTheDocument()
    expect(link.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(1)
    // Named by what it shows, label first.
    expect(screen.getByRole('link', { name: /^Failed\s*1\s*Needs a look$/ })).toBe(link)
  })

  it('works as a plain anchor without a router', () => {
    wrap(<StatFigure label="Sent back" value={2} href="/products?status=rejected" />)
    const link = screen.getByRole('link', { name: /^Sent back/ })
    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', '/products?status=rejected')
    expect(link.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
  })

  it('stays a plain figure, with no link or chevron, when it leads nowhere', () => {
    wrap(<StatFigure label="Decided today" value={1} baseline="Approved or sent back since midnight" />)
    const figure = screen.getByRole('group', { name: 'Decided today' })
    expect(within(figure).queryByRole('link')).toBeNull()
    expect(figure.querySelector('svg')).toBeNull()
  })

  it('sets the label and the figure in Bodoni Moda semibold, the baseline in regular Ovo', () => {
    wrap(<StatFigure label="Waiting" value={14} baseline="Oldest first" href="/queue" linkComponent={RouterLink} />)
    for (const text of ['Waiting', '14']) {
      const style = getComputedStyle(screen.getByText(text))
      expect(style.fontFamily).toContain('Bodoni Moda')
      expect(style.fontWeight).toBe('600')
    }
    const baseline = getComputedStyle(screen.getByText('Oldest first'))
    expect(baseline.fontFamily).toContain('Ovo')
    expect(baseline.fontWeight).toBe('400')
  })

  it('puts an icon beside a card title, hidden from screen readers, and keeps the region name', () => {
    wrap(
      <SectionCard title="Vendors" icon={Store}>
        rows
      </SectionCard>,
    )
    const region = screen.getByRole('region', { name: 'Vendors' })
    const heading = within(region).getByRole('heading', { level: 2, name: 'Vendors' })
    const icon = region.querySelector('svg')
    expect(icon).toHaveAttribute('aria-hidden', 'true')
    expect(icon).toHaveAttribute('stroke-width', '1.75')
    expect(heading.contains(icon)).toBe(false)
    expect(heading.parentElement!.contains(icon)).toBe(true)
  })

  it('leaves a card title without an icon as it was', () => {
    wrap(<SectionCard title="Recent review decisions">rows</SectionCard>)
    expect(screen.getByRole('region', { name: 'Recent review decisions' }).querySelector('svg')).toBeNull()
  })
})

describe('PageHeader subtitle markup', () => {
  it('keeps a text subtitle a paragraph, and puts anything else where a chip may go', () => {
    const error = vi.spyOn(console, 'error')
    wrap(<PageHeader title="Products" subtitle="Everything you sell." />)
    expect(screen.getByText('Everything you sell.').tagName).toBe('P')
    cleanup()
    // A Chip's root is a <div>, which a <p> cannot hold: React warns, and the HTML is invalid.
    const { container } = wrap(
      <PageHeader
        title="Kurta"
        subtitle={
          <span>
            SKU K-1 <Chip size="small" label="Draft" />
          </span>
        }
      />,
    )
    expect(screen.getByText('Draft')).toBeTruthy()
    expect(container.querySelector('p div, p p')).toBeNull()
    expect(error).not.toHaveBeenCalled()
    error.mockRestore()
  })
})
