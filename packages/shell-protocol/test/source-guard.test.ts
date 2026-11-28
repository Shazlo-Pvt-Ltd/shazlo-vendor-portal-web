// @vitest-environment node
import { readdirSync, readFileSync, type Dirent } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const repoRoot = join(packageRoot, '../..')

/**
 * The entries of a folder, or none when it does not exist. The folder is read once, with each entry's
 * type, rather than checked first and read after (a check-then-use race).
 */
function entries(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR') return []
    throw error
  }
}

/** Every non-test TypeScript source file under `dir`, with its text. */
function sources(dir: string): Array<[string, string]> {
  const found: Array<[string, string]> = []
  const walk = (current: string) => {
    for (const entry of entries(current)) {
      const name = entry.name
      if (name === 'node_modules' || name === 'dist') continue
      const path = join(current, name)
      if (entry.isDirectory()) walk(path)
      else if (
        entry.isFile() &&
        /\.(ts|tsx)$/.test(name) &&
        !/\.test\.(ts|tsx)$/.test(name) &&
        // Test harnesses replace postMessage on purpose, like this package's own.
        !path.includes(join('src', 'test'))
      ) {
        found.push([relative(repoRoot, path).replaceAll('\\', '/'), readFileSync(path, 'utf8')])
      }
    }
  }
  walk(dir)
  return found
}

/** Whether code posts to, or listens for, messages from another window. `?.` and `!.` count too. */
function talksAcrossFrames(body: string): boolean {
  return (
    /\b(window|parent|top|opener|self|contentWindow|globalThis)[?!]?\.postMessage\s*\(/.test(body) ||
    /addEventListener\s*\(\s*['"`]message['"`]/.test(body) ||
    /\b(window|self|globalThis)\.onmessage\b/.test(body)
  )
}

/** The code with comments removed, so a sentence that mentions `postMessage` is not mistaken for a call. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('the package', () => {
  const own = sources(join(packageRoot, 'src'))

  it('finds its own source files', () => {
    expect(own.length).toBeGreaterThan(8)
  })

  it('calls postMessage in exactly one place, which refuses "*"', () => {
    const calling = own.filter(([, text]) => /\.postMessage\s*\(/.test(code(text))).map(([path]) => path)
    expect(calling).toEqual(['packages/shell-protocol/src/post.ts'])
  })

  it('never passes "*" to postMessage anywhere', () => {
    for (const [path, text] of own) {
      expect(code(text), path).not.toMatch(/postMessage\s*\([^)]*['"`]\*['"`]/)
    }
  })

  it('has no `targetOrigin` default and no `"*"` fallback', () => {
    for (const [path, text] of own) {
      expect(code(text), path).not.toMatch(/\|\|\s*['"`]\*['"`]/)
      expect(code(text), path).not.toMatch(/\?\?\s*['"`]\*['"`]/)
      expect(code(text), path).not.toMatch(/targetOrigin\s*=\s*['"`]\*['"`]/)
    }
  })

  // The postMessage half (ADR 0001) is hand-written and depends on nothing. The registry, manifest
  // and summary (ADR 0011) are read from build files and over HTTP and use zod; the test helper uses msw.
  const ADR_0011 = ['manifest.ts', 'registry.ts', 'summary.ts']

  it('has no runtime dependency in the postMessage half, and only zod in the registry, manifest and summary', () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as Record<string, Record<string, string>>
    expect(Object.keys(manifest.dependencies ?? {})).toEqual(['zod'])
    expect(Object.keys(manifest.peerDependencies ?? {})).toEqual(['msw'])
    for (const [path, text] of own) {
      const name = path.split('/').pop()!
      const imports = [...text.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]!).filter((specifier) => !specifier.startsWith('.'))
      const allowed = name === 'testing.ts' ? ['msw'] : ADR_0011.includes(name) ? ['zod'] : []
      expect(imports.filter((specifier) => !allowed.includes(specifier)), path).toEqual([])
    }
  })

  it('keeps zod out of every file the postMessage half imports', () => {
    for (const [path, text] of own) {
      const name = path.split('/').pop()!
      if (ADR_0011.includes(name) || name === 'testing.ts' || name === 'index.ts') continue
      const local = [...text.matchAll(/from\s+['"]\.\/([^'"]+)['"]/g)].map((match) => `${match[1]!}.ts`)
      expect(local.filter((file) => ADR_0011.includes(file) || file === 'testing.ts'), path).toEqual([])
    }
  })
})

describe('the apps', () => {
  // Each app's `src`: the shell and every module must go through the package.
  // An app folder with no `src` gives no entries.
  const apps = entries(join(repoRoot, 'apps'))
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => sources(join(repoRoot, 'apps', entry.name, 'src')))

  it('finds the apps’ source files', () => {
    expect(apps.length).toBeGreaterThan(20)
    // The shell's host and the Vendors module's runtime are checked (a vacuous pass otherwise).
    expect(apps.some(([path]) => path === 'apps/shazlo-one/src/shell/ModuleHost.tsx')).toBe(true)
    expect(apps.some(([path]) => path === 'apps/vendor-admin/src/runtime/runtime.tsx')).toBe(true)
    expect(apps.some(([path]) => path.includes('/src/test/'))).toBe(false)
  })

  it('post and read cross-frame messages only through @shazlo/shell-protocol', () => {
    const offenders = apps.filter(([, text]) => talksAcrossFrames(code(text))).map(([path]) => path)
    expect(offenders).toEqual([])
  })

  it.each([
    "window.parent.postMessage(data, '*')",
    'window.top?.postMessage(data, origin)',
    'iframe.contentWindow!.postMessage(data, origin)',
    'frame.contentWindow?.postMessage(data, origin)',
    'parent!.postMessage(data, origin)',
    "window.addEventListener('message', onMessage)",
    'window.onmessage = onMessage',
  ])('the check catches %s', (line) => {
    expect(talksAcrossFrames(line)).toBe(true)
  })

  it('the check leaves a same-origin BroadcastChannel alone', () => {
    expect(talksAcrossFrames("channel.postMessage({ type: 'logout' }); channel.onmessage = onMessage")).toBe(false)
  })
})
