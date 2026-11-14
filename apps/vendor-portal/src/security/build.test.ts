// @vitest-environment node
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { describe, expect, it } from 'vitest'

type Built = Exclude<Awaited<ReturnType<typeof build>>, { close: unknown } | unknown[]>
type Item = Built['output'][number]
type Asset = Extract<Item, { type: 'asset' }>
type Chunk = Extract<Item, { type: 'chunk' }>

const root = fileURLToPath(new URL('../../', import.meta.url))

describe('the production build', () => {
  it('has no inline script, no inline handler, no javascript: URL and no data: asset', async () => {
    const result = (await build({
      root,
      configFile: `${root}vite.config.ts`,
      logLevel: 'silent',
      build: { write: false, outDir: 'dist-test' },
    })) as unknown as Built | Built[]
    const output = (Array.isArray(result) ? result[0]! : result).output
    const page = output.find((item): item is Asset => item.type === 'asset' && item.fileName === 'index.html')
    expect(page).toBeDefined()
    const html = String(page!.source)

    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    expect(scripts.length).toBeGreaterThan(0)
    for (const [, attributes, body] of scripts) {
      expect(attributes).toMatch(/\bsrc="/)
      expect(body!.trim()).toBe('')
    }
    expect(html).not.toMatch(/\son[a-z]+\s*=/i)
    expect(html).not.toMatch(/javascript:/i)

    const css = output.filter((item): item is Asset => item.type === 'asset' && item.fileName.endsWith('.css'))
    for (const sheet of css) {
      expect(String(sheet.source)).not.toMatch(/url\(\s*["']?data:/i)
    }
    const code = output.filter((item): item is Chunk => item.type === 'chunk')
    expect(code.length).toBeGreaterThan(0)
  }, 180_000)
})
