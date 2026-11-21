import '@shazlo/ui/fonts.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter } from 'react-router'
import { apiUrls, createAppContext } from './api/context'
import { App } from './app/App'
import { routes } from './app/routes'

async function start() {
  // identity-api is mocked in the browser unless VITE_MOCK_API=off. vendor-api's admin routes come from
  // the shared mock server (npm run serve -w @shazlo/mock-vendor-api) or VITE_VENDOR_API_URL.
  if (import.meta.env.VITE_MOCK_API !== 'off') {
    const { startMockIdentity } = await import('./mocks/browser')
    await startMockIdentity()
  }
  const context = createAppContext(apiUrls())
  // Restore the session from the refresh cookie before routing; tokens never touch storage.
  await context.session.refresh()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App context={context} router={createBrowserRouter(routes)} />
    </StrictMode>,
  )
}

void start()
