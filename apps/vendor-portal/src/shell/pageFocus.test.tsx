import { act, screen, waitFor, within } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { renderApp } from '../test/render'
import { setupMockApi } from '../test/server'
import { mayTakeFocus } from './pageFocus'

// After moving to another page inside the app, focus goes to the new page's h1, so a screen reader
// announces where the seller landed (main's portal did this; WCAG 2.4.3). Not on the first page,
// not when only the query or fragment changes, and never over focus a page placed itself.

const { db } = setupMockApi()

// The screens are lazy chunks: load them once up front, so a busy machine does not time the tests out.
beforeAll(async () => {
  await Promise.all([import('../screens/review/ReviewStatus'), import('../screens/store/StoreDetails'), import('../screens/store/StoreSection'), import('../screens/brand/BrandEditor'), import('../screens/overview/Overview')])
})
const SLOW = { timeout: 15_000 }

const sidebar = () => screen.getByRole('navigation', { name: 'Seller sections' })

describe('focus after navigation', () => {
  it('leaves focus alone on the first page', async () => {
    await renderApp({ route: '/review' })
    await screen.findByRole('heading', { level: 1, name: 'Review status' }, SLOW)
    await screen.findByRole('tab', { name: /^All/ }, SLOW)
    expect(document.activeElement).toBe(document.body)
  })

  it('moves focus to the new page heading after a link in the navigation', async () => {
    const { user } = await renderApp({ route: '/review' })
    await screen.findByRole('heading', { level: 1, name: 'Review status' }, SLOW)
    await user.click(within(sidebar()).getByRole('link', { name: 'Store details' }))
    const heading = await screen.findByRole('heading', { level: 1, name: 'Store details' }, SLOW)
    await waitFor(() => expect(document.activeElement).toBe(heading))
    // Focusable only from code: it does not join the tab order.
    expect(heading).toHaveAttribute('tabindex', '-1')
  })

  it('follows a page whose heading is replaced once its data arrives', async () => {
    // The brand page shows a skeleton with its own heading first, then the form with a new one.
    const { user } = await renderApp({ route: '/review' })
    await screen.findByRole('heading', { level: 1, name: 'Review status' }, SLOW)
    db().faults.push({ path: '/v1/vendor/brand-profile', method: 'GET', status: 503, code: 'unavailable', message: 'Busy.' })
    await user.click(within(sidebar()).getByRole('link', { name: 'Brand page' }))
    const retry = await screen.findByRole('button', { name: 'Try again' }, SLOW)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Brand page' })))
    await user.click(retry)
    await screen.findByRole('textbox', { name: /^Story/ }, SLOW)
    // The click on Try again put focus on the button, which is gone now; the new heading takes it.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Brand page' })))
  })

  it('does not move focus when only the query changes', async () => {
    const { user } = await renderApp({ route: '/review' })
    const sentBack = await screen.findByRole('tab', { name: /^Sent back/ }, SLOW)
    await user.click(sentBack)
    await waitFor(() => expect(sentBack).toHaveAttribute('aria-selected', 'true'))
    expect(document.activeElement).toBe(sentBack)
  })

  it('keeps focus a page placed itself, like the saved notice on Store details', async () => {
    const { user } = await renderApp({ route: '/store/details/returns' })
    await user.click(await screen.findByRole('radio', { name: 'No returns' }, SLOW))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    const saved = await screen.findByText('Returns saved', {}, SLOW)
    await waitFor(() => expect(saved.closest('[tabindex="-1"]')).toHaveFocus())
  })

  it('moves focus after Back too, and after a phone tab', async () => {
    const { user, router } = await renderApp({ route: '/store/details', viewport: 'mobile' })
    await screen.findByRole('heading', { level: 1, name: 'Store details' })
    await user.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Home' }))
    const home = await screen.findByRole('heading', { level: 1, name: 'Home' })
    await waitFor(() => expect(document.activeElement).toBe(home))
    await act(() => router.navigate(-1))
    const details = await screen.findByRole('heading', { level: 1, name: 'Store details' })
    await waitFor(() => expect(document.activeElement).toBe(details))
  })
})

describe('who may take focus', () => {
  const main = document.createElement('main')
  const inMain = document.createElement('button')
  const outside = document.createElement('a')
  main.append(inMain)
  beforeAll(() => document.body.append(main, outside))
  afterAll(() => {
    main.remove()
    outside.remove()
  })

  it('a new page heading takes focus from the link that opened it, or from nothing', () => {
    expect(mayTakeFocus({ active: outside, main, navigation: 'PUSH', tookFocus: false })).toBe(true)
    expect(mayTakeFocus({ active: document.body, main, navigation: 'POP', tookFocus: false })).toBe(true)
    expect(mayTakeFocus({ active: null, main, navigation: 'PUSH', tookFocus: false })).toBe(true)
  })

  it('never takes focus a page placed inside itself', () => {
    expect(mayTakeFocus({ active: inMain, main, navigation: 'PUSH', tookFocus: false })).toBe(false)
  })

  it('on a replace (an editor taking its new address), only when focus was lost', () => {
    expect(mayTakeFocus({ active: outside, main, navigation: 'REPLACE', tookFocus: false })).toBe(false)
    expect(mayTakeFocus({ active: inMain, main, navigation: 'REPLACE', tookFocus: false })).toBe(false)
    expect(mayTakeFocus({ active: document.body, main, navigation: 'REPLACE', tookFocus: false })).toBe(true)
  })

  it('once it has taken focus, takes it again only when the heading it focused went away', () => {
    expect(mayTakeFocus({ active: outside, main, navigation: 'PUSH', tookFocus: true })).toBe(false)
    const gone = document.createElement('h1')
    expect(mayTakeFocus({ active: gone, main, navigation: 'PUSH', tookFocus: true })).toBe(true)
    expect(mayTakeFocus({ active: document.body, main, navigation: 'PUSH', tookFocus: true })).toBe(true)
  })
})
