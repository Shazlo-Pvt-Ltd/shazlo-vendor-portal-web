import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Token demo page: `npm run demo -w @shazlo/ui`.
export default defineConfig({
  root: 'demo',
  publicDir: 'public',
  plugins: [react()],
  // Keep every font subset as a real file so the artifact check can verify it is served locally.
  build: { assetsInlineLimit: 0 },
})
