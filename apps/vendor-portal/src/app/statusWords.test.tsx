import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MockDb } from '../mocks/db'
import { renderApp, type Viewport } from '../test/render'

// #267: one product, one word. Whatever screen a seller opens, a state has the same name.
// Seed: the Ajrakh kurta (p_001) was sent back, the Dabu skirt (p_007) is in review for the first
// time, and the Handloom shirt (p_004) is live with an edit in review.
const NOW = new Date('2026-10-31T13:40:00+05:30')
// Each test renders many full screens; leave room for a slow, busy machine.
const SLOW = { timeout: 20_000 }
const AJRAKH = { id: 'p_001', title: 'Ajrakh Block-Print Kurta' }
const DABU = { id: 'p_007', title: 'Dabu Print Wrap Skirt' }
const SHIRT = { id: 'p_004', title: 'Handloom Cotton Shirt — Rust' }

// Words only the admin uses for these states. A seller label never says them, though a sentence
// may still say what the team did ("Sent back today, 11:40").
const ADMIN_LABEL = /^\s*(pending review|sent back|edit in review|needs your changes|waiting|waiting for review)(\s+[\d,]+)?\s*$/i
// Phrases that are never right anywhere on a seller screen, even inside a sentence or a count.
const ADMIN_PHRASE = /needs your changes|edit in review|pending review|\b\d+ waiting\b/i

beforeAll(async () => {
  // Load the lazily imported screens once, so the first render does not time out.
  await Promise.all([
    import('../screens/overview/Overview'),
    import('../screens/products/ProductList'),
    import('../screens/products/ProductEditor'),
    import('../screens/review/ReviewStatus'),
    import('../screens/brand/BrandEditor'),
  ])
})
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

async function open(route: string, viewport: Viewport = 'desktop') {
  cleanup()
  return renderApp({ route, viewport })
}

const statusOf = (row: Element) => (row.querySelector('[data-status]')?.textContent ?? '').trim()
const withoutCount = (text: string) => text.replace(/\s*[\d,]+\s*$/, '').trim()

async function productsRow(title: string, viewport: Viewport) {
  const list = viewport === 'mobile' ? await screen.findByRole('list', { name: 'Products' }, SLOW) : await screen.findByRole('table', { name: 'Products' }, SLOW)
  const name = await within(list).findByText(title, {}, SLOW)
  return name.closest('tr, li')!
}

async function reviewRow(regionName: string, title: string) {
  const region = await screen.findByRole('region', { name: regionName }, SLOW)
  const link = await within(region).findByRole('link', { name: title }, SLOW)
  return link.closest('li')!
}

async function editorStatus() {
  const h1 = await screen.findByRole('heading', { level: 1 }, SLOW)
  await waitFor(() => expect(h1.parentElement!.querySelector('[data-status]')).not.toBeNull(), SLOW)
  return statusOf(h1.parentElement!)
}

async function selectedTab() {
  const tab = await screen.findByRole('tab', { selected: true }, SLOW)
  await waitFor(() => expect(tab.textContent).toMatch(/\d$/), SLOW)
  return withoutCount(tab.textContent ?? '')
}

async function figureFor(status: string) {
  const link = await waitFor(() => {
    const found = document.querySelector(`[role="group"] a[href="/products?status=${status}"]`)
    expect(found).not.toBeNull()
    return found!
  }, SLOW)
  const group = link.closest('[role="group"]')!
  return document.getElementById(group.getAttribute('aria-labelledby')!)!.textContent!.trim()
}

describe('#267 one product, one word', () => {
  it('calls a sent-back product “Needs changes” on every screen', async () => {
    const seen: Record<string, string> = {}

    await open('/products')
    seen['Products, laptop'] = statusOf(await productsRow(AJRAKH.title, 'desktop'))

    await open('/products', 'mobile')
    seen['Products, phone'] = statusOf(await productsRow(AJRAKH.title, 'mobile'))

    await open('/products?status=rejected')
    seen['Products tab'] = await selectedTab()

    await open(`/products/${AJRAKH.id}`)
    seen['Product editor'] = await editorStatus()

    await open('/')
    seen['Overview figure'] = await figureFor('rejected')
    seen['Overview decisions'] = statusOf(await reviewRow('Recent review decisions', AJRAKH.title))

    await open('/', 'mobile')
    const fix = await screen.findByRole('link', { name: `Fix this: ${AJRAKH.title}` }, SLOW)
    seen['Home, phone'] = fix.closest('section')!.querySelector('h2, h3')!.textContent!.trim()

    await open('/review')
    seen['Review status, laptop'] = statusOf(await reviewRow('Recently decided', AJRAKH.title))

    await open('/review', 'mobile')
    seen['Review status, phone'] = statusOf(await reviewRow('Recently decided', AJRAKH.title))

    await open('/review?tab=rejected')
    seen['Review status tab'] = await selectedTab()

    const { user } = await open('/')
    await user.click(await screen.findByRole('button', { name: /^Notifications,/ }, SLOW))
    const item = (await within(await screen.findByRole('menu')).findByText(new RegExp(AJRAKH.title))).closest('[role="menuitem"]')!
    seen['Notifications'] = statusOf(item)

    expect(seen).toEqual(Object.fromEntries(Object.keys(seen).map((k) => [k, 'Needs changes'])))
    expect(Object.keys(seen)).toHaveLength(11)
  }, 240_000)

  it('calls a product waiting for its first review “In review” on every screen', async () => {
    const seen: Record<string, string> = {}

    await open('/products')
    seen['Products, laptop'] = statusOf(await productsRow(DABU.title, 'desktop'))

    await open('/products?status=pending_review')
    seen['Products tab'] = await selectedTab()

    await open(`/products/${DABU.id}`)
    seen['Product editor'] = await editorStatus()

    await open('/')
    seen['Overview figure'] = await figureFor('pending_review')

    await open('/', 'mobile')
    const row = await screen.findByRole('link', { name: /^In review|^Pending review|^Waiting/ }, SLOW)
    expect(row).toHaveAttribute('href', '/products?status=pending_review')
    seen['Home counts, phone'] = withoutCount(row.textContent ?? '')

    await open('/review')
    seen['Review status'] = statusOf(await reviewRow('In review', DABU.title))

    await open('/review?tab=waiting')
    seen['Review status tab'] = await selectedTab()

    expect(seen).toEqual(Object.fromEntries(Object.keys(seen).map((k) => [k, 'In review'])))
  }, 240_000)

  it('calls an edit to a live product “Changes in review” on every screen', async () => {
    const seen: Record<string, string> = {}

    await open('/products')
    seen['Products, laptop'] = statusOf(await productsRow(SHIRT.title, 'desktop'))

    await open(`/products/${SHIRT.id}`)
    seen['Product editor'] = await editorStatus()

    await open('/review')
    seen['Review status'] = statusOf(await reviewRow('In review', SHIRT.title))

    expect(seen).toEqual({ 'Products, laptop': 'Live · Changes in review', 'Product editor': 'Live · Changes in review', 'Review status': 'Changes in review' })
  }, 120_000)
})

// Every place a status is named: pills and product statuses, tabs, headings, figures, regions,
// and the sidebar's count beside Review status.
function adminLabelsOnScreen(): string[] {
  const found: string[] = []
  const check = (text: string | null | undefined) => {
    if (text && ADMIN_LABEL.test(text)) found.push(text.trim())
  }
  document.querySelectorAll('[data-status], [role="tab"], h1, h2, h3, h4, [role="menuitem"] [data-status]').forEach((el) => check(el.textContent))
  document.querySelectorAll('[aria-labelledby]').forEach((el) => {
    for (const id of el.getAttribute('aria-labelledby')!.split(/\s+/)) check(document.getElementById(id)?.textContent)
  })
  document.querySelectorAll('[aria-label]').forEach((el) => {
    const label = el.getAttribute('aria-label')
    check(label)
    if (label && ADMIN_PHRASE.test(label)) found.push(label)
  })
  const body = document.body.textContent ?? ''
  const phrase = ADMIN_PHRASE.exec(body)
  if (phrase) found.push(`…${body.slice(Math.max(0, phrase.index - 30), phrase.index + 40)}…`)
  return found
}

type Sweep = [route: string, viewport: Viewport, ready: () => Promise<unknown>, prepare?: (db: MockDb) => void]

// Each ready check waits for every query the page names a status from. The figure and count
// skeletons carry no aria-busy, so they are waited for by their loaded links.
const overviewLoaded = async () => {
  await reviewRow('Recent review decisions', AJRAKH.title)
  await figureFor('rejected')
}
const phoneHomeLoaded = async () => {
  await screen.findByRole('link', { name: `Fix this: ${AJRAKH.title}` }, SLOW)
  await waitFor(() => expect(document.querySelector('a[href="/products?status=pending_review"]')).not.toBeNull(), SLOW)
}

const sweeps: Sweep[] = [
  ['/', 'desktop', overviewLoaded],
  ['/', 'tablet', overviewLoaded],
  ['/', 'mobile', phoneHomeLoaded],
  ['/products', 'desktop', () => productsRow(AJRAKH.title, 'desktop')],
  ['/products?status=rejected', 'mobile', () => productsRow(AJRAKH.title, 'mobile')],
  ['/products?status=pending_review', 'desktop', () => productsRow(DABU.title, 'desktop')],
  ['/products/p_001', 'desktop', () => editorStatus()],
  // On phones the editor is a step-by-step task; its status is in the subtitle, not a pill.
  ['/products/p_004', 'mobile', () => screen.findByText(/Live · Changes in review/, {}, SLOW)],
  ['/review', 'desktop', () => reviewRow('Recently decided', AJRAKH.title)],
  ['/review', 'mobile', () => reviewRow('Recently decided', AJRAKH.title)],
  ['/review?tab=waiting', 'desktop', () => screen.findByRole('link', { name: DABU.title }, SLOW)],
  ['/review?tab=rejected', 'mobile', () => reviewRow('Recently decided', AJRAKH.title)],
  ['/brand', 'desktop', () => screen.findByRole('textbox', { name: /^Tagline/ }, SLOW), (db) => (db.brand.review = { state: 'waiting', at: NOW.toISOString() })],
  ['/brand', 'mobile', () => screen.findByRole('textbox', { name: /^Tagline/ }, SLOW), (db) => (db.brand.review = { state: 'rejected', at: NOW.toISOString(), reason: 'Cover shows another logo.' })],
]

describe('#267 no admin word on any seller screen', () => {
  it.each(sweeps)('%s on %s', async (route, viewport, ready, prepare) => {
    const view = await open(route, viewport)
    prepare?.(view.db)
    await ready()
    // Let the remaining queries (summary, reviews) land before reading the page.
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull(), SLOW)
    expect(adminLabelsOnScreen()).toEqual([])
  }, 60_000)

  it('also checks the bell and its menu', async () => {
    const { user } = await open('/')
    const bell = await screen.findByRole('button', { name: /^Notifications,/ }, SLOW)
    await user.click(bell)
    await screen.findByRole('menu')
    expect(adminLabelsOnScreen()).toEqual([])
  }, 60_000)
})
