import { Box, Stack, Typography } from '@mui/material'
import { brand, fontFamily, neutral } from '@shazlo/ui'
import { Clock, MapPin, RotateCcw, type LucideIcon } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import type { components } from '../../api/schema'
import { reviewCopy } from '../../copy/review'

const copy = reviewCopy.brand
type Profile = components['schemas']['BrandProfile']

export const cityOf = (basedIn: string) => basedIn.split(',')[0]!.trim()
export const returnsLabel = (code: string) => copy.returnPolicies[code] ?? code
export const dispatchLabel = (code: string) => copy.dispatchTimes[code] ?? code

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('')
}

function Meta({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, typography: 'caption' }}>
      <Icon size={14} strokeWidth={1.5} aria-hidden="true" />
      {children}
    </Box>
  )
}

// The brand page as shoppers see it in the Shazlo app, in a phone frame, under a labelled heading.
export function PhonePreview({ heading, brandName, profile, note }: { heading: string; brandName: string; profile: Profile; note?: string }) {
  const id = useId()
  const city = cityOf(profile.based_in)
  return (
    <Box component="section" aria-labelledby={id} sx={{ minWidth: 0 }}>
      <Typography id={id} variant="h3" component="h3" sx={{ mb: 1.5, textAlign: 'center' }}>
        {heading}
      </Typography>
      <Box sx={{ width: 300, maxWidth: '100%', mx: 'auto', border: `6px solid ${neutral.lineStrong}`, borderRadius: '28px', bgcolor: neutral.surface, overflow: 'hidden' }}>
        <Box aria-hidden="true" sx={{ height: 22, display: 'grid', placeItems: 'center' }}>
          <Box sx={{ width: 64, height: 5, borderRadius: 3, bgcolor: neutral.line }} />
        </Box>
        <Box sx={{ pb: 2.5 }}>
          <Box sx={{ aspectRatio: '8 / 3', bgcolor: neutral.placeholder }}>
            {profile.cover_url && <Box component="img" src={profile.cover_url} alt={copy.preview.cover} sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
          </Box>
          <Box sx={{ px: 2, mt: '-28px' }}>
            <Box sx={{ width: 56, height: 56, borderRadius: '50%', overflow: 'hidden', display: 'grid', placeItems: 'center', bgcolor: brand.cream, color: brand.brown, border: `3px solid ${neutral.surface}` }}>
              {profile.logo_url ? (
                <Box component="img" src={profile.logo_url} alt="" sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              ) : (
                <Box component="span" aria-hidden="true" sx={{ fontFamily: fontFamily.display, fontSize: 18, lineHeight: 1 }}>
                  {initials(brandName)}
                </Box>
              )}
            </Box>
            <Typography component="p" sx={{ fontFamily: fontFamily.display, fontSize: '1.375rem', lineHeight: 1.2, letterSpacing: '-0.2px', mt: 1, overflowWrap: 'anywhere' }}>
              {brandName}
            </Typography>
            {profile.tagline && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>
                {profile.tagline}
              </Typography>
            )}
            <Stack direction="row" sx={{ flexWrap: 'wrap', columnGap: 1.5, rowGap: 0.5, mt: 1.5, color: brand.brown }}>
              {city && <Meta icon={MapPin}>{city}</Meta>}
              <Meta icon={Clock}>{dispatchLabel(profile.dispatch_time)}</Meta>
              <Meta icon={RotateCcw}>{returnsLabel(profile.return_policy)}</Meta>
            </Stack>
            {profile.story && (
              <Typography variant="body2" sx={{ mt: 1.5, whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>
                {profile.story}
              </Typography>
            )}
          </Box>
        </Box>
      </Box>
      {note && (
        <Typography variant="caption" color="text.secondary" component="p" sx={{ textAlign: 'center', mt: 1.5 }}>
          {note}
        </Typography>
      )}
    </Box>
  )
}
