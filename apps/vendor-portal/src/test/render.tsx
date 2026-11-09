import { render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { resetMock } from '../api/mock'
import { AppProviders, makeQueryClient } from '../app/providers'
import { routes } from '../app/routes'

/** Renders the real app at `path` against a fresh mock API. */
export function renderRoute(path: string, { signedIn = true }: { signedIn?: boolean } = {}) {
  resetMock(signedIn)
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const utils = render(
    <AppProviders client={makeQueryClient()}>
      <RouterProvider router={router} />
    </AppProviders>,
  )
  return { ...utils, router }
}
