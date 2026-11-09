import '@shazlo/ui/fonts.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter } from 'react-router'
import { App } from './app/App'
import { routes } from './app/routes'
import { shellOrigin, windowHost } from './runtime/runtime'

// vendor-api's admin routes: the shared mock server in development (npm run serve -w @shazlo/mock-vendor-api).
const apiUrl = ((import.meta.env.VITE_VENDOR_API_URL as string | undefined) ?? 'http://localhost:5194').replace(/\/+$/, '')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App host={windowHost(shellOrigin())} apiUrl={apiUrl} router={createBrowserRouter(routes)} />
  </StrictMode>,
)
