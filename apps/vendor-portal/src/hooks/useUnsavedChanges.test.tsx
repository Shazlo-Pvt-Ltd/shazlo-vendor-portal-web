import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, Link, RouterProvider, useNavigate } from 'react-router'
import { describe, expect, it } from 'vitest'
import { useLeaveGuard } from './useUnsavedChanges'

// The editor's leave guard (main's useUnsavedChanges without main's confirm dialog): the screen
// draws its own dialog from `blocked`, `stay` and `leave`.

function Form({ dirty }: { dirty: boolean }) {
  const guard = useLeaveGuard(dirty)
  const navigate = useNavigate()
  return (
    <>
      <p>{guard.blocked ? 'asking' : 'editing'}</p>
      <button type="button" onClick={guard.stay}>
        Stay
      </button>
      <button type="button" onClick={guard.leave}>
        Leave
      </button>
      <Link to="/elsewhere">Elsewhere</Link>
      <Link to="/form?tab=2">Same page</Link>
      <button
        type="button"
        onClick={() => {
          guard.allowNext()
          void navigate('/saved')
        }}
      >
        Go on purpose
      </button>
    </>
  )
}

function setup(dirty: boolean) {
  const router = createMemoryRouter(
    [
      { path: '/form', element: <Form dirty={dirty} /> },
      { path: '*', element: <p>away</p> },
    ],
    { initialEntries: ['/form'] },
  )
  render(<RouterProvider router={router} />)
  return { router, user: userEvent.setup() }
}

describe('useLeaveGuard', () => {
  it('lets a clean form go', async () => {
    const { user, router } = setup(false)
    await user.click(screen.getByText('Elsewhere'))
    expect(router.state.location.pathname).toBe('/elsewhere')
  })

  it('stops a dirty form leaving until the seller chooses', async () => {
    const { user, router } = setup(true)
    await user.click(screen.getByText('Elsewhere'))
    expect(screen.getByText('asking')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/form')
    await user.click(screen.getByText('Stay'))
    expect(screen.getByText('editing')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/form')

    await user.click(screen.getByText('Elsewhere'))
    await user.click(screen.getByText('Leave'))
    expect(await screen.findByText('away')).toBeInTheDocument()
  })

  it('does not count a change of query as leaving', async () => {
    const { user, router } = setup(true)
    await user.click(screen.getByText('Same page'))
    expect(router.state.location.search).toBe('?tab=2')
    expect(screen.getByText('editing')).toBeInTheDocument()
  })

  it('lets one navigation on purpose through', async () => {
    const { user, router } = setup(true)
    await user.click(screen.getByText('Go on purpose'))
    expect(router.state.location.pathname).toBe('/saved')
  })

  it('asks the browser to warn before the tab closes', () => {
    setup(true)
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })
})
