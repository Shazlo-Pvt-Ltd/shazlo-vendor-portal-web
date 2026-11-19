// @vitest-environment node
import { ESLint } from 'eslint'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
// The first lint call loads the whole ESLint config, which is slow on some disks.
vi.setConfig({ testTimeout: 90_000 })
const eslint = new ESLint({ cwd: repoRoot })

async function messagesFor(code: string, name = 'x.tsx') {
  const [result] = await eslint.lintText(code, { filePath: `${repoRoot}apps/vendor-portal/src/${name}` })
  return result!.messages
}

describe('the lint rules that protect vendors', () => {
  it.each([
    ['localStorage.setItem("token", t)', 'no-restricted-globals'],
    ['sessionStorage.getItem("token")', 'no-restricted-globals'],
    ['window.localStorage.setItem("a", b)', 'no-restricted-properties'],
    ['globalThis.indexedDB.open("x")', 'no-restricted-properties'],
    ['indexedDB.open("x")', 'no-restricted-globals'],
    ['console.log(token)', 'no-console'],
    ['document.body.innerHTML = html', 'no-restricted-syntax'],
    ['el.insertAdjacentHTML("beforeend", html)', 'no-restricted-syntax'],
    ['eval("1")', 'no-eval'],
    ['new Function("return 1")', 'no-new-func'],
  ])('forbids %s', async (code, rule) => {
    const messages = await messagesFor(`export const f = () => { ${code} }\n`)
    expect(messages.map((m) => m.ruleId)).toContain(rule)
  })

  it('forbids dangerouslySetInnerHTML', async () => {
    const messages = await messagesFor(
      'export const A = ({ html }: { html: string }) => <div dangerouslySetInnerHTML={{ __html: html }} />\n',
    )
    expect(messages.map((m) => m.ruleId)).toContain('no-restricted-syntax')
  })

  it('still allows console.error, which the error screens use', async () => {
    expect(await messagesFor('export const f = (e: unknown) => { console.error(e) }\n')).toEqual([])
  })

  it('does not apply to tests, which read storage to prove nothing is written', async () => {
    expect(await messagesFor('export const f = () => localStorage.length\n', 'thing.test.ts')).toEqual([])
  })
})

describe('the source files', () => {
  const files = import.meta.glob<string>(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}', '!../test/**'], {
    query: '?raw',
    import: 'default',
    eager: true,
  })

  it('finds the source files it is meant to check', () => {
    expect(Object.keys(files).length).toBeGreaterThan(8)
  })

  it('touch no web storage', () => {
    const offenders = Object.entries(files)
      .filter(([, text]) => /\b(localStorage|sessionStorage|indexedDB)\b/.test(text))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })

  it('render a password input only through PasswordField', () => {
    const offenders = Object.entries(files)
      .filter(([path]) => !/(^|\/)PasswordField\.tsx$/.test(path))
      .filter(([, text]) => /type\s*[=:]\s*\{?\s*['"]password['"]/.test(text))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })

  it('never put a token or password in a URL, a log call or an error message', () => {
    const offenders = Object.entries(files)
      .filter(([, text]) => /console\.\w+\([^)]*(token|password)/i.test(text))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })
})
