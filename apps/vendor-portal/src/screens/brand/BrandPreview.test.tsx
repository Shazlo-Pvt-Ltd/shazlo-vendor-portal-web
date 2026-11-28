import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { Schemas } from '../../api/model'
import { keys } from '../../api/queries'
import { ThemeProviders } from '../../app/Providers'
import { brandCopy } from '../../copy/brand'
import { BrandPreview } from './BrandPreview'
import { COVER_SIZE, LOGO_MIN_PX, type Profile } from './schema'

// The layout contract of "Preview in the Shazlo app" (V-05): a phone of real proportions with the
// app's own chrome, the cover full width at the ratio the editor asks for, the logo ringed and half
// over the cover's lower edge, the name below it, then the rest of the page. jsdom has no layout, so
// these check the order of the parts and the styles that make the shape.

const PROFILE: Profile = {
  brand_name: 'Kalki Studio',
  based_in: 'Ahmedabad, Gujarat',
  story: 'We work with Ajrakh printers in Kutch.',
  logo_url: 'https://img.test/logo.png',
  cover_url: 'https://img.test/cover.jpg',
  return_policy: '7_day',
  dispatch_time: '2_3_days',
  instagram: '@kalki.studio',
  website: 'https://kalkistudio.in',
}

const summary = (n: number, status: Schemas['ProductSummary']['status'] = 'approved'): Schemas['ProductSummary'] => ({
  id: `p${n}`,
  title: `Ajrakh Kurta ${n}`,
  sku: `KS-${n}`,
  category: 'Kurtas',
  main_colour: 'Indigo',
  status,
  price_paise: 249_900,
  mrp_paise: null,
  stock: 4,
  thumbnail_url: `https://img.test/${n}.jpg`,
  updated_at: '2026-11-01T10:00:00Z',
  edit_in_review: false,
  publishing: false,
})

const page = (items: Schemas['ProductSummary'][]): Schemas['ProductPage'] => ({ items, next_cursor: null, total: items.length, counts: {} as Schemas['ProductPage']['counts'] })

const STORE = {
  delivery: { mode: 'shazlo', pickup_address: { line1: '4 Ring Road', area: 'Athwa', city: 'Surat', pin: '395007' } },
  returns: { window_days: 7, condition: 'unworn_with_tags', refund_days: 5 },
} as unknown as Schemas['StoreDetails']

function show({ draft = PROFILE, live = null, products = [1, 2, 3, 4].map((n) => summary(n)) }: { draft?: Profile; live?: Profile | null; products?: Schemas['ProductSummary'][] } = {}) {
  // Seeded and never stale: the preview reads from the cache, as it does once the editor has loaded.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } } })
  client.setQueryData(keys.products({ status: 'approved', limit: 4 }), page(products))
  // Anything but the approved list would show this draft product.
  client.setQueryData(keys.products({ limit: 4 }), page([summary(9, 'draft')]))
  client.setQueryData(keys.storeDetails, STORE)
  const view = render(
    <ThemeProviders>
      <QueryClientProvider client={client}>
        <BrandPreview draft={draft} live={live} />
      </QueryClientProvider>
    </ThemeProviders>,
  )
  const phone = view.container.querySelector<HTMLElement>('[data-phone="screen"]')!
  const part = (name: string) => phone.querySelector<HTMLElement>(`[data-part="${name}"]`)
  return { ...view, phone, part }
}

const css = (el: Element | null) => getComputedStyle(el!)
const ratio = (value: string) => {
  const [w, h] = value.split('/').map((n) => Number(n.trim()))
  return w! / h!
}

describe('Brand page preview: the phone', () => {
  it('is a phone of real proportions (390 × 844) that never runs wider than its column', () => {
    const { phone, container } = show()
    expect(ratio(css(phone).aspectRatio)).toBeCloseTo(390 / 844, 5)
    const device = container.querySelector('[data-phone="device"]')
    expect(css(device).maxWidth).toBe('100%')
    expect(css(phone).overflow).toBe('hidden')
  })

  it("wears the app's own chrome: a status bar, a top bar and a tab bar of five", () => {
    const { part } = show()
    for (const name of ['status-bar', 'top-bar', 'tab-bar']) expect(part(name), name).toHaveAttribute('aria-hidden', 'true')
    expect(part('status-bar')).toHaveTextContent('9:41')
    // Home, saved, search, bag and profile, as icons without words (the app's tab bar).
    expect(part('tab-bar')!.querySelectorAll('svg')).toHaveLength(5)
    expect(part('tab-bar')).toHaveTextContent('')
    expect(part('top-bar')!.querySelector('[role="img"][aria-label="Shazlo"]')).not.toBeNull()
  })

  it('lays the page out top to bottom: cover, logo, name, meta, about, links, products', () => {
    const { phone } = show()
    const order = [...phone.querySelectorAll('[data-part]')].map((el) => el.getAttribute('data-part'))
    expect(order).toEqual(['status-bar', 'top-bar', 'cover', 'logo', 'name', 'meta', 'about', 'links', 'products', 'tab-bar'])
  })

  it('scrolls the page between the bars, and keyboard users can scroll it too', () => {
    const { part } = show()
    const content = screen.getByRole('group', { name: 'Phone screen' })
    expect(content).toHaveAttribute('tabindex', '0')
    expect(css(content).overflowY).toBe('auto')
    expect(content).toContainElement(part('cover'))
    expect(content).toContainElement(part('products'))
    expect(content).not.toContainElement(part('tab-bar'))
  })
})

describe('Brand page preview: cover and logo', () => {
  it('shows the cover full width at the ratio the editor asks for', () => {
    const { part } = show()
    const cover = part('cover')!
    expect(ratio(css(cover).aspectRatio)).toBeCloseTo(COVER_SIZE.width / COVER_SIZE.height, 5)
    expect(ratio(css(cover).aspectRatio)).toBeCloseTo(8 / 3, 5)
    // Edge to edge: a direct child of the unpadded scroll area.
    expect(cover.parentElement).toHaveAttribute('role', 'group')
    expect(['', '0px']).toContain(css(cover.parentElement).paddingLeft)
    expect(css(cover).width).toBe('100%')
    expect(within(cover).getByRole('presentation')).toHaveAttribute('src', 'https://img.test/cover.jpg')
  })

  it('names the sizes the preview shows in the editor hints', () => {
    expect(COVER_SIZE.width / COVER_SIZE.height).toBeCloseTo(8 / 3, 5)
    expect(brandCopy.identity.coverHint).toContain(`${COVER_SIZE.width} × ${COVER_SIZE.height} px`)
    expect(brandCopy.identity.logoHint).toContain(`${LOGO_MIN_PX} × ${LOGO_MIN_PX} px`)
    expect(brandCopy.identity.logoHint).toMatch(/circle/)
  })

  it('rings the logo in the page colour, with a soft shadow, half over the cover', () => {
    const { phone, part } = show()
    const logo = part('logo')!
    const style = css(logo)
    expect(style.borderRadius).toBe('50%')
    expect(style.borderTopStyle).toBe('solid')
    expect(parseFloat(style.borderTopWidth)).toBeGreaterThan(0)
    expect(style.borderTopColor).toBe(css(phone).backgroundColor)
    expect(style.boxShadow).not.toBe('')
    expect(style.boxShadow).not.toBe('none')
    // Pulled up by half its height, so its centre sits on the cover's lower edge.
    expect(parseFloat(style.marginTop)).toBeCloseTo(-parseFloat(style.height) / 2, 1)
    expect(style.width).toBe(style.height)
    // Set left, with the page's side padding.
    expect(parseFloat(css(logo.parentElement).paddingLeft)).toBeGreaterThan(0)
    expect(within(logo).getByRole('presentation')).toHaveAttribute('src', 'https://img.test/logo.png')
  })

  it('puts the brand name below the logo, never on the cover', () => {
    const { part } = show()
    const name = part('name')!
    expect(name).toHaveTextContent('Kalki Studio')
    expect(part('cover')).not.toContainElement(name)
    expect(part('logo')!.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows the initials in the circle until a logo is added', () => {
    const { part } = show({ draft: { ...PROFILE, brand_name: 'Neel Threads', logo_url: null } })
    const logo = part('logo')!
    expect(logo).toHaveTextContent('NT')
    expect(logo.querySelector('img')).toBeNull()
    expect(css(logo).borderTopStyle).toBe('solid')
  })

  it('shows a calm tinted cover until one is added, at the same ratio', () => {
    const { part } = show({ draft: { ...PROFILE, cover_url: null } })
    const cover = part('cover')!
    expect(cover.querySelector('img')).toBeNull()
    expect(cover).toHaveAttribute('data-empty', 'true')
    expect(css(cover).backgroundImage).toMatch(/gradient/)
    expect(ratio(css(cover).aspectRatio)).toBeCloseTo(8 / 3, 5)
    expect(cover).toHaveTextContent('')
  })

  it('never loads a logo or cover from an address that is not safe', () => {
    const { part } = show({ draft: { ...PROFILE, logo_url: 'javascript:alert(1)', cover_url: 'http://plain.test/c.jpg' } })
    expect(part('logo')!.querySelector('img')).toBeNull()
    expect(part('logo')).toHaveTextContent('KS')
    expect(part('cover')!.querySelector('img')).toBeNull()
  })
})

describe('Brand page preview: the words', () => {
  it('wraps a long name and story cleanly instead of running off the screen', () => {
    const name = 'Kalamkari'.repeat(12)
    const story = 'Handwoven'.repeat(40)
    const { part } = show({ draft: { ...PROFILE, brand_name: name, story } })
    for (const which of ['name', 'about']) {
      expect(css(part(which)).overflowWrap, which).toBe('anywhere')
      expect(css(part(which)).whiteSpace, which).not.toBe('nowrap')
    }
    expect(part('name')).toHaveTextContent(name)
  })

  it('reads the meta row from Based in and Store details', () => {
    const { part } = show()
    const meta = part('meta')!
    expect(within(meta).getByText('Ahmedabad')).toBeInTheDocument()
    expect(within(meta).getByText('Shazlo delivery')).toBeInTheDocument()
    expect(within(meta).getByText('7-day returns')).toBeInTheDocument()
  })

  it('leaves out what is not filled in yet', () => {
    const { part } = show({ draft: { ...PROFILE, story: '', instagram: '', website: '' } })
    expect(part('about')).toBeNull()
    expect(part('links')).toBeNull()
    expect(part('name')).toBeInTheDocument()
  })

  it('shows no tagline, even one an old page still has', () => {
    // The brand page has no tagline any more. The adapter drops vendor-api's; even if one got through, it stays unseen.
    const old = { ...PROFILE, tagline: 'Hand block-printed, naturally dyed.' } as Profile
    const { part } = show({ draft: old, live: old })
    expect(part('tagline')).toBeNull()
    expect(screen.queryByText('Hand block-printed, naturally dyed.')).toBeNull()
    expect(part('name')).toHaveTextContent('Kalki Studio')
  })
})

describe('Brand page preview: products', () => {
  it('shows approved products only, in two columns of 3:4 photos', () => {
    const { part } = show()
    const products = part('products')!
    const tiles = within(products).getAllByRole('listitem')
    expect(tiles).toHaveLength(4)
    expect(within(products).queryByText('Ajrakh Kurta 9')).toBeNull()
    expect(css(within(products).getByRole('list')).gridTemplateColumns).toMatch(/^repeat\(2, minmax\(0(px)?, 1fr\)\)$/)
    expect(ratio(css(tiles[0]!.firstElementChild).aspectRatio)).toBeCloseTo(3 / 4, 5)
    expect(within(tiles[0]!).getByText('Ajrakh Kurta 1')).toBeInTheDocument()
    expect(within(tiles[0]!).getByText('₹2,499')).toBeInTheDocument()
  })

  it('holds the shape with empty tiles while nothing is approved', () => {
    const { part } = show({ products: [] })
    const products = part('products')!
    expect(within(products).queryAllByRole('listitem')).toHaveLength(0)
    const empty = products.querySelectorAll('[data-tile="empty"]')
    expect(empty).toHaveLength(4)
    expect(ratio(css(empty[0]!).aspectRatio)).toBeCloseTo(3 / 4, 5)
  })
})

describe('Brand page preview: draft and live', () => {
  it('switches between the draft and the live page', async () => {
    const user = userEvent.setup()
    show({ draft: { ...PROFILE, story: 'The draft story' }, live: { ...PROFILE, story: 'The live story', cover_url: null } })
    const region = screen.getByRole('region', { name: 'Preview in the Shazlo app' })
    const version = within(region).getByRole('group', { name: 'Preview version' })
    expect(within(region).getByText('The draft story')).toBeInTheDocument()
    await user.click(within(version).getByRole('button', { name: 'Live' }))
    expect(within(region).getByText('The live story')).toBeInTheDocument()
    expect(within(region).queryByText('The draft story')).toBeNull()
    expect(region.querySelector('[data-part="cover"]')).toHaveAttribute('data-empty', 'true')
    await user.click(within(version).getByRole('button', { name: 'Draft' }))
    expect(within(region).getByText('The draft story')).toBeInTheDocument()
  })

  it('has no switch before the page has gone live', () => {
    show()
    expect(screen.queryByRole('group', { name: 'Preview version' })).toBeNull()
    expect(screen.getByText('Product tiles show only approved products.')).toBeInTheDocument()
  })
})
