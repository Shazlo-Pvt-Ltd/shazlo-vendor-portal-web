import '@shazlo/ui/fonts.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter } from 'react-router'
import { App } from './app/App'
import { routes } from './app/routes'
import { shellOrigin, windowHost } from './runtime/runtime'

// vendor-api's admin app, checked by vite.config.ts (src/config/env.ts): in development the shared mock
// server (npm run serve -w @shazlo/mock-vendor-api), in production VITE_VENDOR_API_URL.
declare const __VENDOR_API_ORIGIN__: string

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App host={windowHost(shellOrigin())} apiUrl={__VENDOR_API_ORIGIN__} router={createBrowserRouter(routes)} />
  </StrictMode>,
)
