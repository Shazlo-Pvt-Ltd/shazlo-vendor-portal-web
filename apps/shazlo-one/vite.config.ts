import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { PLACEHOLDER_API_ORIGIN, securityHeaders } from './src/security/headers'
import { environmentOf, modulesFor, originsOf } from './src/modules/registry'

/** The API origin from VITE_IDENTITY_API_URL; the local default keeps `npm run dev` working unconfigured. */
function apiOrigin(value: string | undefined, fallback: string): string {
  try {
    return new URL(value ?? '').origin
  } catch {
    return fallback
  }
}

// 5173 is the origin identity-api's CORS_ALLOWED_ORIGINS expects in development (the refresh
// cookie is SameSite=Strict, which is happy with the API next to it on localhost).
export default defineConfig(({ mode, command, isPreview }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  // Which module registry this run uses. A broken registry stops the build or the dev server here,
  // with a message that says what to fix; the page checks the same registry again when it starts.
  const target = env.VITE_DEPLOY_ENV || process.env.VERCEL_ENV || undefined
  const environment = environmentOf({ dev: command === 'serve' && !isPreview, target })
  const moduleOrigins = originsOf(modulesFor(environment))
  return {
    plugins: [react()],
    // The page reads which registry to use from here, so it matches the build's.
    define: { 'import.meta.env.VITE_DEPLOY_ENV': JSON.stringify(target ?? '') },
    build: {
      // Never inline an asset as a data: URI: the policy does not allow data: sources.
      assetsInlineLimit: 0,
    },
    server: {
      port: 5173,
      strictPort: true,
      headers: securityHeaders({
        apiOrigin: apiOrigin(env.VITE_IDENTITY_API_URL, 'http://localhost:8001'),
        moduleOrigins,
        mode: 'development',
      }),
    },
    preview: {
      port: 5173,
      strictPort: true,
      // `vite preview` serves the production build, so it gets the production policy (minus HSTS).
      headers: securityHeaders({
        apiOrigin: apiOrigin(env.VITE_IDENTITY_API_URL, PLACEHOLDER_API_ORIGIN),
        moduleOrigins,
        mode: 'preview',
      }),
    },
  }
})
