import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
// Relative to the source: the config is bundled for Node, which would not load the package's TypeScript.
import { parseRegistry, registryCsp, type RegistryMode } from '../../packages/shell-protocol/src/registry'

// ADR 0011: the module registry is a JSON file per environment, built into the shell and checked here
// (a bad registry fails the build with every problem listed) and again when the shell starts.
// VITE_SHELL_REGISTRY names the file. Without it, `vite` uses registry/mock.json while identity-api is
// mocked (summaries from the mock vendor-api on :5194) and registry/development.json with
// VITE_MOCK_API=off (the real vendor-api admin app on :8004). A production build must name a file with
// exact https URLs.
export default defineConfig(({ mode, command, isPreview }) => {
  const env = loadEnv(mode, '.', 'VITE_')
  const production = command === 'build' && mode === 'production'
  const file = env.VITE_SHELL_REGISTRY ?? (production ? null : env.VITE_MOCK_API === 'off' ? 'registry/development.json' : 'registry/mock.json')
  if (!file) throw new Error('Set VITE_SHELL_REGISTRY to the production module registry (exact https URLs) for production builds.')
  const registryMode: RegistryMode = production ? 'production' : mode === 'preview' ? 'preview' : 'development'
  const raw: unknown = JSON.parse(readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8'))
  const modules = parseRegistry(raw, registryMode)

  // Only the registered modules may be framed, and only they, their summaries and identity-api may be
  // called (ADR 0001 §5). Nothing may frame the shell. Vite's dev server also needs its HMR socket.
  const csp = registryCsp(modules)
  const identityOrigin = env.VITE_IDENTITY_API_URL ? [new URL(env.VITE_IDENTITY_API_URL).origin] : []
  const hmr = command === 'serve' && !isPreview ? ['ws://localhost:5192'] : []
  const policy = [
    `frame-src ${csp.frameSrc.join(' ') || "'none'"}`,
    `connect-src ${["'self'", ...identityOrigin, ...csp.connectSrc, ...hmr].join(' ')}`,
    "frame-ancestors 'none'",
  ].join('; ')

  // With VITE_MOCK_API=off the shell calls identity-api on its own origin and Vite forwards /v1 to it, so
  // the HttpOnly refresh cookie (SameSite=Strict, path /v1/auth) is first-party and no CORS preflight is needed.
  // Origin is kept as the browser sent it: identity-api checks it against CORS_ALLOWED_ORIGINS.
  const identityTarget = env.VITE_IDENTITY_PROXY_TARGET ?? 'http://localhost:8001'
  const proxy = { '/v1': { target: identityTarget, changeOrigin: false } }
  const headers = { 'Content-Security-Policy': policy }
  return {
    plugins: [react()],
    define: { __SHELL_REGISTRY__: JSON.stringify(raw), __SHELL_REGISTRY_MODE__: JSON.stringify(registryMode) },
    server: { port: 5192, headers, proxy },
    preview: { port: 4192, headers, proxy },
  }
})
