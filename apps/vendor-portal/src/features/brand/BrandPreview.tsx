import { Avatar, Box, Chip, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { useState } from 'react'
import { SafeImage } from '../../security/SafeImage'
import { SafeLink } from '../../security/SafeLink'
import { rupeesToPaise } from '../signup/money'
import { normaliseInstagram, type BrandValues } from './rules'

type Width = 'phone' | 'desktop'

const WIDTH: Record<Width, number> = { phone: 360, desktop: 720 }

const wholeRupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
const withPaise = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** ₹999 for a whole amount, ₹999.50 when there are paise. */
const money = (paise: number) => (paise % 100 === 0 ? wholeRupees : withPaise).format(paise / 100)

/** "₹999 – ₹9,999", or what is typed so far (nothing, or one end) without inventing a number. */
export function priceRange(min: string, max: string): string {
  const low = rupeesToPaise(min)
  const high = rupeesToPaise(max)
  const show = money
  if (low !== null && high !== null) return low === high ? show(low) : `${show(low)} – ${show(high)}`
  if (low !== null) return `From ${show(low)}`
  if (high !== null) return `Up to ${show(high)}`
  return ''
}

function Logo({ url, name, size }: { url: string | null; name: string; size: number }) {
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? '?'
  const fallback = (
    <Avatar sx={{ width: size, height: size, bgcolor: 'primary.main' }} aria-hidden="true">
      {initial}
    </Avatar>
  )
  return (
    <Box sx={{ width: size, height: size, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, bgcolor: 'background.paper', border: 1, borderColor: 'divider' }}>
      <SafeImage src={url} alt="" fallback={fallback} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
    </Box>
  )
}

/** The brand as a card in a list of brands. Every vendor value is text or goes through a safe component. */
function BrandCard({ values }: { values: BrandValues }) {
  const name = values.brandName.trim() || 'Your brand name'
  const price = priceRange(values.priceMin, values.priceMax)
  return (
    <Box component="article" aria-label="Brand card" sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2, bgcolor: 'background.paper' }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
        <Logo url={values.logoUrl} name={values.brandName} size={56} />
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
            {name}
          </Typography>
          {values.tagline.trim() ? (
            <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
              {values.tagline.trim()}
            </Typography>
          ) : null}
        </Box>
      </Stack>
      {price ? (
        <Typography variant="body2" sx={{ mt: 1.5 }}>
          {price}
        </Typography>
      ) : null}
      {values.categories.length > 0 ? (
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
          {values.categories.slice(0, 3).map((category) => (
            <Chip key={category} size="small" label={category} variant="outlined" />
          ))}
        </Stack>
      ) : null}
    </Box>
  )
}

/** The top of the brand's own page: banner, logo, name, tagline, details and links. */
function BrandHeader({ values, width }: { values: BrandValues; width: Width }) {
  const name = values.brandName.trim() || 'Your brand name'
  const handle = normaliseInstagram(values.instagram)
  const price = priceRange(values.priceMin, values.priceMax)
  const phone = width === 'phone'
  return (
    <Box component="section" aria-label="Brand page header" sx={{ border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden', bgcolor: 'background.paper' }}>
      <Box sx={{ height: phone ? 96 : 160, bgcolor: 'action.hover' }}>
        <SafeImage src={values.bannerUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} fallback={null} />
      </Box>
      <Box sx={{ p: 2 }}>
        <Stack direction={phone ? 'column' : 'row'} spacing={2} sx={{ alignItems: phone ? 'flex-start' : 'center', mt: phone ? -5 : -6 }}>
          <Logo url={values.logoUrl} name={values.brandName} size={phone ? 64 : 88} />
          <Box sx={{ minWidth: 0, pt: phone ? 0 : 3 }}>
            <Typography component="h3" variant={phone ? 'h6' : 'h5'} sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
              {name}
            </Typography>
            {values.tagline.trim() ? (
              <Typography color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                {values.tagline.trim()}
              </Typography>
            ) : null}
          </Box>
        </Stack>
        {values.about.trim() ? (
          <Typography sx={{ mt: 2, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{values.about.trim()}</Typography>
        ) : null}
        {price ? (
          <Typography variant="body2" sx={{ mt: 1.5 }}>
            Prices: {price}
          </Typography>
        ) : null}
        {values.categories.length > 0 ? (
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5, mt: 1.5 }}>
            {values.categories.map((category) => (
              <Chip key={category} size="small" label={category} />
            ))}
          </Stack>
        ) : null}
        <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', mt: 1.5 }}>
          {values.website.trim() ? <SafeLink href={values.website.trim()}>Website</SafeLink> : null}
          {handle ? <SafeLink href={`https://www.instagram.com/${handle}`}>{`@${handle}`}</SafeLink> : null}
        </Stack>
      </Box>
    </Box>
  )
}

interface Props {
  values: BrandValues
  title?: string
}

/**
 * How shoppers will see the brand: the card and the page header, at a phone or a desktop width.
 * It only reads the values, so it updates as the vendor types. Text is never rendered as HTML.
 */
export function BrandPreview({ values, title = 'Preview' }: Props) {
  const [width, setWidth] = useState<Width>('phone')
  return (
    <Box component="section" aria-label={title}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
        <Typography component="h2" variant="h6">
          {title}
        </Typography>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={width}
          onChange={(_event, next: Width | null) => next && setWidth(next)}
          aria-label="Preview width"
        >
          <ToggleButton value="phone">Phone</ToggleButton>
          <ToggleButton value="desktop">Desktop</ToggleButton>
        </ToggleButtonGroup>
      </Stack>
      <Box sx={{ maxWidth: '100%', overflowX: 'auto' }}>
        <Stack spacing={2} sx={{ width: WIDTH[width], maxWidth: '100%', mx: 'auto' }} data-testid="preview-frame" data-width={width}>
          <BrandCard values={values} />
          <BrandHeader values={values} width={width} />
        </Stack>
      </Box>
    </Box>
  )
}
