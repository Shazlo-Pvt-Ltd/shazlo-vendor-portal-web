// @vitest-environment node
import { fileURLToPath } from 'node:url'
import { parse, type DefaultTreeAdapterMap } from 'parse5'
import { build } from 'vite'
import { describe, expect, it } from 'vitest'

type Built = Exclude<Awaited<ReturnType<typeof build>>, { close: unknown } | unknown[]>
type Item = Built['output'][number]
type Asset = Extract<Item, { type: 'asset' }>
type Chunk = Extract<Item, { type: 'chunk' }>
type Node = DefaultTreeAdapterMap['node']
type Element = DefaultTreeAdapterMap['element']

const root = fileURLToPath(new URL('../../', import.meta.url))

/** Every element of a page, parsed the way a browser parses it (the content of a `<template>` too). */
function elementsOf(html: string): Element[] {
  const elements: Element[] = []
  const visit = (node: Node): void => {
    if ('tagName' in node) elements.push(node)
    if ('content' in node) visit(node.content)
    if ('childNodes' in node) node.childNodes.forEach(visit)
  }
  visit(parse(html))
  return elements
}

const scriptsOf = (html: string) => elementsOf(html).filter((element) => element.tagName === 'script')

/**
 * What a page could run without loading a file: a `<script>` that has no `src` or has a body, an
 * inline event handler (`onclick=...`) and a `javascript:` URL. The markup is parsed, not matched
 * with a regular expression, so `</script >`, upper-case tags, odd spacing and comments cannot hide
 * anything from the check.
 */
function inlineCode(html: string): string[] {
  const found: string[] = []
  for (const element of elementsOf(html)) {
    for (const { name, value } of element.attrs) {
      if (name.startsWith('on')) found.push(`<${element.tagName} ${name}>`)
      if (/^\s*javascript:/i.test(value)) found.push(`<${element.tagName} ${name}="javascript:...">`)
    }
    if (element.tagName === 'script') {
      const body = element.childNodes.map((child) => ('value' in child ? child.value : '')).join('')
      if (!element.attrs.some(({ name }) => name === 'src') || body.trim() !== '') found.push('<script> with no src or with a body')
    }
  }
  return found
}

const page = (markup: string) => `<!doctype html><html><head></head><body>${markup}</body></html>`

describe('the check for inline code', () => {
  it('accepts a page whose only script is a module loaded by address', () => {
    const html = page('<script type="module" src="/a.js"></script>')
    expect(scriptsOf(html)).toHaveLength(1)
    expect(inlineCode(html)).toEqual([])
  })

  it.each([
    ['an inline script', '<script>alert(1)</script>'],
    ['an end tag with a space', '<script >alert(1)</script >'],
    ['an end tag with an attribute', '<script>alert(1)</script foo="bar">'],
    ['upper-case tags', '<SCRIPT>alert(1)</SCRIPT>'],
    ['a script with an address and a body', '<script src="/a.js">alert(1)</script>'],
    ['a script inside a template', '<template><script>alert(1)</script></template>'],
    ['an inline handler', '<img src="/a.png" onerror="alert(1)">'],
    ['an upper-case inline handler', '<div ONCLICK="alert(1)"></div>'],
    ['a javascript: link', '<a href=" JavaScript:alert(1)">x</a>'],
  ])('finds %s', (_name, markup) => {
    expect(inlineCode(page(markup))).not.toEqual([])
  })
})

describe('the production build', () => {
  it('has no inline script, no inline handler, no javascript: URL and no data: asset', async () => {
    const result = (await build({
      root,
      configFile: `${root}vite.config.ts`,
      logLevel: 'silent',
      build: { write: false, outDir: 'dist-test' },
    })) as unknown as Built | Built[]
    const output = (Array.isArray(result) ? result[0]! : result).output
    const index = output.find((item): item is Asset => item.type === 'asset' && item.fileName === 'index.html')
    expect(index).toBeDefined()
    const html = String(index!.source)

    expect(scriptsOf(html).length).toBeGreaterThan(0)
    expect(inlineCode(html)).toEqual([])

    const css = output.filter((item): item is Asset => item.type === 'asset' && item.fileName.endsWith('.css'))
    for (const sheet of css) {
      expect(String(sheet.source)).not.toMatch(/url\(\s*["']?data:/i)
    }
    const code = output.filter((item): item is Chunk => item.type === 'chunk')
    expect(code.length).toBeGreaterThan(0)
  }, 180_000)
})
