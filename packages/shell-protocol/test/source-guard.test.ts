// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const repoRoot = join(packageRoot, '../..')

/** Every non-test TypeScript source file under `dir`, with its text. */
function sources(dir: string): Array<[string, string]> {
  const found: Array<[string, string]> = []
  const walk = (current: string) => {
    for (const name of readdirSync(current)) {
      if (name === 'node_modules' || name === 'dist') continue
      const path = join(current, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !path.includes(`${join('src', 'test')}`)) {
        found.push([relative(repoRoot, path).replaceAll('\\', '/'), readFileSync(path, 'utf8')])
      }
    }
  }
  walk(dir)
  return found
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

  it('has no runtime dependency', () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as Record<string, unknown>
    expect(manifest.dependencies).toBeUndefined()
    expect(manifest.peerDependencies).toBeUndefined()
    for (const [path, text] of own) {
      const imports = [...text.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]!)
      expect(
        imports.filter((specifier) => !specifier.startsWith('.')),
        path,
      ).toEqual([])
    }
  })
})

describe('the apps', () => {
  const apps = readdirSync(join(repoRoot, 'apps'))
    .filter((name) => existsSync(join(repoRoot, 'apps', name, 'src')))
    .flatMap((name) => sources(join(repoRoot, 'apps', name, 'src')))

  it('finds the apps’ source files', () => {
    expect(apps.length).toBeGreaterThan(20)
  })

  it('post and read cross-frame messages only through @shazlo/shell-protocol', () => {
    const offenders = apps
      .filter(([, text]) => {
        const body = code(text)
        return (
          /\b(window|parent|top|opener|self|contentWindow|globalThis)\??\.postMessage\s*\(/.test(body) ||
          /\.contentWindow\??\.postMessage/.test(body) ||
          /addEventListener\s*\(\s*['"`]message['"`]/.test(body) ||
          /\b(window|self|globalThis)\.onmessage\b/.test(body)
        )
      })
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })
})
