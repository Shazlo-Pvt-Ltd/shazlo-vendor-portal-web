import { vi } from 'vitest'

// Pretends the module's frame is `width` px wide: min-width and max-width media queries answer
// as a browser would, so MUI's useMediaQuery (and theme.breakpoints.down) pick the phone layout.
// The spy is restored after each test (restoreMocks in vitest.config).
export function setViewport(width: number) {
  const matches = (query: string) =>
    query
      .split(',')
      .some((part) =>
        [...part.matchAll(/\((min|max)-width:\s*([\d.]+)px\)/g)].every(([, kind, px]) => (kind === 'min' ? width >= Number(px) : width <= Number(px))),
      )
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: matches(query),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }))
}
