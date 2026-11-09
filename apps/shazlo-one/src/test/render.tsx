import { render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { resetShellMock } from '../api/mock'
import { AppProviders, makeQueryClient } from '../app/providers'
import { routes } from '../app/routes'

/** Renders the shell at `path`, optionally signed in as Priya (vendor_reviewer) or Naman (super_admin). */
export function renderRoute(path: string, { as }: { as?: 'reviewer' | 'super' } = {}) {
  resetShellMock(as)
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const utils = render(
    <AppProviders client={makeQueryClient()}>
      <RouterProvider router={router} />
    </AppProviders>,
  )
  return { ...utils, router }
}
