import { Box, Card, Link, Stack, Typography } from '@mui/material'
import { useId, type ElementType, type ReactNode } from 'react'
import { fontFamily, neutral } from '../tokens'

// The one h1 on a page. Editorial scale: 48 px Bodoni on desktop, 32 px on phones.
export function PageHeader({ title, subtitle, status, actions, eyebrow }: { title: string; subtitle?: ReactNode; status?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: { md: 'flex-end' }, justifyContent: 'space-between', mb: { xs: 3, md: 4 } }}>
      <Box sx={{ minWidth: 0 }}>
        {eyebrow}
        <Stack direction="row" spacing={1.5} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="pageTitle" component="h1" sx={{ textWrap: 'balance', overflowWrap: 'anywhere' }}>
            {title}
          </Typography>
          {status}
        </Stack>
        {subtitle && (
          <Typography variant="body1" color="text.secondary" sx={{ mt: 1, maxWidth: '68ch' }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      {actions && (
        <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexShrink: 0, flexWrap: 'wrap', alignItems: 'center' }}>
          {actions}
        </Stack>
      )}
    </Stack>
  )
}

// An outlined card with a titled header; it is a labelled region for screen readers.
export function SectionCard({ title, action, children, padded = true, titleComponent = 'h2' }: { title: ReactNode; action?: ReactNode; children: ReactNode; padded?: boolean; titleComponent?: ElementType }) {
  const id = useId()
  return (
    <Card component="section" aria-labelledby={id}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', justifyContent: 'space-between', px: { xs: 2, sm: 3 }, pt: 2.5, pb: padded ? 1 : 2 }}>
        <Typography id={id} variant="h2" component={titleComponent}>
          {title}
        </Typography>
        {action}
      </Stack>
      <Box sx={padded ? { px: { xs: 2, sm: 3 }, pb: 3, pt: 1 } : undefined}>{children}</Box>
    </Card>
  )
}

// A figure in type: label, number, baseline. No icon tiles or sparklines.
export function StatFigure({ label, value, baseline, href, linkComponent }: { label: string; value: ReactNode; baseline?: string; href?: string; linkComponent?: ElementType }) {
  const id = useId()
  const body = (
    <>
      <Typography id={id} variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="stat" component="p" sx={{ fontVariantNumeric: 'lining-nums tabular-nums', fontFamily: fontFamily.display, my: 0.5 }}>
        {value}
      </Typography>
      {baseline && (
        <Typography variant="caption" color="text.secondary">
          {baseline}
        </Typography>
      )}
    </>
  )
  const sx = { display: 'block', p: { xs: 2, sm: 2.5 }, height: '100%', color: 'inherit', textDecoration: 'none' }
  return (
    <Card role="group" aria-labelledby={id} sx={{ height: '100%', '&:has(a:focus-visible)': { outline: `2px solid ${neutral.inkSecondary}`, outlineOffset: 2 } }}>
      {href ? (
        <Link href={href} component={linkComponent ?? 'a'} {...(linkComponent ? { to: href } : {})} underline="none" sx={{ ...sx, '@media (hover: hover)': { '&:hover': { bgcolor: 'rgba(255, 237, 163, 0.35)' } } }}>
          {body}
        </Link>
      ) : (
        <Box sx={sx}>{body}</Box>
      )}
    </Card>
  )
}
