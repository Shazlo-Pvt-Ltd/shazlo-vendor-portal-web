import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// Shazlo One shell. Its CSP lists only the registered module origins in frame-src (ADR 0001 §5).
export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, '.', 'VITE_')
  const moduleUrl = env.VITE_VENDOR_ADMIN_URL ?? (command === 'serve' ? 'http://localhost:5193/' : '')
  if (command === 'build' && mode === 'production' && (!moduleUrl || moduleUrl.includes('*'))) {
    throw new Error('Set VITE_VENDOR_ADMIN_URL to the exact vendor-admin URL for production builds.')
  }
  const moduleOrigin = moduleUrl ? new URL(moduleUrl).origin : ''
  // With VITE_MOCK_API=off the shell calls identity-api on its own origin and Vite forwards /v1 to it, so
  // the HttpOnly refresh cookie (SameSite=Strict, path /v1/auth) is first-party and no CORS preflight is needed.
  // Origin is kept as the browser sent it: identity-api checks it against CORS_ALLOWED_ORIGINS.
  const identityTarget = env.VITE_IDENTITY_PROXY_TARGET ?? 'http://localhost:8001'
  const proxy = { '/v1': { target: identityTarget, changeOrigin: false } }
  const headers = { 'Content-Security-Policy': `frame-src ${moduleOrigin || "'none'"}` }
  return {
    plugins: [react()],
    define: { __VENDOR_ADMIN_URL__: JSON.stringify(moduleUrl) },
    server: { port: 5192, headers, proxy },
    preview: { port: 4192, headers, proxy },
  }
})
