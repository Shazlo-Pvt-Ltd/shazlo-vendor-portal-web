import { describe, expect, it } from 'vitest'

// Every source file of the app, as text: not the tests.
const files = import.meta.glob<string>(['../**/*.tsx', '!../**/*.test.tsx'], { query: '?raw', import: 'default', eager: true })

// MUI 9's Typography takes palette keys ("primary") or "textSecondary" for its color prop. A theme
// path such as "text.secondary" is silently ignored there, so the text falls back to ink.
describe('Typography colours', () => {
  it('finds the screens it is meant to check', () => {
    expect(Object.keys(files).length).toBeGreaterThan(10)
  })

  it('never passes a theme path to Typography color', () => {
    const offenders = Object.entries(files).flatMap(([path, text]) =>
      text
        .split('\n')
        .map((line, i) => [line, i + 1] as const)
        .filter(([line]) => /<Typography\b[^>]*\bcolor="text\./.test(line))
        .map(([, n]) => `${path}:${n}`),
    )
    expect(offenders).toEqual([])
  })
})
