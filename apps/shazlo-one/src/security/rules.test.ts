// @vitest-environment node
import { ESLint } from 'eslint'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

// The shell holds an admin's identity-api token and every module token. These checks keep the ways
// they leak (web storage, a log line, HTML built from a string) out of its source.

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
// The first lint call loads the whole ESLint config, which is slow on some disks.
vi.setConfig({ testTimeout: 90_000 })
const eslint = new ESLint({ cwd: repoRoot })

async function messagesFor(code: string, name = 'x.tsx') {
  const [result] = await eslint.lintText(code, { filePath: `${repoRoot}apps/shazlo-one/src/${name}` })
  return result!.messages
}

describe('the lint rules', () => {
  it.each([
    ['localStorage.setItem("token", t)', 'no-restricted-globals'],
    ['sessionStorage.getItem("token")', 'no-restricted-globals'],
    ['window.localStorage.setItem("a", b)', 'no-restricted-properties'],
    ['globalThis.indexedDB.open("x")', 'no-restricted-properties'],
    ['indexedDB.open("x")', 'no-restricted-globals'],
    ['console.log(token)', 'no-console'],
    ['console.warn(token)', 'no-console'],
    ['document.body.innerHTML = html', 'no-restricted-syntax'],
    ['el.outerHTML = html', 'no-restricted-syntax'],
    ['el.insertAdjacentHTML("beforeend", html)', 'no-restricted-syntax'],
    ['eval("1")', 'no-eval'],
    ['new Function("return 1")', 'no-new-func'],
  ])('forbid %s', async (code, rule) => {
    const messages = await messagesFor(`export const f = (t: string, b: string, html: string, el: HTMLElement, token: string) => { ${code} }\n`)
    expect(messages.map((m) => m.ruleId)).toContain(rule)
  })

  it('forbid dangerouslySetInnerHTML', async () => {
    const messages = await messagesFor('export const A = ({ html }: { html: string }) => <div dangerouslySetInnerHTML={{ __html: html }} />\n')
    expect(messages.map((m) => m.ruleId)).toContain('no-restricted-syntax')
  })

  it('still allow console.error, which the route error page uses in development', async () => {
    expect(await messagesFor('export const f = (e: unknown) => { console.error(e) }\n')).toEqual([])
  })

  it('do not apply to tests, which read storage to prove nothing is written', async () => {
    expect(await messagesFor('export const f = () => localStorage.length\n', 'thing.test.ts')).toEqual([])
  })
})

describe('the source files', () => {
  const files = import.meta.glob<string>(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}', '!../test/**'], { query: '?raw', import: 'default', eager: true })
  // The browser mock's own state on the dev server, the one exception (see its header).
  const STORAGE_EXCEPTION = '../mocks/browser.ts'

  it('finds the files it is meant to check', () => {
    expect(Object.keys(files).length).toBeGreaterThan(40)
    expect(files[STORAGE_EXCEPTION]).toBeDefined()
  })

  it('touch no web storage', () => {
    const offenders = Object.entries(files)
      .filter(([path, text]) => path !== STORAGE_EXCEPTION && /\b(localStorage|sessionStorage|indexedDB)\b/.test(text))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })

  it('build no HTML from strings', () => {
    const offenders = Object.entries(files)
      .filter(([, text]) => /dangerouslySetInnerHTML|\.(inner|outer)HTML\s*=|insertAdjacentHTML|document\.write/.test(text))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })

  it('log nothing but errors, and never a token or a password', () => {
    const offenders = Object.entries(files)
      .filter(([, text]) => /console\.(log|info|warn|debug|trace)\(/.test(text) || /console\.\w+\([^)]*(token|password)/i.test(text))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })

  it('put no token or password in an address', () => {
    const offenders = Object.entries(files)
      .filter(([, text]) => /[?&](access_?token|token|password)=/i.test(text))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })
})
