import { Box, Stack, Typography } from '@mui/material'
import { EmptyIllustration, Logo, neutral, radius, type IllustrationName } from '@shazlo/ui'
import { useEffect, useRef, type ReactNode } from 'react'

interface NoticeProps {
  title: string
  children?: ReactNode
  /** Buttons; one contained (yellow) button at most (calm rules). */
  actions?: ReactNode
  illustration?: IllustrationName
  /** Move keyboard focus to the heading when the notice appears (it replaced the page). */
  focus?: boolean
}

/**
 * A page-sized message in Build 2's look (like the shared EmptyState, but the title is the page's
 * h1): not found, not allowed, something broke, an account that cannot be used.
 */
export function Notice({ title, children, actions, illustration, focus = false }: NoticeProps) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (focus) heading.current?.focus()
  }, [focus])
  return (
    <Stack spacing={1.5} sx={{ alignItems: 'center', textAlign: 'center', py: { xs: 5, sm: 7 }, px: 2 }}>
      {illustration && <EmptyIllustration name={illustration} />}
      <Typography ref={heading} variant="h1" component="h1" tabIndex={-1} sx={{ outline: 'none', textWrap: 'balance' }}>
        {title}
      </Typography>
      {children && (
        <Typography variant="body1" component="div" color="textSecondary" sx={{ maxWidth: '50ch', '& p': { m: 0 }, '& p + p': { mt: 1 } }}>
          {children}
        </Typography>
      )}
      {actions && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ pt: 1, alignItems: 'center' }}>
          {actions}
        </Stack>
      )}
    </Stack>
  )
}

/**
 * A whole window with no seller frame around it: the misconfigured build, a crash, the session
 * check, a blocked account. The logo on top, the content in a card on the canvas.
 */
export function PlainPage({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', bgcolor: neutral.canvas }}>
      <Box component="header" sx={{ px: { xs: 2, sm: 5 }, pt: 'max(20px, env(safe-area-inset-top, 0px))' }}>
        <Logo product="Seller" />
      </Box>
      <Box component="main" aria-label={label} sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', px: 2, py: { xs: 4, sm: 6 } }}>
        <Box sx={{ width: '100%', maxWidth: 560, bgcolor: neutral.surface, border: `1px solid ${neutral.line}`, borderRadius: `${radius.sheet}px`, px: { xs: 2, sm: 4 } }}>
          {children}
        </Box>
      </Box>
    </Box>
  )
}
