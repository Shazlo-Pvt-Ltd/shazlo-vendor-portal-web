import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import { readEnv } from './src/config/env'
import { securityHeaders } from './src/security/headers'

// vendor-admin only runs inside Shazlo One: frame-ancestors names the exact shell origin (ADR 0001 §5),
// and the protocol client talks to that origin only. The settings (src/config/env.ts) are checked here:
// a production build needs VITE_SHELL_ORIGIN and VITE_VENDOR_API_URL as exact https origins with plain
// hosts, and fails with every problem listed otherwise. One policy for dev, preview and production
// (src/security/headers.ts; vercel.json is written from it).
export default defineConfig(({ mode, command, isPreview }) => {
  const raw = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_')
  const settings = readEnv(raw, { dev: command === 'serve' && !isPreview })
  if (!settings.ok) throw new Error(`The Vendors module is not set up correctly:\n- ${settings.problems.join('\n- ')}`)
  const { shellOrigin, apiOrigin } = settings.env
  return {
    plugins: [react()],
    define: { __SHELL_ORIGIN__: JSON.stringify(shellOrigin), __VENDOR_API_ORIGIN__: JSON.stringify(apiOrigin) },
    build: {
      // Never inline an asset as a data: URI: the production policy allows none.
      assetsInlineLimit: 0,
    },
    server: { port: 5193, strictPort: true, headers: securityHeaders({ mode: 'development', shellOrigin, apiOrigin, devOrigin: 'http://localhost:5193' }) },
    preview: { port: 4193, strictPort: true, headers: securityHeaders({ mode: 'preview', shellOrigin, apiOrigin }) },
  }
})
