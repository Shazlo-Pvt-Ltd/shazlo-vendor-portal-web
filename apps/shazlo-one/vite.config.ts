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
  const headers = { 'Content-Security-Policy': `frame-src ${moduleOrigin || "'none'"}` }
  return {
    plugins: [react()],
    define: { __VENDOR_ADMIN_URL__: JSON.stringify(moduleUrl) },
    server: { port: 5192, headers },
    preview: { port: 4192, headers },
  }
})
