import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Plugin } from 'vite'

/** The script MSW registers as its service worker, served at the site's root. */
export const MOCK_WORKER_FILE = 'mockServiceWorker.js'

/** The worker script that ships with the installed msw package (kept in step with msw/browser). */
export function mswWorkerPath(): string {
  return createRequire(import.meta.url).resolve(`msw/${MOCK_WORKER_FILE}`)
}

/**
 * Serves the mock API's service worker only in demo mode (VITE_MOCK_API=on): from the dev server, and
 * as a file in a demo build. The worker is not kept in public/, so a normal build or dev server never
 * has it to serve. It comes straight from the installed msw package.
 */
export function demoOnlyWorker(demo: boolean, workerPath: () => string = mswWorkerPath): Plugin {
  return {
    name: 'shazlo:demo-only-worker',
    configureServer(server) {
      if (!demo) return
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== `/${MOCK_WORKER_FILE}`) return next()
        for (const [name, value] of Object.entries(server.config.server.headers ?? {})) if (value !== undefined) res.setHeader(name, value)
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8')
        res.setHeader('Cache-Control', 'no-cache')
        res.end(readFileSync(workerPath(), 'utf8'))
      })
    },
    generateBundle() {
      if (demo) this.emitFile({ type: 'asset', fileName: MOCK_WORKER_FILE, source: readFileSync(workerPath(), 'utf8') })
    },
  }
}
