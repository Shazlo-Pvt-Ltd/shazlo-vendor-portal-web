import { Box, Card, Link, Stack, Typography, useMediaQuery } from '@mui/material'
import { type Theme } from '@mui/material/styles'
import { brand, fontFamily, Logo, neutral } from '@shazlo/ui'
import { HelpCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { authCopy as copy } from '../../copy/auth'

function Header() {
  return (
    <Stack component="header" direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 2, px: { xs: 2, sm: 5 }, pt: { xs: 2.5, sm: 4 } }}>
      <Logo product="Seller" />
      <Typography variant="body2" color="text.secondary" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
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

// Signed-out pages: logo and help line on top, legal links at the bottom.
// With `aside`, desktop splits into the form and a cream panel (V-01, pick C); phones drop the panel.
export function AuthLayout({ children, aside, width = 440 }: { children: ReactNode; aside?: ReactNode; width?: number }) {
  const wide = useMediaQuery((t: Theme) => t.breakpoints.up('md'))
  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', bgcolor: neutral.canvas }}>
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Header />
        <Box component="main" sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', px: 2, py: { xs: 4, sm: 6 } }}>
          {aside && wide ? (
            <Box sx={{ width: '100%', maxWidth: width }}>{children}</Box>
          ) : (
            <Card sx={{ width: '100%', maxWidth: width, p: { xs: 3, sm: 5 }, borderRadius: '12px' }}>{children}</Card>
          )}
        </Box>
        <Footer />
      </Box>
      {aside && wide && (
        <Box sx={{ width: '42%', maxWidth: 620, flexShrink: 0, bgcolor: brand.cream, display: 'flex', alignItems: 'center', px: 7, py: 8 }}>
          {aside}
        </Box>
      )}
    </Box>
  )
}

export function AuthTitle({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <Box sx={{ mb: 4 }}>
      <Typography variant="h1" component="h1" sx={{ fontFamily: fontFamily.display, fontSize: { xs: '1.75rem', sm: '2.25rem' }, lineHeight: 1.15, fontWeight: 400, textWrap: 'balance' }}>
        {title}
      </Typography>
      {subtitle && (
        <Typography variant="body1" color="text.secondary" sx={{ mt: 1.5 }}>
          {subtitle}
        </Typography>
      )}
    </Box>
  )
}
