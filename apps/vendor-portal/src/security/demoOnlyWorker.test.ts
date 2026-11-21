import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { demoOnlyWorker, MOCK_WORKER_FILE } from './demoOnlyWorker'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A finished build: the public folder (and so the worker script) already copied into dist. */
function builtApp() {
  const root = mkdtempSync(join(tmpdir(), 'portal-build-'))
  dirs.push(root)
  mkdirSync(join(root, 'dist'))
  writeFileSync(join(root, 'dist', MOCK_WORKER_FILE), '// worker')
  writeFileSync(join(root, 'dist', 'manifest.webmanifest'), '{}')
  return root
}

function runPlugin(root: string, demo: boolean) {
  const plugin = demoOnlyWorker(demo)
  ;(plugin.configResolved as (config: unknown) => void)({ root, build: { outDir: 'dist' } })
  ;(plugin.writeBundle as () => void)()
}

describe('the mock service worker in a build', () => {
  it('is left out of a normal build, which never registers it', () => {
    const root = builtApp()
    runPlugin(root, false)
    expect(existsSync(join(root, 'dist', MOCK_WORKER_FILE))).toBe(false)
    expect(existsSync(join(root, 'dist', 'manifest.webmanifest'))).toBe(true)
  })

  it('stays in a demo build (VITE_MOCK_API=on)', () => {
    const root = builtApp()
    runPlugin(root, true)
    expect(existsSync(join(root, 'dist', MOCK_WORKER_FILE))).toBe(true)
  })

  it('applies to builds only, not the dev server', () => {
    expect(demoOnlyWorker(false).apply).toBe('build')
  })
})
