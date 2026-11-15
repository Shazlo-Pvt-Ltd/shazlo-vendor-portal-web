import { vi } from 'vitest'

/**
 * Pretends the browser window is `width` px wide, for code that asks `matchMedia` (MUI's
 * `useMediaQuery`). jsdom has no layout, so this is how a test chooses phone, tablet or desktop.
 * Handles the `min-width` and `max-width` queries MUI's breakpoints produce.
 */
export function setViewport(width: number): void {
  vi.stubGlobal('matchMedia', (query: string) => {
    const min = /min-width:\s*([\d.]+)px/.exec(query)
    const max = /max-width:\s*([\d.]+)px/.exec(query)
    const matches = (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]))
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }
  })
}
