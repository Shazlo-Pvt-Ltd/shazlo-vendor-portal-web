import { describe, expect, it } from 'vitest'

// Every source file of the app, as text: not the tests, and not the test helpers.
const files = import.meta.glob<string>(['../**/*.tsx', '!../**/*.test.tsx', '!../test/**'], { query: '?raw', import: 'default', eager: true })

// Each `<Typography …>` opening tag, props spread over several lines included: up to the first `>`
// outside braces and quotes (so `sx={{ … }}` and `=>` in a prop do not end it).
function typographyTags(text: string): { tag: string; line: number }[] {
  const tags: { tag: string; line: number }[] = []
  for (let start = text.indexOf('<Typography'); start >= 0; start = text.indexOf('<Typography', start + 1)) {
    let depth = 0
    let quote: string | null = null
    let end = start + '<Typography'.length
    for (; end < text.length; end++) {
      const c = text[end]!
      if (quote) {
        if (c === quote) quote = null
      } else if (depth === 0 && (c === '"' || c === "'")) quote = c
      else if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) break
    }
    tags.push({ tag: text.slice(start, end), line: text.slice(0, start).split('\n').length })
  }
  return tags
}

// MUI 9's Typography takes palette keys ("primary") or "textPrimary" / "textSecondary" for its
// color prop. A theme path such as "text.secondary" is silently ignored there, so the text falls
// back to ink. (Link still takes the theme path.)
describe('Typography colours', () => {
  it('finds the screens it is meant to check', () => {
    expect(Object.keys(files).length).toBeGreaterThan(20)
    expect(typographyTags('<Typography\n  variant="body2"\n  sx={{ a: 1 }}\n  color="text.secondary"\n>x</Typography>')).toEqual([
      { tag: '<Typography\n  variant="body2"\n  sx={{ a: 1 }}\n  color="text.secondary"\n', line: 1 },
    ])
  })

  it('never passes a theme path to Typography color, on one line or several', () => {
    const offenders = Object.entries(files).flatMap(([path, text]) =>
      typographyTags(text)
        .filter(({ tag }) => /\bcolor=(?:"text\.|\{\s*['"`]text\.)/.test(tag))
        .map(({ line }) => `${path}:${line}`),
    )
    expect(offenders).toEqual([])
  })
})
