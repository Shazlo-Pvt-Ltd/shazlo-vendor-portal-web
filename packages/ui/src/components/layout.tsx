import { Box, Card, Link, Stack, Typography } from '@mui/material'
import { ChevronRight, type LucideIcon } from 'lucide-react'
import { useId, type ElementType, type ReactNode } from 'react'
import { brand, emphasis, fontFamily, neutral } from '../tokens'

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
          <Typography variant="body1" color="textSecondary" sx={{ mt: 1, maxWidth: '68ch' }}>
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

// An outlined card with a titled header; it is a labelled region for screen readers. An optional
// icon sits before the title; it is decoration, so the region keeps the title as its name.
export function SectionCard({ title, icon: Icon, action, children, padded = true, titleComponent = 'h2' }: { title: ReactNode; icon?: LucideIcon; action?: ReactNode; children: ReactNode; padded?: boolean; titleComponent?: ElementType }) {
  const id = useId()
  return (
    <Card component="section" aria-labelledby={id}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', justifyContent: 'space-between', px: { xs: 2, sm: 3 }, pt: 2.5, pb: padded ? 1 : 2 }}>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1.25, minWidth: 0 }}>
          {Icon && (
            <Box component="span" sx={{ display: 'flex', flexShrink: 0, color: neutral.inkSecondary }}>
              <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
            </Box>
          )}
          <Typography id={id} variant="h2" component={titleComponent}>
            {title}
          </Typography>
        </Stack>
        {action}
      </Stack>
      <Box sx={padded ? { px: { xs: 2, sm: 3 }, pb: 3, pt: 1 } : undefined}>{children}</Box>
    </Card>
  )
}

// A figure in type: label, number, baseline. No icon tiles or sparklines. With `href` the whole tile
// is one link, with a chevron and a hover state; pass the router's Link as `linkComponent` to keep
// navigation inside a single-page app.
const chevron = 'stat-figure-chevron'
const motion = '@media (prefers-reduced-motion: no-preference)'

export function StatFigure({ label, value, baseline, href, linkComponent }: { label: string; value: ReactNode; baseline?: string; href?: string; linkComponent?: ElementType }) {
  const id = useId()
  const body = (
    <>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <Typography id={id} variant="body2" sx={{ ...emphasis.semibold, color: 'text.primary', flex: 1, minWidth: 0 }}>
          {label}
        </Typography>
        {href && (
          <Box component="span" className={chevron} sx={{ display: 'flex', flexShrink: 0, mt: '-1px', mr: -0.5, color: neutral.inkSecondary, [motion]: { transition: 'transform 120ms ease-out, color 120ms ease-out' } }}>
            <ChevronRight size={18} strokeWidth={1.75} aria-hidden="true" />
          </Box>
        )}
      </Box>
      <Typography variant="stat" component="p" sx={{ fontVariantNumeric: 'lining-nums tabular-nums', fontFamily: fontFamily.display, my: 0.5 }}>
        {value}
      </Typography>
      {baseline && (
        <Typography variant="caption" color="textSecondary">
          {baseline}
        </Typography>
      )}
    </>
  )
  const sx = { display: 'block', p: { xs: 2, sm: 2.5 }, height: '100%', color: 'inherit', textDecoration: 'none' }
  return (
    <Card
      role="group"
      aria-labelledby={id}
      sx={{
        height: '100%',
        // The card clips the link's own outline, so the ring goes on the card.
        '&:has(a:focus-visible)': { outline: `2px solid ${brand.navy}`, outlineOffset: 2 },
        '@media (hover: hover)': { '&:has(a:hover)': { borderColor: neutral.lineStrong } },
      }}
    >
      {href ? (
        <Link
          href={href}
          component={linkComponent ?? 'a'}
          {...(linkComponent ? { to: href } : {})}
          underline="none"
          sx={{
            ...sx,
            cursor: 'pointer',
            '&:focus-visible': { outline: 'none' },
            '@media (hover: hover)': { '&:hover': { bgcolor: 'action.hover' }, [`&:hover .${chevron}`]: { color: neutral.ink, transform: 'translateX(2px)' } },
          }}
        >
          {body}
        </Link>
      ) : (
        <Box sx={sx}>{body}</Box>
      )}
    </Card>
  )
}
