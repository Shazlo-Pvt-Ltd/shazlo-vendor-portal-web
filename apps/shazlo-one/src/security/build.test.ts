// @vitest-environment node
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { afterAll, describe, expect, it, vi } from 'vitest'

// Real production builds of the shell (`vite build`), checked file by file. Slow: a few builds.
vi.setConfig({ testTimeout: 300_000 })

const root = fileURLToPath(new URL('../../', import.meta.url))
const outDirs: string[] = []
afterAll(() => {
  for (const dir of outDirs) rmSync(dir, { recursive: true, force: true })
})

/** Builds with these settings into a temporary folder and returns every file's text by path. */
async function buildWith(settings: Record<string, string | undefined>): Promise<Map<string, string>> {
  // As `npm run build` runs it: vitest's own NODE_ENV=test would make it a development bundle.
  const env = { ...settings, NODE_ENV: 'production' }
  const saved = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]))
  Object.assign(process.env, env)
  for (const [key, value] of Object.entries(env)) if (value === undefined) delete process.env[key]
  const outDir = mkdtempSync(join(tmpdir(), 'shazlo-one-build-'))
  outDirs.push(outDir)
  try {
    await build({ root, configFile: join(root, 'vite.config.ts'), mode: 'production', logLevel: 'silent', build: { outDir, emptyOutDir: true } })
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
  const files = new Map<string, string>()
  const walk = (dir: string) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, name.name)
      if (name.isDirectory()) walk(path)
      else files.set(path.slice(outDir.length + 1).replaceAll('\\', '/'), /\.(png|woff2?|ttf|ico)$/.test(name.name) ? '' : readFileSync(path, 'utf8'))
    }
  }
  walk(outDir)
  return files
}

/**
 * Every `<script>` element of a page: its start tag and the text it holds. A small scan rather than a
 * regular expression: browsers end a script at `</script` followed by whitespace, `/` or `>`, and accept
 * anything up to the next `>` (`</script\t\n bar>`), which a pattern for the end tag easily misses. A
 * script with no end tag holds the rest of the page; a start tag with no `>` is the rest of the page.
 */
function scriptElements(html: string): Array<{ tag: string; body: string }> {
  const lower = html.toLowerCase()
  const isBoundary = (char: string | undefined) => char === undefined || char === '/' || char === '>' || char.trim() === ''
  const found: Array<{ tag: string; body: string }> = []
  let at = 0
  for (;;) {
    const start = lower.indexOf('<script', at)
    if (start === -1) return found
    if (!isBoundary(lower[start + 7])) {
      at = start + 7
      continue
    }
    const tagEnd = lower.indexOf('>', start)
    if (tagEnd === -1) {
      found.push({ tag: html.slice(start), body: html.slice(start) })
      return found
    }
    let close = lower.indexOf('</script', tagEnd)
    while (close !== -1 && !isBoundary(lower[close + 8])) close = lower.indexOf('</script', close + 8)
    if (close === -1) {
      found.push({ tag: html.slice(start, tagEnd + 1), body: html.slice(tagEnd + 1) })
      return found
    }
    found.push({ tag: html.slice(start, tagEnd + 1), body: html.slice(tagEnd + 1, close) })
    at = close + 8
  }
}

describe('the script scan the build checks use', () => {
  it('finds external and inline scripts, whatever the end tag looks like', () => {
    expect(scriptElements('<script type="module" src="/a.js"></script>')).toEqual([{ tag: '<script type="module" src="/a.js">', body: '' }])
    expect(scriptElements('<SCRIPT>alert(1)</script\t\n bar>')).toEqual([{ tag: '<SCRIPT>', body: 'alert(1)' }])
    expect(scriptElements('<script>a()</scriptx>b()</script >')).toEqual([{ tag: '<script>', body: 'a()</scriptx>b()' }])
    expect(scriptElements('<script src="/a.js"></script><script\n>x()</script>')).toEqual([
      { tag: '<script src="/a.js">', body: '' },
      { tag: '<script\n>', body: 'x()' },
    ])
  })

  it('treats an unclosed script as holding the rest of the page, and skips look-alike tags', () => {
    expect(scriptElements('<script>x()')).toEqual([{ tag: '<script>', body: 'x()' }])
    expect(scriptElements('<script src="/a.js"')[0]!.body).not.toBe('')
    expect(scriptElements('<scripts></scripts>')).toEqual([])
  })
})

const PRODUCTION = { VITE_IDENTITY_API_URL: 'https://identity.example.com', VITE_SHELL_REGISTRY: 'registry/example.production.json', VITE_MOCK_API: undefined }
// What only the browser mock carries: the demo accounts' passwords, MSW and its service worker.
const MOCK_MARKERS = [/shazlo-one-2026/, /welcome-sneha-01/, /mockServiceWorker/, /setupWorker/, /\bmsw\b/i, /shazloOneResetDemo/]

describe('a production build', () => {
  let files: Map<string, string>

  it('builds with the production settings', async () => {
    files = await buildWith(PRODUCTION)
    expect(files.has('index.html')).toBe(true)
  })

  it('ships no mock, no demo password and no mock service worker', () => {
    expect(files.has('mockServiceWorker.js')).toBe(false)
    for (const [path, text] of files) for (const marker of MOCK_MARKERS) expect(marker.test(text), `${path} matches ${marker}`).toBe(false)
  })

  it('has no inline script, no inline handler and no javascript: URL in its page', () => {
    const html = files.get('index.html')!
    const scripts = scriptElements(html)
    expect(scripts.length).toBeGreaterThan(0)
    for (const { tag, body } of scripts) {
      expect(tag).toMatch(/\ssrc=/i)
      expect(body.trim()).toBe('')
    }
    expect(html).not.toMatch(/\son[a-z]+\s*=/i)
    expect(html).not.toMatch(/javascript:/i)
  })

  it('inlines no asset as a data: URI, which the policy would block', () => {
    for (const [path, text] of files) if (path.endsWith('.css')) expect(text, path).not.toMatch(/url\(\s*["']?data:/i)
  })

  it('builds the registry it was given into the bundle, and nothing from development', () => {
    const code = [...files.entries()].filter(([path]) => path.endsWith('.js')).map(([, text]) => text).join('\n')
    expect(code).toContain('https://vendor-admin.example.com/')
    expect(code).not.toContain('http://localhost:5193')
  })
})

describe('a demo build', () => {
  it('carries the mock and its worker only when asked for by name (VITE_MOCK_API=on)', async () => {
    const files = await buildWith({ ...PRODUCTION, VITE_IDENTITY_API_URL: undefined, VITE_MOCK_API: 'on' })
    expect(files.has('mockServiceWorker.js')).toBe(true)
    const code = [...files.values()].join('\n')
    expect(code).toMatch(/setupWorker|shazloOneResetDemo/)
    // Even the demo writes no mock token to storage: that is for the dev server only.
    expect(code).not.toContain('shazlo.one.mock-identity.v1')
  })
})

describe('a production build that is not set up', () => {
  it.each([
    ['without identity-api’s origin', { ...PRODUCTION, VITE_IDENTITY_API_URL: undefined }, /VITE_IDENTITY_API_URL is not set/],
    ['with an http origin', { ...PRODUCTION, VITE_IDENTITY_API_URL: 'http://identity.example.com' }, /must use https/],
    ['with a host that could inject a CSP directive', { ...PRODUCTION, VITE_IDENTITY_API_URL: 'https://identity.example.com;script-src' }, /letters, digits, dots and hyphens/],
    ['with an unknown mock setting', { ...PRODUCTION, VITE_MOCK_API: 'true' }, /VITE_MOCK_API must be/],
    ['without a registry', { ...PRODUCTION, VITE_SHELL_REGISTRY: undefined }, /VITE_SHELL_REGISTRY/],
    ['with the development registry (plain http)', { ...PRODUCTION, VITE_SHELL_REGISTRY: 'registry/development.json' }, /must be https outside development/],
  ])('fails %s', async (_name, env, message) => {
    await expect(buildWith(env)).rejects.toThrow(message)
  })

  it('wrote nothing', () => {
    expect(existsSync(join(root, 'dist', 'mockServiceWorker.js'))).toBe(false)
  })
})
