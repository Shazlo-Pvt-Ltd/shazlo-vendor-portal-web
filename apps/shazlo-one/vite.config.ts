import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Shazlo-One shell. frame-src lists only registered module origins (ADR 0001 §5).
export default defineConfig({
  plugins: [react()],
  server: { port: 5174, strictPort: true },
  preview: { port: 4174 },
})
