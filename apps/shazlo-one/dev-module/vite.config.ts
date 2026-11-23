import react from '@vitejs/plugin-react'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import { MODULE_DEV_PORT, readModuleConfig } from './config'
import { moduleHeaders } from './headers'

const root = dirname(fileURLToPath(import.meta.url))

/**
 * The reference module's dev server, on its own port and so its own origin. It exists for
 * development and the shell's tests and is never built or deployed: asking for a build fails, so
 * it cannot end up in a pipeline by accident.
 */
export default defineConfig(({ command, mode }) => {
  if (command === 'build') {
    throw new Error('The reference module is for development only and is never built or deployed.')
  }
  const env = loadEnv(mode, root, 'VITE_')
  const result = readModuleConfig(env, { development: true })
  if (!result.ok) {
    throw new Error(`The reference module is misconfigured:\n- ${result.problems.join('\n- ')}`)
  }
  return {
    root,
    plugins: [react()],
    // Keep the shell's own .env files out: this module reads only its own settings.
    envDir: root,
    server: {
      port: MODULE_DEV_PORT,
      strictPort: true,
      headers: moduleHeaders({ shellOrigin: result.config.shellOrigin, development: true }),
    },
  }
})
