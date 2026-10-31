import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Token demo page: `npm run demo -w @shazlo/ui`.
export default defineConfig({
  root: 'demo',
  publicDir: 'public',
  plugins: [react()],
})
