import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 5174 is the origin vendor-api's CORS_ALLOWED_ORIGINS expects in development, and the one the
// refresh cookie (SameSite=Strict) is happy with next to the API on localhost.
export default defineConfig({
  plugins: [react()],
  server: { port: 5174, strictPort: true },
  preview: { port: 5174, strictPort: true },
})
