import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import { RouterProvider, createMemoryRouter, type RouteObject } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NetworkError } from '../api/errors'
import { routes } from '../app/routes'
import { AuthProvider } from './AuthProvider'
import { RequireAuth, RequireRole } from './guards'
import type { SessionStore } from './store'
import { apiError, makeStore, sessionBody } from './testing'

afterEach(() => vi.restoreAllMocks())

async function open(path: string, store: SessionStore, tree: RouteObject[] = routes) {
  const router = createMemoryRouter(tree, { initialEntries: [path] })
  const queryClient = new QueryClient()
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider store={store}>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  )
  return router
}

const signedIn = (roles = ['super_admin']) => makeStore({ refresh: async () => sessionBody({ roles }), fetchMe: async () => ({ ...sessionBody({ roles }).admin }) }).store
const signedOut = () => makeStore({ refresh: async () => { throw apiError(401, 'unauthorized') } }).store
const mustChange = () => makeStore({ refresh: async () => sessionBody({ must_change_password: true }) }).store

describe('RequireAuth', () => {
  it('shows a spinner while the session is restored, then the page', async () => {
    const router = await open('/', signedIn())
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy()
    expect(await screen.findByRole('heading', { level: 1, name: 'Shazlo-One' })).toBeTruthy()
    expect(router.state.location.pathname).toBe('/')
  })

  it('sends a signed-out admin to a plain /login from home', async () => {
    const router = await open('/', signedOut())
    await screen.findByRole('heading', { level: 1, name: 'Sign in' })
    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.location.search).toBe('')
  })

  it('keeps the place the admin was working at, in return-to, when the session ends mid-work', async () => {
    let answer: 'ok' | 'denied' = 'ok'
    const store = makeStore({
      refresh: async () => {
        if (answer === 'denied') throw apiError(401, 'unauthorized')
        return sessionBody()
      },
      fetchMe: async () => sessionBody().admin,
    }).store
    const router = await open('/?tab=1', store)
    await screen.findByRole('heading', { level: 1, name: 'Shazlo-One' })
    answer = 'denied'
    await act(async () => {
      await store.renew()
    })
    await screen.findByRole('heading', { level: 1, name: 'Sign in' })
    expect(router.state.location.pathname).toBe('/login')
    expect(new URLSearchParams(router.state.location.search).get('return-to')).toBe('/?tab=1')
    expect(router.state.location.state).toEqual({ expired: true })
  })

  it('starts fresh, with no return-to, after the admin’s own sign-out', async () => {
    const store = signedIn()
    const router = await open('/?tab=1', store)
    await screen.findByRole('heading', { level: 1, name: 'Shazlo-One' })
    await act(async () => {
      await store.logout()
    })
    await screen.findByRole('heading', { level: 1, name: 'Sign in' })
    expect(router.state.location.search).toBe('')
  })

  it('says the server is unreachable instead of signing out, and recovers on retry', async () => {
    let down = true
    const store = makeStore({
      refresh: async () => {
        if (down) throw new NetworkError('network')
        return sessionBody()
      },
      fetchMe: async () => sessionBody().admin,
    }).store
    await open('/', store)
    expect(await screen.findByRole('heading', { level: 1, name: "Can't reach the server" })).toBeTruthy()
    down = false
    await act(async () => {
      screen.getByRole('button', { name: 'Try again' }).click()
    })
    expect(await screen.findByRole('heading', { level: 1, name: 'Shazlo-One' })).toBeTruthy()
  })

  it('holds an admin who must change their password at that screen, and nowhere else', async () => {
    const router = await open('/', mustChange())
    expect(await screen.findByRole('heading', { level: 1, name: 'Change your password' })).toBeTruthy()
    expect(router.state.location.pathname).toBe('/change-password')
    await act(async () => {
      await router.navigate('/login')
    })
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/change-password'))
    await act(async () => {
      await router.navigate('/')
    })
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/change-password'))
  })
})

describe('PublicOnly', () => {
  it('lets a signed-out admin see login', async () => {
    await open('/login', signedOut())
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeTruthy()
  })

  it('sends a signed-in admin home', async () => {
    const router = await open('/login', signedIn())
    await screen.findByRole('heading', { level: 1, name: 'Shazlo-One' })
    expect(router.state.location.pathname).toBe('/')
  })

  it('sends a signed-in admin to a valid return-to, and ignores a hostile one', async () => {
    const router = await open('/login?return-to=%2F%3Ftab%3D2', signedIn())
    await screen.findByRole('heading', { level: 1, name: 'Shazlo-One' })
    expect(router.state.location.pathname + router.state.location.search).toBe('/?tab=2')
    const other = await open('/login?return-to=https%3A%2F%2Fevil.example', signedIn())
    await vi.waitFor(() => expect(other.state.location.pathname).toBe('/'))
    expect(other.state.location.search).toBe('')
  })

  it('sends an admin who must change their password to that screen, not to login', async () => {
    const router = await open('/login', mustChange())
    await screen.findByRole('heading', { level: 1, name: 'Change your password' })
    expect(router.state.location.pathname).toBe('/change-password')
  })
})

describe('the change-password screen', () => {
  it('sends a signed-out admin to login', async () => {
    const router = await open('/change-password', signedOut())
    await screen.findByRole('heading', { level: 1, name: 'Sign in' })
    expect(router.state.location.pathname).toBe('/login')
  })

  it('is open to a signed-in admin (changing a password later)', async () => {
    await open('/change-password', signedIn())
    expect(await screen.findByRole('heading', { level: 1, name: 'Change your password' })).toBeTruthy()
  })
})

describe('RequireRole', () => {
  const tree: RouteObject[] = [
    {
      element: <RequireAuth />,
      children: [
        {
          path: '/admins',
          element: (
            <RequireRole anyOf={['super_admin']}>
              <h1>Admins</h1>
            </RequireRole>
          ),
        },
      ],
    },
  ]

  it('lets a super admin in', async () => {
    await open('/admins', signedIn(['super_admin']), tree)
    expect(await screen.findByRole('heading', { level: 1, name: 'Admins' })).toBeTruthy()
  })

  it('shows another role a not-allowed page in place, not a redirect and not the page', async () => {
    const router = await open('/admins', signedIn(['reviewer']), tree)
    expect(await screen.findByRole('heading', { level: 1, name: "You don't have access to this page" })).toBeTruthy()
    expect(router.state.location.pathname).toBe('/admins')
    expect(screen.queryByRole('heading', { name: 'Admins' })).toBeNull()
  })

  it('accepts any one of several roles, and refuses an admin with none', async () => {
    const many: RouteObject[] = [
      {
        element: <RequireAuth />,
        children: [
          {
            path: '/queue',
            element: (
              <RequireRole anyOf={['reviewer', 'super_admin']}>
                <h1>Queue</h1>
              </RequireRole>
            ),
          },
        ],
      },
    ]
    await open('/queue', signedIn(['reviewer']), many)
    expect(await screen.findByRole('heading', { level: 1, name: 'Queue' })).toBeTruthy()
  })
})
