import '@shazlo/ui/fonts.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter } from 'react-router'
import { createAppContext } from './api/context'
import { App } from './app/App'
import { routes } from './app/routes'

async function start() {
  // Until vendor-api serves these routes, the mock API answers in the browser.
  // Set VITE_MOCK_API=off and VITE_VENDOR_API_URL to use a real server.
  if (import.meta.env.VITE_MOCK_API !== 'off') {
    const { startMockApi } = await import('./mocks/browser')
    await startMockApi()
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App context={createAppContext()} router={createBrowserRouter(routes)} />
    </StrictMode>,
  )
}

void start()
