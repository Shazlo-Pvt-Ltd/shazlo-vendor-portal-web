import { Button } from '@mui/material'
import { act, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { CrumbProvider } from '../app/crumbs'
import { RequireAuth } from '../session/guards'
import { renderPortal, signedInStore, WIDTHS } from '../session/renderPortal'
import { makeStore, sessionBody } from '../session/testing'
import { AppShell } from './AppShell'
import { StickyFooter } from './StickyFooter'
import { useFullScreenTask } from './task'

const { phone: PHONE, tablet: TABLET, desktop: LAPTOP } = WIDTHS

const linkNames = (nav: HTMLElement) => within(nav).getAllByRole('link').map((l) => l.textContent)

describe('desktop shell (1024 px and wider)', () => {
  it('keeps the Build 2 sidebar, with Store details and the current section marked', async () => {
    renderPortal({ route: '/', width: LAPTOP })
    const nav = await screen.findByRole('navigation', { name: 'Seller sections' })
    expect(nav.closest('[data-nav]')).toHaveAttribute('data-nav', 'sidebar')
    expect(within(nav).getByRole('link', { name: /Overview/ })).toHaveAttribute('aria-current', 'page')
    for (const name of [/Brand page/, /Products/, /Bulk import/, /Review status/, /Team/, /Help & support/]) {
      expect(within(nav).getByRole('link', { name })).toBeInTheDocument()
    }
    expect(within(nav).getByRole('link', { name: 'Store details' })).toHaveAttribute('href', '/store/details')
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
  })

  it('shows staff every section except Team', async () => {
    renderPortal({ route: '/', width: LAPTOP, session: 'staff' })
    const nav = await screen.findByRole('navigation', { name: 'Seller sections' })
    expect(within(nav).queryByRole('link', { name: /Team/ })).toBeNull()
    expect(within(nav).getByRole('link', { name: /Help & support/ })).toBeInTheDocument()
  })

  it('marks Store details while on any store details page', async () => {
    renderPortal({ route: '/store/details', width: LAPTOP })
    const nav = await screen.findByRole('navigation', { name: 'Seller sections' })
    expect(within(nav).getByRole('link', { name: 'Store details' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: /Overview/ })).not.toHaveAttribute('aria-current')
  })

  it('shows the store and the signed-in person from the session', async () => {
    renderPortal({ route: '/', width: LAPTOP, session: signedInStore({ vendorName: 'Kalki Studio', email: 'kiran@kalkistudio.in', role: 'staff' }) })
    const sidebar = (await screen.findByRole('navigation', { name: 'Seller sections' })).closest('[data-nav]') as HTMLElement
    expect(within(sidebar).getByText('Kalki Studio')).toBeInTheDocument()
    expect(within(sidebar).getByText('Approved seller')).toBeInTheDocument()
    expect(within(sidebar).getByText('kiran@kalkistudio.in')).toBeInTheDocument()
    expect(within(sidebar).getByText('Staff')).toBeInTheDocument()
  })

  it('signs out through the session and goes to a plain login', async () => {
    const logout = vi.fn(async () => {})
    const store = makeStore({ refresh: async () => sessionBody(), logout }).store
    const { user, router } = renderPortal({ route: '/products?status=live', width: LAPTOP, session: store })
    await user.click(await screen.findByRole('button', { name: 'Sign out' }))
    await screen.findByRole('heading', { level: 1, name: 'Sign in to your seller account' })
    expect(logout).toHaveBeenCalledOnce()
    expect(store.getSnapshot()).toMatchObject({ status: 'signedOut', signedOutByUser: true })
    expect(router.state.location.pathname).toBe('/login')
    // A deliberate sign-out does not send the next person "back" to this page.
    expect(router.state.location.search).toBe('')
  })

  it('tells a vendor whose application is in review, on Home only', async () => {
    renderPortal({ route: '/', width: LAPTOP, session: signedInStore({ status: 'pending' }) })
    expect(await screen.findByText(/Your application is in review/)).toBeInTheDocument()
    const sidebar = screen.getByRole('navigation', { name: 'Seller sections' }).closest('[data-nav]') as HTMLElement
    expect(within(sidebar).getByText('In review')).toBeInTheDocument()
  })

  it('shows an approved vendor no review notice', async () => {
    renderPortal({ route: '/', width: LAPTOP })
    await screen.findByRole('navigation', { name: 'Seller sections' })
    expect(screen.queryByText(/Your application is in review/)).toBeNull()
  })

  it('has the bell in the top bar', async () => {
    renderPortal({ route: '/', width: LAPTOP })
    expect(await within(await screen.findByRole('banner')).findByRole('button', { name: /^Notifications/ })).toBeInTheDocument()
  })

  it('starts with a skip link to the main content', async () => {
    renderPortal({ route: '/', width: LAPTOP })
    const skip = await screen.findByRole('link', { name: 'Skip to content' })
    expect(skip).toHaveAttribute('href', '#content')
    expect(document.getElementById('content')).toHaveAttribute('tabindex', '-1')
  })
})

describe('tablet shell (600–1023 px)', () => {
  it('uses a navigation rail with labelled icons, no sidebar and no tab bar', async () => {
    renderPortal({ route: '/', width: TABLET })
    const rail = await screen.findByRole('navigation', { name: 'Seller sections' })
    expect(rail.closest('[data-nav]')).toHaveAttribute('data-nav', 'rail')
    expect(linkNames(rail)).toEqual(['Home', 'Products', 'Review', 'Brand page', 'Store details', 'Account'])
    expect(within(rail).getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
  })

  it('marks Account for Team, Help and the password page', async () => {
    for (const route of ['/team', '/help', '/account/password']) {
      const { unmount } = renderPortal({ route, width: TABLET })
      const rail = await screen.findByRole('navigation', { name: 'Seller sections' })
      expect(within(rail).getByRole('link', { name: 'Account' }), route).toHaveAttribute('aria-current', 'page')
      unmount()
    }
  })

  it('keeps the rail and the breadcrumb in a full-screen task', async () => {
    renderPortal({ route: '/store/details/payout', width: TABLET })
    expect(await screen.findByRole('navigation', { name: 'Seller sections' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument()
  })
})

describe('phone shell (under 600 px)', () => {
  it('has four places in the tab bar: no Add tab, no More, no badges', async () => {
    renderPortal({ route: '/products', width: PHONE })
    const tabs = await screen.findByRole('navigation', { name: 'Main' })
    expect(linkNames(tabs)).toEqual(['Home', 'Products', 'Store', 'Account'])
    expect(within(tabs).queryAllByRole('button')).toHaveLength(0)
    expect(within(tabs).getByRole('link', { name: 'Products' })).toHaveAttribute('aria-current', 'page')
    expect(tabs.querySelector('.MuiBadge-badge')).toBeNull()
    expect(screen.queryByRole('navigation', { name: 'Seller sections' })).toBeNull()
  })

  it('moves between tabs', async () => {
    const { user, router } = renderPortal({ route: '/', width: PHONE })
    const tabs = await screen.findByRole('navigation', { name: 'Main' })
    await user.click(within(tabs).getByRole('link', { name: 'Store' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/store'))
    // The tab is marked once the page has loaded (a navigation waits for its lazy page).
    await waitFor(() => expect(within(tabs).getByRole('link', { name: 'Store' })).toHaveAttribute('aria-current', 'page'))
    await user.click(within(tabs).getByRole('link', { name: 'Account' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/account'))
  })

  it('shows Back on inner pages, under the right tab', async () => {
    renderPortal({ route: '/brand', width: PHONE })
    const tabs = await screen.findByRole('navigation', { name: 'Main' })
    expect(within(tabs).getByRole('link', { name: 'Store' })).toHaveAttribute('aria-current', 'page')
    const header = screen.getByRole('banner')
    expect(within(header).getByRole('link', { name: 'Back to Store' })).toHaveAttribute('href', '/store')
    expect(within(header).queryByRole('img', { name: 'Shazlo' })).toBeNull()
  })

  it('reaches Review status from Home and keeps Home marked', async () => {
    renderPortal({ route: '/review', width: PHONE })
    const tabs = await screen.findByRole('navigation', { name: 'Main' })
    expect(within(tabs).getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
    expect(within(screen.getByRole('banner')).getByRole('link', { name: 'Back to Home' })).toHaveAttribute('href', '/')
  })

  it('puts Team and the password page under Account, with Back to Account', async () => {
    for (const route of ['/team', '/account/password', '/help']) {
      const { unmount } = renderPortal({ route, width: PHONE })
      const tabs = await screen.findByRole('navigation', { name: 'Main' })
      expect(within(tabs).getByRole('link', { name: 'Account' }), route).toHaveAttribute('aria-current', 'page')
      expect(within(screen.getByRole('banner')).getByRole('link', { name: 'Back to Account' })).toHaveAttribute('href', '/account')
      unmount()
    }
  })

  it('shows the logo and the bell on a tab page', async () => {
    renderPortal({ route: '/', width: PHONE })
    const header = await screen.findByRole('banner')
    expect(within(header).getByRole('img', { name: 'Shazlo' })).toBeInTheDocument()
    expect(await within(header).findByRole('button', { name: /^Notifications/ })).toBeInTheDocument()
  })

  it('opens a deep link while signed out, signs in, and lands on it', async () => {
    const { router } = renderPortal({ route: '/store/details/payout', width: PHONE, session: 'signedOut' })
    await screen.findByRole('heading', { level: 1, name: 'Sign in to your seller account' })
    expect(new URLSearchParams(router.state.location.search).get('next')).toBe('/store/details/payout')
  })
})

describe('full-screen tasks on phones', () => {
  it('hides the tab bar and the bell on a store detail edit and shows Back', async () => {
    renderPortal({ route: '/store/details/payout', width: PHONE })
    const header = await screen.findByRole('banner')
    expect(await within(header).findByRole('link', { name: 'Back to Store details' })).toHaveAttribute('href', '/store/details')
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
    expect(within(header).queryByRole('button', { name: /Notifications/ })).toBeNull()
    expect(document.documentElement).toHaveAttribute('data-task')
  })

  it('hides the tab bar in the product editor', async () => {
    renderPortal({ route: '/products/new', width: PHONE })
    expect(await within(await screen.findByRole('banner')).findByRole('link', { name: 'Back to Products' })).toHaveAttribute('href', '/products')
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
  })

  it('brings the tab bar back when the task is left by its Back link', async () => {
    const { user } = renderPortal({ route: '/store/details/payout', width: PHONE })
    await user.click(await screen.findByRole('link', { name: 'Back to Store details' }))
    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    expect(document.documentElement).not.toHaveAttribute('data-task')
  })

  it('brings the tab bar back when the browser goes back out of the task', async () => {
    const { user, router } = renderPortal({ route: '/products', width: PHONE })
    const tabs = await screen.findByRole('navigation', { name: 'Main' })
    await act(() => router.navigate('/products/new'))
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull())
    expect(document.documentElement).toHaveAttribute('data-task')
    await act(() => router.navigate(-1))
    await waitFor(() => expect(router.state.location.pathname).toBe('/products'))
    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    expect(document.documentElement).not.toHaveAttribute('data-task')
    expect(tabs).not.toBeInTheDocument()
    void user
  })
})

describe('old addresses', () => {
  it('sends /settings to Store details', async () => {
    const { router } = renderPortal({ route: '/settings' })
    await waitFor(() => expect(router.state.location.pathname).toBe('/store/details'))
  })
})

describe('a page that breaks', () => {
  function Broken(): never {
    throw new Error('secret detail: hunter2')
  }

  it('keeps the navigation, says so plainly, and recovers on another section', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { user, router } = renderPortal({
      route: '/broken',
      width: LAPTOP,
      routes: [
        {
          path: '/',
          element: (
            <RequireAuth>
              <CrumbProvider>
                <AppShell />
              </CrumbProvider>
            </RequireAuth>
          ),
          children: [
            { path: 'broken', element: <Broken /> },
            { path: 'fine', element: <h1>Fine</h1> },
          ],
        },
      ],
    })
    expect(await screen.findByRole('heading', { level: 1, name: 'This page did not load' })).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/hunter2/)
    expect(screen.getByRole('navigation', { name: 'Seller sections' })).toBeInTheDocument()
    await act(() => router.navigate('/fine'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Fine' })).toBeInTheDocument()
    void user
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

function renderShell(path: string, width: number) {
  return renderPortal({
    route: path,
    width,
    routes: [
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
  })
}

describe('useFullScreenTask and StickyFooter', () => {
  it('lets a screen declare a task and steer Back to its previous step', async () => {
    const { user } = renderShell('/steps', PHONE)
    expect(await screen.findByRole('heading', { name: 'Step 2' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
    await user.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Back to Step 1' }))
    expect(screen.getByRole('heading', { name: 'Step 1' })).toBeInTheDocument()
    // On the first step Back follows the route again.
    expect(within(screen.getByRole('banner')).getByRole('link', { name: 'Back to Home' })).toHaveAttribute('href', '/')
  })

  it('puts the footer at the bottom edge in a task, above the home indicator', async () => {
    renderShell('/steps', PHONE)
    const footer = (await screen.findByRole('button', { name: 'Next' })).closest('[data-sticky-footer]') as HTMLElement
    expect(footer).toHaveStyle({ position: 'sticky', bottom: '0px' })
  })

  it('never puts the footer on top of the tab bar', async () => {
    renderShell('/plain', PHONE)
    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    const footer = screen.getByRole('button', { name: 'Save' }).closest('[data-sticky-footer]') as HTMLElement
    expect(getComputedStyle(footer).bottom).not.toBe('0px')
  })

  it('leaves the rail and sidebar alone on wider screens', async () => {
    renderShell('/steps', TABLET)
    expect(await screen.findByRole('navigation', { name: 'Seller sections' })).toBeInTheDocument()
    const footer = screen.getByRole('button', { name: 'Next' }).closest('[data-sticky-footer]') as HTMLElement
    expect(footer).toHaveStyle({ position: 'sticky', bottom: '0px' })
  })
})
