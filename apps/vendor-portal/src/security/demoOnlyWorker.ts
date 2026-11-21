import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

/** The script MSW registers as a service worker (public/, from msw's own package). */
export const MOCK_WORKER_FILE = 'mockServiceWorker.js'

/**
 * Keeps the mock API's service worker out of every build but the demo one (VITE_MOCK_API=on).
 * Vite copies public/ into the build as it is; a normal build never registers the worker, and
 * after this it does not ship it either.
 */
export function demoOnlyWorker(demo: boolean): Plugin {
  let outDir = ''
  return {
    name: 'shazlo:demo-only-worker',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    writeBundle() {
      if (!demo) rmSync(resolve(outDir, MOCK_WORKER_FILE), { force: true })
    },
  }
}
