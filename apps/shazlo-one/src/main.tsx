import '@shazlo/ui/fonts.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter } from 'react-router'
import { apiUrls, createAppContext } from './api/context'
import { App } from './app/App'
import { routes } from './app/routes'
import { readEnv } from './config/env'
import { Misconfigured } from './screens/Misconfigured'

// vite.config.ts sets it from the same settings. It is a constant, so a build without the mock drops
// the import below, the mock's handlers and its demo passwords.
declare const __MOCK_API__: boolean

async function start() {
  const root = createRoot(document.getElementById('root')!)
  // The build checked these already; a page served with the wrong ones says so instead of running.
  const settings = readEnv({ VITE_IDENTITY_API_URL: import.meta.env.VITE_IDENTITY_API_URL as string | undefined, VITE_MOCK_API: import.meta.env.VITE_MOCK_API as string | undefined }, { dev: import.meta.env.DEV })
  if (!settings.ok) {
    root.render(<Misconfigured problems={settings.problems} />)
    return
  }
  // identity-api is mocked in the browser only when the build was made with the mock (VITE_MOCK_API).
  // Modules and their summaries come from the registry the build was made with (ADR 0011).
  if (__MOCK_API__) {
    const { startMockIdentity } = await import('./mocks/browser')
    await startMockIdentity()
  }
  const context = createAppContext(apiUrls(settings.env.identityOrigin ?? undefined))
  // Restore the session from the refresh cookie before routing; tokens never touch storage.
  await context.session.start()
  root.render(
    <StrictMode>
      <App context={context} router={createBrowserRouter(routes)} />
    </StrictMode>,
  )
}

void start()
