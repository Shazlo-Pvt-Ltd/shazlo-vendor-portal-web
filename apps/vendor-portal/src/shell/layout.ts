import { useMediaQuery } from '@mui/material'

// Navigation follows the window width, not the device (spec §3, after Android's window size classes):
//   phone    under 600 px   bottom tab bar (phones, iPad ⅓ split view)
//   tablet   600–1023 px    navigation rail (iPad portrait, iPad mini, split view)
//   desktop  1024 px up     the Build 2 sidebar (iPad landscape, laptops)
// These are not MUI's breakpoints (sm 600, md 900, lg 1200); screens that only need "phone or not"
// should use useNavMode() so they switch exactly where the navigation does.
export const RAIL_MIN = 600
export const SIDEBAR_MIN = 1024

export const TAB_BAR_HEIGHT = 64
export const RAIL_WIDTH = 88
export const SIDEBAR_WIDTH = 248
// Forms on tablets and wider: one column at most this wide, centred.
export const FORM_MAX_WIDTH = 680

// Side gutters of the page content, and the space under it (above the tab bar on phones).
export const GUTTER = { phone: 16, tablet: 24, desktop: 40 } as const
const SAFE_BOTTOM = 'env(safe-area-inset-bottom, 0px)'
export const PAGE_END = {
  phoneTabs: `calc(${TAB_BAR_HEIGHT + 32}px + ${SAFE_BOTTOM})`,
  phoneTask: `calc(24px + ${SAFE_BOTTOM})`,
  wide: '64px',
} as const

export const media = {
  phone: `@media (max-width: ${RAIL_MIN - 0.05}px)`,
  tablet: `@media (min-width: ${RAIL_MIN}px) and (max-width: ${SIDEBAR_MIN - 0.05}px)`,
  desktop: `@media (min-width: ${SIDEBAR_MIN}px)`,
} as const

export type NavMode = 'phone' | 'tablet' | 'desktop'

export function useNavMode(): NavMode {
  const wide = useMediaQuery(`(min-width:${RAIL_MIN}px)`, { noSsr: true })
  const desktop = useMediaQuery(`(min-width:${SIDEBAR_MIN}px)`, { noSsr: true })
  return desktop ? 'desktop' : wide ? 'tablet' : 'phone'
}

export const useIsPhone = () => useNavMode() === 'phone'
