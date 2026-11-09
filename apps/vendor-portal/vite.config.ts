import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// `npm run dev -w @shazlo/vendor-portal`. The mock API (src/mocks) starts unless VITE_MOCK_API=off.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
})
