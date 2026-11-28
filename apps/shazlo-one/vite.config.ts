import react from '@vitejs/plugin-react'
import { readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv, type Plugin } from 'vite'
// Relative to the source: the config is bundled for Node, which would not load the package's TypeScript.
import { parseRegistry, registryCsp, type RegistryMode } from '../../packages/shell-protocol/src/registry'
import { readEnv } from './src/config/env'
import { demoOnlyWorker } from './src/security/demoOnlyWorker'
import { securityHeaders } from './src/security/headers'

const DEV_ORIGIN = 'http://localhost:5192'

// Without the browser mock, its service worker has no business in the build output. demoOnlyWorker
// only adds it with the mock on; this makes sure nothing else (a file in public/) ships it either.
function dropMockWorker(outDir: () => string): Plugin {
  return {
    name: 'shazlo-one:drop-mock-worker',
    apply: 'build',
    closeBundle() {
      rmSync(join(outDir(), 'mockServiceWorker.js'), { force: true })
    },
  }
}

// The settings (src/config/env.ts) are checked here first: a production build with the mock on by
// accident, an http or malformed identity-api origin, or no origin at all fails with every problem
// listed. The page checks them again when it starts.
//
// ADR 0011: the module registry is a JSON file per environment, built into the shell and checked here
// (a bad registry fails the build with every problem listed) and again when the shell starts.
// VITE_SHELL_REGISTRY names the file. Without it, `vite` uses registry/mock.json while identity-api is
// mocked (summaries from the mock vendor-api on :5194) and registry/development.json with
// VITE_MOCK_API=off (the real vendor-api admin app on :8004). A production build must name a file with
// exact https URLs.
export default defineConfig(({ mode, command, isPreview }) => {
  // The app's own folder, wherever the command runs from (the workspace root runs the tests).
  const raw = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_')
  const serving = command === 'serve' && !isPreview
  const settings = readEnv(raw, { dev: serving })
  if (!settings.ok) throw new Error(`Shazlo One is not set up correctly:\n- ${settings.problems.join('\n- ')}`)
  const { identityOrigin, mock } = settings.env

  const production = command === 'build' && mode === 'production'
  const file = raw.VITE_SHELL_REGISTRY ?? (production ? null : mock ? 'registry/mock.json' : 'registry/development.json')
  if (!file) throw new Error('Set VITE_SHELL_REGISTRY to the production module registry (exact https URLs) for production builds.')
  const registryMode: RegistryMode = production ? 'production' : mode === 'preview' ? 'preview' : 'development'
  const registry: unknown = JSON.parse(readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8'))
  const csp = registryCsp(parseRegistry(registry, registryMode))

  // One policy for dev, preview and production (src/security/headers.ts; vercel.json is written from it).
  const headers = (headerMode: 'development' | 'preview') =>
    securityHeaders({ mode: headerMode, identityOrigin, frameOrigins: csp.frameSrc, moduleConnectOrigins: headerMode === 'development' ? [...csp.connectSrc, DEV_ORIGIN] : csp.connectSrc, devOrigin: DEV_ORIGIN, mockWorker: mock })

  // Without VITE_IDENTITY_API_URL the shell calls identity-api on its own origin and Vite forwards /v1 to
  // it, so the HttpOnly refresh cookie (SameSite=Strict, path /v1/auth) is first-party and no CORS
  // preflight is needed. Origin is kept as the browser sent it: identity-api checks it against
  // CORS_ALLOWED_ORIGINS.
  const identityTarget = raw.VITE_IDENTITY_PROXY_TARGET ?? 'http://localhost:8001'
  const proxy = { '/v1': { target: identityTarget, changeOrigin: false } }
  let outDir = 'dist'
  return {
    plugins: [react(), demoOnlyWorker(mock), ...(mock ? [] : [dropMockWorker(() => outDir)]), { name: 'shazlo-one:out-dir', configResolved: (config) => void (outDir = resolve(config.root, config.build.outDir)) }],
    // __MOCK_API__ is a constant, so a build without the mock drops its import, its handlers and the
    // demo passwords entirely (src/main.tsx).
    define: { __SHELL_REGISTRY__: JSON.stringify(registry), __SHELL_REGISTRY_MODE__: JSON.stringify(registryMode), __MOCK_API__: JSON.stringify(mock) },
    build: {
      // Never inline an asset as a data: URI: the policy allows images and fonts from the shell only.
      assetsInlineLimit: 0,
    },
    server: { port: 5192, strictPort: true, headers: headers('development'), proxy },
    preview: { port: 4192, strictPort: true, headers: headers('preview'), proxy },
  }
})
