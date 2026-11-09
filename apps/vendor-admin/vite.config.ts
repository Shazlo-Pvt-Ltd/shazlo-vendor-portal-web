import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// vendor-admin only runs inside Shazlo One: frame-ancestors names the exact shell origin (ADR 0001 §5).
export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, '.', 'VITE_')
  const shellOrigin = env.VITE_SHELL_ORIGIN ?? (command === 'serve' ? 'http://localhost:5192' : '')
  if (command === 'build' && mode === 'production' && (!shellOrigin || shellOrigin.includes('*'))) {
    throw new Error('Set VITE_SHELL_ORIGIN to the exact Shazlo One origin for production builds.')
  }
  const headers = { 'Content-Security-Policy': `frame-ancestors ${shellOrigin || "'none'"}`, 'Referrer-Policy': 'no-referrer' }
  return {
    plugins: [react()],
    define: { __SHELL_ORIGIN__: JSON.stringify(shellOrigin) },
    server: { port: 5193, headers },
    preview: { port: 4193, headers },
  }
})
