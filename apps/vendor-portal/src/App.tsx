import type { QueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { createBrowserRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { Providers, ThemeProviders } from './app/Providers'
import { Misconfigured } from './components/Misconfigured'
import { loadEnv } from './config/env'
import type { SessionStore } from './session/store'

type Router = ReturnType<typeof createBrowserRouter>

interface Props {
  router: Router
  /** For tests (see src/session/renderPortal.tsx). */
  session?: SessionStore
  queryClient?: QueryClient
}

/** Checks the environment first: a bad build shows what is wrong instead of a blank page. */
export function App({ router, session, queryClient }: Props) {
  const [env] = useState(loadEnv)
  if (!env.ok) {
    return (
      <ThemeProviders>
        <Misconfigured problems={env.problems} />
      </ThemeProviders>
    )
  }
  return (
    <Providers session={session} queryClient={queryClient}>
      <RouterProvider router={router} />
    </Providers>
  )
}
