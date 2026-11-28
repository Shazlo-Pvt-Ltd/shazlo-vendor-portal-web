import { describe, expect, it } from 'vitest'

// Every source file of the module, as text: not the tests.
const files = import.meta.glob<string>(['../**/*.tsx', '!../**/*.test.tsx'], { query: '?raw', import: 'default', eager: true })

// MUI 9's Typography takes palette keys ("primary") or "textSecondary" for its color prop. A theme
// path such as "text.secondary" is silently ignored there, so the text falls back to ink. Link
// still resolves theme paths, so only Typography is checked. An opening tag may span lines.
const OFFENDER = /<Typography\b[^>]*?\bcolor="text\.[a-z]+"/g

function offenders(path: string, text: string): string[] {
  return [...text.matchAll(OFFENDER)].map((m) => `${path}:${text.slice(0, m.index).split('\n').length}`)
}

describe('Typography colours', () => {
  it('finds the screens it is meant to check', () => {
    expect(Object.keys(files).length).toBeGreaterThan(30)
  })

  it('catches a theme path, on one line or across lines', () => {
    expect(offenders('a.tsx', '<Typography variant="body2" color="text.secondary">x</Typography>')).toEqual(['a.tsx:1'])
    expect(offenders('b.tsx', '<Typography\n  variant="body2"\n  color="text.primary"\n>')).toEqual(['b.tsx:1'])
    expect(offenders('c.tsx', '<Typography color="textSecondary">x</Typography><Link color="text.secondary">y</Link>')).toEqual([])
  })

  it('never passes a theme path to Typography color', () => {
    expect(Object.entries(files).flatMap(([path, text]) => offenders(path, text))).toEqual([])
  })
})
