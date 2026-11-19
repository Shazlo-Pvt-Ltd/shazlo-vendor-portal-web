import { RouterProvider } from 'react-router'
import { Providers } from './app/Providers'
import { router } from './app/router'
import { Misconfigured } from './components/Misconfigured'
import { loadEnv } from './config/env'

/** Checks the environment first: a bad build shows what is wrong instead of a blank page. */
export function App() {
  const result = loadEnv()
  return (
    <Providers>
      {result.ok ? <RouterProvider router={router} /> : <Misconfigured problems={result.problems} />}
    </Providers>
  )
}
