import { describe, expect, it } from 'vitest'

// Every component and demo source file, as text: not the tests.
const files = import.meta.glob<string>(['./**/*.tsx', '../demo/**/*.tsx', '!./**/*.test.tsx'], { query: '?raw', import: 'default', eager: true })

// MUI 9's Typography takes palette keys ("primary") or "textSecondary" for its color prop. A theme
// path such as "text.secondary" is silently ignored there, so the text falls back to black.
describe('Typography colours', () => {
  it('finds the files it is meant to check', () => {
    expect(Object.keys(files).length).toBeGreaterThan(5)
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
