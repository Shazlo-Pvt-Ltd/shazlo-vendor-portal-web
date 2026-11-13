import { describe, expect, it } from 'vitest'

// Every source file of the app, as text: not the tests, and not the test helpers.
const files = import.meta.glob<string>(
  ['./**/*.{ts,tsx,css}', '!./**/*.test.{ts,tsx}', '!./test/**'],
  { query: '?raw', import: 'default', eager: true },
)

function offenders(pattern: RegExp): string[] {
  return Object.entries(files)
    .filter(([, text]) => pattern.test(text))
    .map(([path]) => path)
}

describe('the app uses the shared theme', () => {
  it('finds the source files it is meant to check', () => {
    expect(Object.keys(files).length).toBeGreaterThan(8)
  })

  it('has no hex colour in any source file', () => {
    expect(offenders(/#[0-9a-fA-F]{3,8}\b/)).toEqual([])
  })

  it('names no font family of its own', () => {
    expect(offenders(/font-?family\s*[:=]/i)).toEqual([])
  })

  it('has no rgb() or hsl() colour either', () => {
    expect(offenders(/\b(rgba?|hsla?)\(/)).toEqual([])
  })
})
