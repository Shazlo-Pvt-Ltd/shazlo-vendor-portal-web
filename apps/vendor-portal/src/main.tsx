import '@shazlo/ui/fonts.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter } from 'react-router'
import { App } from './App'
import { routes } from './app/routes'
import { loadEnv } from './config/env'

async function start() {
  // Demo mode only (VITE_MOCK_API=on): a service worker answers the API from in-memory data. Vite
  // fixes the first test at build time, so a normal build contains no mock code at all. A bad
  // environment starts nothing: the app shows what is wrong instead.
  if (import.meta.env.VITE_MOCK_API === 'on' && loadEnv().ok) {
    const { startMockApi } = await import('./mocks/browser')
    await startMockApi()
  }
  const root = document.getElementById('root')
  if (root) {
    createRoot(root).render(
      <StrictMode>
        <App router={createBrowserRouter(routes)} />
      </StrictMode>,
    )
  }
}

void start()
