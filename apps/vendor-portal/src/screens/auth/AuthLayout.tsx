import { Box, Card, Link, Stack, Typography, useMediaQuery } from '@mui/material'
import { type Theme } from '@mui/material/styles'
import { Banner, brand, Logo, neutral } from '@shazlo/ui'
import { ChevronLeft, HelpCircle } from 'lucide-react'
import type { ReactNode, Ref } from 'react'
import { useLocation } from 'react-router'
import { authCopy as copy } from '../../copy/auth'
import { useKeyboardInset } from '../../shell/StickyFooter'
import { noticeOf } from './notice'

function Header() {
  return (
    <Stack component="header" direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 2, px: { xs: 2, sm: 5 }, pt: { xs: 2.5, sm: 4 } }}>
      <Logo product="Seller" />
      <Typography variant="body2" color="textSecondary" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
        <HelpCircle size={16} aria-hidden="true" />
        <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{copy.help}</Box>
        {/* The narrowest phones (320–399 px) have no room for the address beside the logo: a mail link instead. */}
        <Box component="span" sx={{ userSelect: 'all', '@media (max-width: 399.95px)': { display: 'none' } }}>{copy.helpEmail}</Box>
        <Link href={`mailto:${copy.helpEmail}`} color="inherit" underline="always" sx={{ display: 'none', '@media (max-width: 399.95px)': { display: 'inline-flex', alignItems: 'center', minHeight: 44 } }}>
          {copy.helpShort}
        </Link>
      </Typography>
    </Stack>
  )
}

function Footer() {
  return (
    <Stack component="footer" direction="row" spacing={3} sx={{ justifyContent: 'center', flexWrap: 'wrap', rowGap: 1, py: 3, px: 2 }}>
      {copy.footer.map((l) => (
        <Link key={l.label} href={l.href} target="_blank" rel="noreferrer" variant="caption" color="text.secondary" underline="hover">
          {l.label}
        </Link>
      ))}
    </Stack>
  )
}

const PHONE = '(max-width:599.95px)'
const SAFE_BOTTOM = 'env(safe-area-inset-bottom, 0px)'

// Signed-out pages: logo and help line on top, legal links at the bottom.
// With `aside`, desktop splits into the form and a full-bleed panel (V-01: the photo collage); phones drop the panel.
// With `task` (sign-up), phones get the page edge to edge with no card, so the sticky footer can span
// the screen; wider screens a centred card at most 680 px wide (spec §3).
// A page that sent the seller here with a notice (see ./notice.ts: "Your password is set") shows
// it once, in the page, above the form.
export function AuthLayout({ children, aside, width = 440, task = false }: { children: ReactNode; aside?: ReactNode; width?: number; task?: boolean }) {
  const wide = useMediaQuery((t: Theme) => t.breakpoints.up('md'))
  const phone = useMediaQuery(PHONE, { noSsr: true })
  const notice = noticeOf(useLocation().state)
  const flush = task && phone
  const maxWidth = task ? 680 : width
  const content = (
    <>
      {notice && (
        <Box sx={{ mb: 3 }}>
          <Banner tone="success" title={notice} />
        </Box>
      )}
      {children}
    </>
  )
  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', bgcolor: neutral.canvas }}>
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Header />
        <Box
          component="main"
          sx={{ flex: 1, display: 'flex', alignItems: task ? 'flex-start' : 'center', justifyContent: 'center', px: 2, py: flush ? 3 : { xs: 4, sm: 6 }, ...(task && { overscrollBehaviorY: 'contain' }) }}
        >
          {flush || (aside && wide) ? (
            <Box sx={{ width: '100%', maxWidth }}>{content}</Box>
          ) : (
            <Card sx={{ width: '100%', maxWidth, p: { xs: 3, sm: 5 }, borderRadius: '12px', overflow: 'visible' }}>{content}</Card>
          )}
        </Box>
        <Footer />
      </Box>
      {aside && wide && (
        // The aside fills its panel edge to edge (the sign-in photo collage) and pads its own words.
        // It stays the height of the screen while a taller form scrolls, so its words stay in view.
        <Box sx={{ width: '42%', maxWidth: 620, flexShrink: 0, position: 'sticky', top: 0, alignSelf: 'flex-start', height: '100dvh', overflow: 'hidden', bgcolor: brand.navy }}>
          {aside}
        </Box>
      )}
    </Box>
  )
}

// The one main button of a sign-up page (spec §3, §8). On phones it sticks to the bottom of the
// screen above the home indicator, rides on top of the on-screen keyboard, and rests at the end of
// the page; wider screens show it at the end of the card.
export function TaskFooter({ children }: { children: ReactNode }) {
  const phone = useMediaQuery(PHONE, { noSsr: true })
  const keyboard = useKeyboardInset()
  if (!phone) {
    return <Stack direction="row" sx={{ justifyContent: 'flex-end', gap: 1.5, mt: 4 }}>{children}</Stack>
  }
  return (
    <Box
      data-sticky-footer=""
      sx={{
        position: 'sticky',
        bottom: keyboard > 0 ? `${keyboard}px` : 0,
        zIndex: 15,
        display: 'flex',
        gap: 1.5,
        mt: 4,
        mx: -2,
        px: 2,
        pt: 1.5,
        pb: keyboard > 0 ? '12px' : `calc(12px + ${SAFE_BOTTOM})`,
        bgcolor: neutral.surface,
        borderTop: `1px solid ${neutral.line}`,
        '& > *': { flex: '1 1 0', minWidth: 0, minHeight: 48 },
      }}
    >
      {children}
    </Box>
  )
}

// "Back" at the top of a sign-up page.
export function BackButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.25,
        minHeight: 44,
        pl: 0.5,
        pr: 1.5,
        ml: -1,
        mb: 1,
        color: neutral.ink,
        typography: 'body1',
        font: 'inherit',
        border: 0,
        bgcolor: 'transparent',
        cursor: 'pointer',
        borderRadius: '6px',
        '@media (hover: hover)': { '&:hover': { textDecoration: 'underline' } },
      }}
    >
      <ChevronLeft size={20} strokeWidth={1.75} aria-hidden="true" />
      {label}
    </Box>
  )
}

// With `headingRef`, the heading can take focus (a page that replaced another moves focus to it).
export function AuthTitle({ title, subtitle, headingRef }: { title: string; subtitle?: ReactNode; headingRef?: Ref<HTMLHeadingElement> }) {
  return (
    <Box sx={{ mb: 4 }}>
      <Typography ref={headingRef} tabIndex={headingRef ? -1 : undefined} variant="pageTitle" component="h1" sx={{ outline: 'none', fontSize: { xs: '1.75rem', sm: '2.25rem' }, lineHeight: 1.15, textWrap: 'balance', overflowWrap: 'anywhere' }}>
        {title}
      </Typography>
      {subtitle && (
        <Typography variant="body1" color="textSecondary" sx={{ mt: 1.5 }}>
          {subtitle}
        </Typography>
      )}
    </Box>
  )
}
