import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { dirname, relative, resolve } from 'node:path'
import process from 'node:process'

// Check the shipped artifact, where a valid CSS import can still declare the wrong family.
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(packageRoot, 'demo/dist')
const design = JSON.parse(readFileSync(resolve(packageRoot, 'docs/penpot-design.json'), 'utf8'))
const cssFiles = readdirSync(resolve(output, 'assets')).filter(name => name.endsWith('.css'))
assert(cssFiles.length > 0, 'The demo must ship its font stylesheet')
const css = cssFiles.map(name => readFileSync(resolve(output, 'assets', name), 'utf8')).join('\n')
const faces = [...css.matchAll(/@font-face\s*\{([^}]+)\}/g)].map(match => match[1])
for (const [family, weight] of [
  [design.fonts.heading, '400'], [design.fonts.heading, '600'],
  [design.fonts.formalBody, '400'], [design.fonts.informalBody, '400'],
]) {
  assert(faces.some(face => {
    const name = /font-family:\s*([^;]+)/.exec(face)?.[1]?.replaceAll(/["']/g, '').trim()
    return name === family && /font-weight:\s*([^;]+)/.exec(face)?.[1]?.trim() === weight
  }), `Missing bundled font face: ${family} ${weight}`)
}
assert(!css.includes('Voyage'), 'The default demo must not ship commercial Voyage assets')
for (const match of css.matchAll(/url\(([^)]+)\)/g)) {
  const asset = new URL(match[1].replaceAll(/["']/g, '').trim(), 'https://demo.invalid/assets/style.css')
  assert.equal(asset.origin, 'https://demo.invalid', 'Fonts must be served locally')
  const path = resolve(output, `.${decodeURIComponent(asset.pathname)}`)
  assert(!relative(output, path).startsWith('..'), 'Asset paths must stay inside the demo')
  assert(existsSync(path), `Missing demo asset: ${asset.pathname}`)
}
for (const name of ['bodoni-moda', 'ovo', 'schoolbell']) {
  assert(readFileSync(resolve(output, 'font-licenses', `${name}.txt`), 'utf8').length > 1000, `Missing ${name} license`)
}
process.stdout.write('Demo artifact: all font families/weights, local assets and licenses verified\n')
