import { render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { AppProviders, makeQueryClient } from '../app/providers'
import { routes } from '../app/routes'

/**
 * Renders the module at `path`. jsdom is not framed, so the module runs in its development
 * "standalone" mode with a sample vendor_reviewer. Reset any module mock state in the test itself.
 */
export function renderRoute(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const utils = render(
    <AppProviders client={makeQueryClient()}>
      <RouterProvider router={router} />
    </AppProviders>,
  )
  return { ...utils, router }
}
