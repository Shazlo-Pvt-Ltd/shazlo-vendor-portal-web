import { Box } from '@mui/material'
import { neutral } from '@shazlo/ui'
import { useSyncExternalStore, type ReactNode } from 'react'
import { GUTTER, TAB_BAR_HEIGHT, useNavMode } from './layout'
import { useTaskState } from './task'

const SAFE_BOTTOM = 'env(safe-area-inset-bottom, 0px)'
// Smaller gaps between the layout and visual viewport are pinch zoom or browser bars, not a keyboard.
const KEYBOARD_MIN = 120

// How much of the page bottom the on-screen keyboard covers. Mobile browsers keep the layout viewport
// (and so fixed and sticky bars) at full height and only shrink the visual viewport when the keyboard
// opens, so the difference is what the keyboard hides. (We do not ask for interactive-widget=
// resizes-content: on Android it would also float the tab bar on top of the keyboard.)
function subscribe(onChange: () => void) {
  const vv = window.visualViewport
  if (!vv) return () => {}
  vv.addEventListener('resize', onChange)
  vv.addEventListener('scroll', onChange)
  return () => {
    vv.removeEventListener('resize', onChange)
    vv.removeEventListener('scroll', onChange)
  }
}

function keyboardInset() {
  const vv = window.visualViewport
  if (!vv) return 0
  const covered = Math.round(window.innerHeight - vv.height - vv.offsetTop)
  return covered >= KEYBOARD_MIN ? covered : 0
}

export function useKeyboardInset() {
  return useSyncExternalStore(subscribe, keyboardInset, () => 0)
}

/*
 * The one sticky action bar of a full-screen task (spec §3, §7): "Next", "Save", "Send for review".
 *
 *   <form onSubmit={…}>
 *     …fields…
 *     <StickyFooter>
 *       <Button variant="outlined" onClick={back}>Back</Button>
 *       <Button variant="contained" type="submit">Next</Button>
 *     </StickyFooter>
 *   </form>
 *
 * - Render it as the last child of the page or of the page's <form>, not inside a card: it sticks to the
 *   bottom of the window while its parent is on screen and comes to rest at the end of the page.
 * - It spans the content column edge to edge. On phones each child grows to an equal share of the width
 *   (one button is full width); on wider screens the buttons sit at the right.
 * - Above the home indicator: the safe-area inset is added under the buttons.
 * - Never on top of the tab bar: in a full-screen task the tab bar is hidden; on other phone pages the
 *   footer sits just above the tab bar.
 * - On-screen keyboard: the footer is lifted onto the keyboard using window.visualViewport (iOS Safari
 *   and Android Chrome alike). Limits: it can trail the keyboard by a frame while it slides or while the
 *   page scrolls with the keyboard open (iOS reports visual viewport changes late during momentum
 *   scrolling); browsers without visualViewport (iOS before 13) leave it behind the keyboard until the
 *   keyboard closes; a keyboard shorter than 120 px (a hardware keyboard's accessory bar) is ignored.
 * - One yellow (contained) button per screen: put the main action here and nowhere else on the page.
 */
export function StickyFooter({ children, label }: { children: ReactNode; label?: string }) {
  const mode = useNavMode()
  const { fullScreen } = useTaskState()
  const keyboard = useKeyboardInset()
  const phone = mode === 'phone'
  const overTabBar = phone && !fullScreen
  const gutter = GUTTER[mode]

  // Matches the shell's space under the page (PAGE_END in ./layout.ts), so the bar can cancel it.
  const pageEnd = overTabBar ? '32px' : phone ? `calc(24px + ${SAFE_BOTTOM})` : '64px'
  let bottom: string
  let paddingBottom: string
  if (keyboard > 0) {
    // On the keyboard. It also covers the tab bar and the home indicator, so no extra space for those.
    bottom = `${keyboard}px`
    paddingBottom = '12px'
  } else if (overTabBar) {
    bottom = `calc(${TAB_BAR_HEIGHT}px + ${SAFE_BOTTOM})`
    paddingBottom = '12px'
  } else {
    bottom = '0px'
    paddingBottom = `calc(12px + ${SAFE_BOTTOM})`
  }

  return (
    <Box
      role={label ? 'region' : undefined}
      aria-label={label}
      data-sticky-footer=""
      sx={{
        position: 'sticky',
        bottom,
        zIndex: 15,
        display: 'flex',
        gap: 1.5,
        alignItems: 'center',
        justifyContent: 'flex-end',
        mt: 3,
        // Cancels the shell's space under the page, so the bar rests flush at the end.
        mb: `calc(-1 * ${pageEnd})`,
        mx: `-${gutter}px`,
        px: `${gutter}px`,
        pt: 1.5,
        pb: paddingBottom,
        bgcolor: neutral.surface,
        borderTop: `1px solid ${neutral.line}`,
        ...(phone && { '& > *': { flex: '1 1 0', minWidth: 0, minHeight: 48 } }),
      }}
    >
      {children}
    </Box>
  )
}
