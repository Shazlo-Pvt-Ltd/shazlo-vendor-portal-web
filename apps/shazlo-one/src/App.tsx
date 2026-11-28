import { RouterProvider } from 'react-router'
import { Providers } from './app/Providers'
import { router } from './app/router'
import { Misconfigured } from './components/Misconfigured'
import { loadEnv } from './config/env'
import { loadRegistry } from './modules/loadRegistry'
import { ModuleRegistryProvider } from './modules/ModuleRegistryProvider'
import { AuthProvider } from './session/AuthProvider'

/**
 * Checks the environment and the module registry first: a bad build shows what is wrong instead of
 * a blank page (or a frame the policy would block).
 */
export function App() {
  const env = loadEnv()
  const registry = loadRegistry()
  const problems = [...(env.ok ? [] : env.problems), ...(registry.ok ? [] : registry.problems)]
  return (
    <Providers>
      {env.ok && registry.ok ? (
        <ModuleRegistryProvider entries={registry.entries}>
          <AuthProvider>
            <RouterProvider router={router} />
          </AuthProvider>
        </ModuleRegistryProvider>
      ) : (
        <Misconfigured problems={problems} />
      )}
    </Providers>
  )
}
