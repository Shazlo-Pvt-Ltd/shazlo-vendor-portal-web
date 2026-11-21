import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { demoOnlyWorker } from './src/security/demoOnlyWorker'
import { securityHeaders, PLACEHOLDER_API_ORIGIN } from './src/security/headers'

/** The API origin from VITE_VENDOR_API_URL; the local default keeps `npm run dev` working unconfigured. */
function apiOrigin(value: string | undefined, fallback: string): string {
  try {
    return new URL(value ?? '').origin
  } catch {
    return fallback
  }
}

// 5174 is the origin vendor-api's CORS_ALLOWED_ORIGINS expects in development, and the one the
// refresh cookie (SameSite=Strict) is happy with next to the API on localhost.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  // Demo mode: the mock API runs in a service worker (src/mocks). See .env.example.
  const demo = env.VITE_MOCK_API === 'on'
  return {
    plugins: [react(), demoOnlyWorker(demo)],
    build: {
      // Never inline an asset as a data: URI: the policy does not allow data: sources.
      assetsInlineLimit: 0,
    },
    server: {
      port: 5174,
      strictPort: true,
      headers: securityHeaders({ apiOrigin: apiOrigin(env.VITE_VENDOR_API_URL, 'http://localhost:8002'), mode: 'development', demo }),
    },
    preview: {
      port: 5174,
      strictPort: true,
      // `vite preview` serves the production build, so it gets the production policy (minus HSTS).
      headers: securityHeaders({ apiOrigin: apiOrigin(env.VITE_VENDOR_API_URL, PLACEHOLDER_API_ORIGIN), mode: 'preview', demo }),
    },
  }
})
