import { vi } from 'vitest'

/**
 * jsdom has no matchMedia, so the module renders its desktop layout by default. This stubs one that
 * answers `(max-width: N px)` and `(min-width: N px)` queries for a frame `width` px wide. Undo it with
 * `vi.unstubAllGlobals()`.
 */
export function mockViewport(width: number) {
  const matches = (query: string) => {
    const max = /max-width:\s*([\d.]+)px/.exec(query)
    const min = /min-width:\s*([\d.]+)px/.exec(query)
    return (!max || width <= Number(max[1])) && (!min || width >= Number(min[1]))
  }
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: matches(query),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }))
}
