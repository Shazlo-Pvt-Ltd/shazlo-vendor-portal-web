import { GlobalStyles } from '@mui/material'
import { brand, neutral } from '@shazlo/ui'

// Seller-only page rules on top of the shared theme (packages/ui stays as it is for every app).
const styles = {
  // scroll-padding-top keeps anchors (#commission) clear of the sticky top bar.
  html: { WebkitTextSizeAdjust: '100%', textSizeAdjust: '100%', scrollPaddingTop: 'calc(72px + env(safe-area-inset-top, 0px))' },
  // The canvas fills the whole window, also under the iOS home indicator and the overscroll area.
  'html, body': { backgroundColor: neutral.canvas },
  // No tap flash on Android; pressed states come from the components.
  body: { WebkitTapHighlightColor: 'transparent' },
  // An accidental pull-to-refresh would throw away a half-typed form: off inside full-screen tasks
  // (the shell sets data-task on <html>) and in the home-screen app, which has no reload button anyway.
  'html[data-task], html[data-task] body': { overscrollBehaviorY: 'contain' },
  '@media (display-mode: standalone)': { 'html, body': { overscrollBehaviorY: 'contain' } },
  // Focus is always a navy ring, never yellow and never only a colour change. MUI's ButtonBase drops
  // the outline, so give buttons, tabs and list rows the theme's ring back.
  '.MuiButtonBase-root.Mui-focusVisible': { outline: `2px solid ${brand.navy}`, outlineOffset: '2px' },
  // Motion is decoration here: turn it off for people who ask for less.
  '@media (prefers-reduced-motion: reduce)': {
    '*, *::before, *::after': {
      animationDuration: '0.01ms !important',
      animationIterationCount: '1 !important',
      transitionDuration: '0.01ms !important',
      transitionDelay: '0ms !important',
      scrollBehavior: 'auto !important',
    },
  },
} as const

export function SellerGlobalStyles() {
  return <GlobalStyles styles={styles} />
}
