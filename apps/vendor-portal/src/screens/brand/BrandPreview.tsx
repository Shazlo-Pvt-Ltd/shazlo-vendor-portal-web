import { Box, Skeleton, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { brand, fontFamily, neutral, radius } from '@shazlo/ui'
import { Clock, Eye, ImageIcon, MapPin, RotateCcw, type LucideIcon } from 'lucide-react'
import { memo, useId, useState, type ReactNode } from 'react'
import type { Schemas } from '../../api/client'
import { useProducts } from '../../api/queries'
import { brandCopy as copy } from '../../copy/brand'
import { formatINR } from '../../lib/format'
import { LogoMark } from './fields'
import { cityOf, type Profile } from './schema'

type Version = 'draft' | 'live'

const TILE_PHOTO = { aspectRatio: '4 / 5', borderRadius: `${radius.control}px`, overflow: 'hidden', bgcolor: neutral.placeholder } as const

function Meta({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, typography: 'caption' }}>
      <Icon size={14} strokeWidth={1.5} aria-hidden="true" />
      {children}
    </Box>
  )
}

function Tile({ product }: { product: Schemas['ProductSummary'] }) {
  return (
    <Box component="li" sx={{ minWidth: 0 }}>
      <Box sx={{ ...TILE_PHOTO, display: 'grid', placeItems: 'center', color: neutral.lineStrong }}>
        {product.thumbnail_url ? (
          <Box component="img" src={product.thumbnail_url} alt="" loading="lazy" sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <ImageIcon size={20} strokeWidth={1.25} aria-hidden="true" />
        )}
      </Box>
      <Typography variant="caption" component="p" noWrap title={product.title} sx={{ mt: 0.75 }}>
        {product.title}
      </Typography>
      <Typography variant="caption" component="p" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {formatINR(product.price_paise)}
      </Typography>
    </Box>
  )
}

const grid = { listStyle: 'none', p: 0, m: 0, mt: 2.5, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.5 } as const

// The first four approved products, as tiles in the app's 2 × 2 grid.
const ProductTiles = memo(function ProductTiles() {
  const products = useProducts({ status: 'approved', limit: 4 })
  const items = products.data?.items ?? []
  if (products.isPending) {
    return (
      <Box sx={grid} aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <Box key={i}>
            <Skeleton variant="rounded" sx={{ ...TILE_PHOTO, height: 'auto' }} />
            <Skeleton variant="text" width="80%" />
          </Box>
        ))}
      </Box>
    )
  }
  if (items.length === 0) {
    // No approved products yet (or they did not load): empty tiles hold the shape; the caption explains.
    return (
      <Box sx={grid} aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <Box key={i} sx={TILE_PHOTO} />
        ))}
      </Box>
    )
  }
  return (
    <Box component="ul" sx={grid}>
      {items.map((p) => (
        <Tile key={p.id} product={p} />
      ))}
    </Box>
  )
})

// A phone-sized rendering of the brand page as shoppers see it in the Shazlo app.
function Phone({ profile, contained }: { profile: Profile; contained: boolean }) {
  const city = cityOf(profile.based_in)
  return (
    <Box sx={{ width: 300, maxWidth: '100%', mx: 'auto', border: `6px solid ${neutral.lineStrong}`, borderRadius: '28px', bgcolor: neutral.surface, overflow: 'hidden' }}>
      <Box aria-hidden="true" sx={{ height: 22, display: 'grid', placeItems: 'center' }}>
        <Box sx={{ width: 64, height: 5, borderRadius: 3, bgcolor: neutral.line }} />
      </Box>
      <Box
        // Beside the form the screen scrolls on its own, like a phone; keyboard users can focus it to scroll.
        {...(contained ? { tabIndex: 0, role: 'group', 'aria-label': copy.preview.screen } : {})}
        sx={{ pb: 2.5, ...(contained && { maxHeight: 'min(560px, calc(100dvh - 210px))', overflowY: 'auto', scrollbarWidth: 'thin', '&:focus-visible': { outlineOffset: -2 } }) }}
      >
        <Box sx={{ aspectRatio: '8 / 3', bgcolor: neutral.placeholder }}>
          {profile.cover_url && <Box component="img" src={profile.cover_url} alt="" sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
        </Box>
        <Box sx={{ px: 2, mt: '-28px' }}>
          <LogoMark url={profile.logo_url} name={profile.brand_name} size={56} ring />
          <Typography component="p" sx={{ fontFamily: fontFamily.display, fontSize: '1.375rem', lineHeight: 1.2, letterSpacing: '-0.2px', mt: 1, overflowWrap: 'anywhere' }}>
            {profile.brand_name}
          </Typography>
          {profile.tagline && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>
              {profile.tagline}
            </Typography>
          )}
          <Stack direction="row" sx={{ flexWrap: 'wrap', columnGap: 1.5, rowGap: 0.5, mt: 1.5, color: brand.brown }}>
            {city && <Meta icon={MapPin}>{city}</Meta>}
            <Meta icon={Clock}>{copy.dispatchTimes[profile.dispatch_time]}</Meta>
            <Meta icon={RotateCcw}>{copy.returnPolicies[profile.return_policy].short}</Meta>
          </Stack>
          {profile.story && (
            <Typography variant="body2" sx={{ mt: 1.5, whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>
              {profile.story}
            </Typography>
          )}
          <ProductTiles />
        </Box>
      </Box>
    </Box>
  )
}

// Options board pick: a phone preview beside the form with a Draft / Live switch. Draft follows the
// form as the seller types; Live shows what shoppers see today. A page that is not live yet has no switch.
export function BrandPreview({ draft, live, contained = false }: { draft: Profile; live: Profile | null; contained?: boolean }) {
  const titleId = useId()
  const [version, setVersion] = useState<Version>('draft')
  const shown = version === 'live' && live ? live : draft
  return (
    <Box component="section" aria-labelledby={titleId}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5, mb: 2 }}>
        <Typography id={titleId} variant="body2" component="h2" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, color: neutral.inkSecondary }}>
          <Eye size={16} strokeWidth={1.5} aria-hidden="true" />
          {copy.preview.title}
        </Typography>
        {live && (
          <ToggleButtonGroup exclusive size="small" value={version} onChange={(_, next: Version | null) => next && setVersion(next)} aria-label={copy.preview.version}>
            {(['draft', 'live'] as const).map((v) => (
              <ToggleButton
                key={v}
                value={v}
                sx={{
                  px: 1.75,
                  py: 0.5,
                  minHeight: { xs: 44, md: 32 },
                  color: neutral.inkSecondary,
                  borderColor: neutral.line,
                  typography: 'body2',
                  '&.Mui-selected, &.Mui-selected:hover': { bgcolor: brand.cream, color: neutral.ink },
                }}
              >
                {copy.preview[v]}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        )}
      </Stack>
      <Phone profile={shown} contained={contained} />
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', mt: 1.5 }}>
        {copy.preview.caption}
      </Typography>
    </Box>
  )
}
