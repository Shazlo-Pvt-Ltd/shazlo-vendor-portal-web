import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// The vendor-admin module only renders inside Shazlo-One. frame-ancestors names the shell origin
// (ADR 0001 §5); production builds fail without an exact VITE_SHELL_ORIGIN.
export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, '.', 'VITE_')
  const shellOrigin = env.VITE_SHELL_ORIGIN ?? (command === 'serve' ? 'http://localhost:5174' : '')
  if (command === 'build' && mode === 'production' && (!shellOrigin || shellOrigin.includes('*'))) {
    throw new Error('Set VITE_SHELL_ORIGIN to the exact Shazlo-One origin for production builds.')
  }
  const headers = { 'Content-Security-Policy': `frame-ancestors ${shellOrigin || "'self'"}`, 'Referrer-Policy': 'no-referrer' }
  return {
    plugins: [react()],
    define: { __SHELL_ORIGIN__: JSON.stringify(shellOrigin) },
    server: { port: 5175, strictPort: true, headers },
    preview: { port: 4175, headers },
  }
})
