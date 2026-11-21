import { Button } from '@mui/material'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { createMemoryRouter } from 'react-router'
import { beforeAll, describe, expect, it } from 'vitest'
import { createAppContext } from '../api/context'
import { App } from '../app/App'
import { CrumbProvider } from '../app/crumbs'
import { DEMO_LOGIN } from '../mocks/db'
import { renderApp, setViewport } from '../test/render'
import { resetMockDb } from '../test/server'
import { AppShell } from './AppShell'
import { StickyFooter } from './StickyFooter'
import { useFullScreenTask } from './task'

const PHONE = 390
const TABLET = 768
const LAPTOP = 1280

// Pages load lazily; on a busy machine the first render of a chunk can take a few seconds.
const SLOW = { timeout: 5000 }

// Load the lazily imported screens once up front, so the first test does not time out while
// the chunk is transformed.
beforeAll(async () => {
  await Promise.all([
    import('../screens/overview/Overview'),
    import('../screens/review/ReviewStatus'),
    import('../screens/hubs/StoreHub'),
    import('../screens/hubs/AccountHub'),
    import('../screens/store/StoreDetails'),
    import('../screens/store/StoreSection'),
  ])
})

const linkNames = (nav: HTMLElement) => within(nav).getAllByRole('link').map((l) => l.textContent)

describe('route guard', () => {
  it('sends a signed-out seller to sign in and remembers the page', async () => {
    const { router } = await renderApp({ route: '/products?status=rejected', signedIn: false })
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'))
    expect(new URLSearchParams(router.state.location.search).get('next')).toBe('/products?status=rejected')
  })
})

describe('desktop shell (1024 px and wider)', () => {
  it('keeps the Build 2 sidebar, with live counts, Store details, and the current section marked', async () => {
    await renderApp({ route: '/', viewport: LAPTOP })
    const nav = await screen.findByRole('navigation', { name: 'Seller sections' })
    expect(nav.closest('[data-nav]')).toHaveAttribute('data-nav', 'sidebar')
    expect(within(nav).getByRole('link', { name: /Overview/ })).toHaveAttribute('aria-current', 'page')
    await waitFor(() => expect(within(nav).getByRole('link', { name: /^Products\s*, 27$/ })).toBeInTheDocument())
    expect(within(nav).getByRole('link', { name: /^Review status\s*, 5 waiting$/ })).toBeInTheDocument()
    for (const name of ['Brand page', 'Bulk import', 'Team', 'Help & support']) {
      expect(within(nav).getByRole('link', { name })).toBeInTheDocument()
    }
    expect(within(nav).getByRole('link', { name: 'Store details' })).toHaveAttribute('href', '/store/details')
    expect(within(nav).queryByRole('link', { name: 'Store settings' })).toBeNull()
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
  })

  it('marks Store details while on any store details page', async () => {
    await renderApp({ route: '/store/details', viewport: LAPTOP })
    const nav = await screen.findByRole('navigation', { name: 'Seller sections' })
    expect(within(nav).getByRole('link', { name: 'Store details' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: /Overview/ })).not.toHaveAttribute('aria-current')
  })

  it('shows the store and the signed-in person, and signs out', async () => {
    const { user, router } = await renderApp({ route: '/', viewport: LAPTOP })
    expect(await screen.findByText('Kalki Studio')).toBeInTheDocument()
    expect(screen.getByText('Approved seller')).toBeInTheDocument()
    expect(screen.getByText('Kiran Shah')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'))
  })

  it('lists review decisions behind the bell, with a dot only for what needs changes', async () => {
    const { user } = await renderApp({ route: '/', viewport: LAPTOP })
    // Two products were sent back; only the one from this week is new. Approvals never light the bell.
    const bell = await screen.findByRole('button', { name: 'Notifications, 1 needs your changes' })
    await user.click(bell)
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByText(/Ajrakh Block-Print Kurta was sent back/)).toBeInTheDocument()
    expect(within(menu).getByText(/Bandhani Silk Dupatta is live/)).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'See all review decisions' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument())
  })

  it('shows the breadcrumb trail for the store pages', async () => {
    await renderApp({ route: '/store/details/payout', viewport: LAPTOP })
    const trail = await screen.findByRole('navigation', { name: 'Breadcrumb' })
    // The section page names the last crumb once it loads, which turns "Store details" into a link.
    expect(await within(trail).findByRole('link', { name: 'Store details' }, SLOW)).toHaveAttribute('href', '/store/details')
  })
})

describe('setup banner', () => {
  it('appears on Home only, not on every page', async () => {
    await renderApp({ route: '/', viewport: LAPTOP })
    const banner = await screen.findByRole('status', { name: /of 3 set up/ }, SLOW)
    expect(within(banner).getByRole('link', { name: 'Finish your store details' })).toHaveAttribute('href', '/store/details')
  })

  it('stays away from other pages', async () => {
    await renderApp({ route: '/review', viewport: LAPTOP })
    expect(await screen.findByRole('heading', { level: 1, name: 'Review status' }, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: /set up/ })).toBeNull()
  })

  it('closes for good when the seller dismisses it', async () => {
    const { user } = await renderApp({ route: '/', viewport: LAPTOP })
    const banner = await screen.findByRole('status', { name: /of 3 set up/ }, SLOW)
    await user.click(within(banner).getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('status', { name: /set up/ })).toBeNull()
    expect(localStorage.getItem('shazlo.seller.setup-dismissed.v_kalki')).toBe('1')
  })
})

describe('tablet shell (600–1023 px)', () => {
  it('uses a navigation rail with labelled icons, no sidebar and no tab bar', async () => {
    await renderApp({ route: '/', viewport: TABLET })
    const rail = await screen.findByRole('navigation', { name: 'Seller sections' })
    expect(rail.closest('[data-nav]')).toHaveAttribute('data-nav', 'rail')
    expect(linkNames(rail)).toEqual(['Home', 'Products', 'Review', 'Brand page', 'Store details', 'Account'])
    expect(within(rail).getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
    expect(screen.queryByText('Kalki Studio', { selector: '[data-nav] *' })).toBeNull()
  })

  it('marks Account for Team and Help', async () => {
    await renderApp({ route: '/team', viewport: TABLET })
    const rail = await screen.findByRole('navigation', { name: 'Seller sections' })
    expect(within(rail).getByRole('link', { name: 'Account' })).toHaveAttribute('aria-current', 'page')
  })

  it('keeps the rail and the breadcrumb in a full-screen task', async () => {
    await renderApp({ route: '/store/details/payout', viewport: TABLET })
    expect(await screen.findByRole('navigation', { name: 'Seller sections' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument()
  })
})

describe('phone shell (under 600 px)', () => {
  it('has four places in the tab bar: no Add tab, no More, no badges', async () => {
    await renderApp({ route: '/products', viewport: PHONE })
    const tabs = await screen.findByRole('navigation', { name: 'Main' })
    expect(linkNames(tabs)).toEqual(['Home', 'Products', 'Store', 'Account'])
    expect(within(tabs).queryAllByRole('button')).toHaveLength(0)
    expect(within(tabs).getByRole('link', { name: 'Products' })).toHaveAttribute('aria-current', 'page')
    expect(tabs.querySelector('.MuiBadge-badge')).toBeNull()
    expect(screen.queryByRole('navigation', { name: 'Seller sections' })).toBeNull()
  })

  it('opens Store and Account from the tab bar', async () => {
    const { user, router } = await renderApp({ route: '/', viewport: PHONE })
    const tabs = await screen.findByRole('navigation', { name: 'Main' })
    await user.click(within(tabs).getByRole('link', { name: 'Store' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Store' }, SLOW)).toBeInTheDocument()
    expect(within(tabs).getByRole('link', { name: 'Store' })).toHaveAttribute('aria-current', 'page')
    await user.click(within(tabs).getByRole('link', { name: 'Account' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Account' }, SLOW)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/account')
  })

  it('shows the logo on tab pages and Back on inner pages, under the right tab', async () => {
    await renderApp({ route: '/brand', viewport: PHONE })
    const tabs = await screen.findByRole('navigation', { name: 'Main' })
    expect(within(tabs).getByRole('link', { name: 'Store' })).toHaveAttribute('aria-current', 'page')
    const header = screen.getByRole('banner')
    expect(within(header).getByRole('link', { name: 'Back to Store' })).toHaveAttribute('href', '/store')
    expect(within(header).queryByRole('img', { name: 'Shazlo' })).toBeNull()
  })

  it('reaches Review status from Home and keeps Home marked', async () => {
    await renderApp({ route: '/review', viewport: PHONE })
    const tabs = await screen.findByRole('navigation', { name: 'Main' })
    expect(within(tabs).getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
    expect(within(screen.getByRole('banner')).getByRole('link', { name: 'Back to Home' })).toHaveAttribute('href', '/')
  })

  it('shows the logo and the bell on a tab page', async () => {
    await renderApp({ route: '/', viewport: PHONE })
    const header = screen.getByRole('banner')
    expect(within(header).getByRole('img', { name: 'Shazlo' })).toBeInTheDocument()
    expect(await within(header).findByRole('button', { name: /^Notifications/ })).toBeInTheDocument()
  })
})

describe('full-screen tasks on phones', () => {
  it('hides the tab bar and the bell on a store detail edit and shows Back', async () => {
    await renderApp({ route: '/store/details/payout', viewport: PHONE })
    const header = screen.getByRole('banner')
    expect(await within(header).findByRole('link', { name: 'Back to Store details' })).toHaveAttribute('href', '/store/details')
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
    expect(within(header).queryByRole('button', { name: /Notifications/ })).toBeNull()
    expect(document.documentElement).toHaveAttribute('data-task')
  })

  it('hides the tab bar in the product editor', async () => {
    await renderApp({ route: '/products/new', viewport: PHONE })
    expect(await within(screen.getByRole('banner')).findByRole('link', { name: 'Back to Products' })).toHaveAttribute('href', '/products')
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
  })

  it('brings the tab bar back when the task is left', async () => {
    const { user } = await renderApp({ route: '/store/details/payout', viewport: PHONE })
    await user.click(await screen.findByRole('link', { name: 'Back to Store details' }))
    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    expect(document.documentElement).not.toHaveAttribute('data-task')
  })
})

describe('old addresses', () => {
  it('sends /settings to Store details', async () => {
    const { router } = await renderApp({ route: '/settings' })
    await waitFor(() => expect(router.state.location.pathname).toBe('/store/details'))
  })
})

// A screen that declares itself a task, steps back with its own handler, and uses the sticky footer.
function StepScreen() {
  const [step, setStep] = useState(2)
  useFullScreenTask({ back: step > 1 ? { label: `Step ${step - 1}`, onClick: () => setStep(step - 1) } : undefined })
  return (
    <>
      <h1>Step {step}</h1>
      <StickyFooter>
        <Button variant="contained">Next</Button>
      </StickyFooter>
    </>
  )
}

function PlainScreen() {
  return (
    <>
      <h1>Plain</h1>
      <StickyFooter>
        <Button variant="contained">Save</Button>
      </StickyFooter>
    </>
  )
}

async function renderShell(path: string, width: number) {
  resetMockDb()
  setViewport(width)
  const context = createAppContext({ baseUrl: 'http://localhost' })
  context.session.set(await context.api.call((c) => c.POST('/api/v1/vendor/auth/login', { body: DEMO_LOGIN })))
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: (
          <CrumbProvider>
            <AppShell />
          </CrumbProvider>
        ),
        children: [
          { path: 'steps', element: <StepScreen />, handle: { back: { to: '/', label: 'Home' } } },
          { path: 'plain', element: <PlainScreen /> },
        ],
      },
    ],
    { initialEntries: [path] },
  )
  render(<App context={context} router={router} />)
  return { user: userEvent.setup(), router }
}

describe('useFullScreenTask and StickyFooter', () => {
  it('lets a screen declare a task and steer Back to its previous step', async () => {
    const { user } = await renderShell('/steps', PHONE)
    expect(await screen.findByRole('heading', { name: 'Step 2' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
    await user.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Back to Step 1' }))
    expect(screen.getByRole('heading', { name: 'Step 1' })).toBeInTheDocument()
    // On the first step Back follows the route again.
    expect(within(screen.getByRole('banner')).getByRole('link', { name: 'Back to Home' })).toHaveAttribute('href', '/')
  })

  it('puts the footer at the bottom edge in a task, above the home indicator', async () => {
    await renderShell('/steps', PHONE)
    const footer = (await screen.findByRole('button', { name: 'Next' })).closest('[data-sticky-footer]') as HTMLElement
    expect(footer).toHaveStyle({ position: 'sticky', bottom: '0px' })
  })

  it('never puts the footer on top of the tab bar', async () => {
    await renderShell('/plain', PHONE)
    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    const footer = screen.getByRole('button', { name: 'Save' }).closest('[data-sticky-footer]') as HTMLElement
    expect(getComputedStyle(footer).bottom).not.toBe('0px')
  })

  it('leaves the rail and sidebar alone on wider screens', async () => {
    await renderShell('/steps', TABLET)
    expect(await screen.findByRole('navigation', { name: 'Seller sections' })).toBeInTheDocument()
    const footer = screen.getByRole('button', { name: 'Next' }).closest('[data-sticky-footer]') as HTMLElement
    expect(footer).toHaveStyle({ position: 'sticky', bottom: '0px' })
  })
})
