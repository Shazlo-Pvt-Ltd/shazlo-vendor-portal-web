import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { MODULE_ORIGINS } from './src/security/moduleOrigins'
import { PLACEHOLDER_API_ORIGIN, securityHeaders } from './src/security/headers'

/** The API origin from VITE_IDENTITY_API_URL; the local default keeps `npm run dev` working unconfigured. */
function apiOrigin(value: string | undefined, fallback: string): string {
  try {
    return new URL(value ?? '').origin
  } catch {
    return fallback
  }
}

// 5173 is the origin identity-api's CORS_ALLOWED_ORIGINS expects in development, and the one the
// refresh cookie (SameSite=Strict) is happy with next to the API on localhost.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    plugins: [react()],
    build: {
      // Never inline an asset as a data: URI: the policy does not allow data: sources.
      assetsInlineLimit: 0,
    },
    server: {
      port: 5173,
      strictPort: true,
      headers: securityHeaders({
        apiOrigin: apiOrigin(env.VITE_IDENTITY_API_URL, 'http://localhost:8001'),
        moduleOrigins: MODULE_ORIGINS,
        mode: 'development',
      }),
    },
    preview: {
      port: 5173,
      strictPort: true,
      // `vite preview` serves the production build, so it gets the production policy (minus HSTS).
      headers: securityHeaders({
        apiOrigin: apiOrigin(env.VITE_IDENTITY_API_URL, PLACEHOLDER_API_ORIGIN),
        moduleOrigins: MODULE_ORIGINS,
        mode: 'preview',
      }),
    },
  }
})
