import { Box } from '@mui/material'
import monogram from '../assets/shazlo-monogram.png'
import wordmark from '../assets/shazlo-wordmark.png'
import { brand, fontFamily, neutral, radius } from '../tokens'

// The brand marks are single-colour alpha masks cut from the brand kit (Drive, 22 Nov 2026), so
// one file draws in any brand colour: navy on light pages, amber on navy.
export type LogoTone = 'navy' | 'amber' | 'ink' | 'offWhite'
const toneColour: Record<LogoTone, string> = { navy: brand.navy, amber: brand.amber, ink: neutral.ink, offWhite: brand.offWhite }

// Source sizes of the masks, so width follows height without a layout jump.
const WORDMARK = { w: 312, h: 93 }
const MONOGRAM = { w: 126, h: 159 }

function maskStyle(src: string, colour: string) {
  return {
    backgroundColor: colour,
    maskImage: `url(${src})`,
    WebkitMaskImage: `url(${src})`,
    maskSize: 'contain',
    WebkitMaskSize: 'contain',
    maskRepeat: 'no-repeat',
    WebkitMaskRepeat: 'no-repeat',
    maskPosition: 'center',
    WebkitMaskPosition: 'center',
    flexShrink: 0,
  } as const
}

// The Shazlo wordmark plus the product tag ("Seller", "One").
export function Logo({ product, height = 30, tone = 'navy' }: { product?: string; height?: number; tone?: LogoTone }) {
  const width = Math.round((height * WORDMARK.w) / WORDMARK.h)
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
      <Box role="img" aria-label="Shazlo" data-tone={tone} style={{ width, height }} sx={{ display: 'block', ...maskStyle(wordmark, toneColour[tone]) }} />
      {product && (
        <Box
          component="span"
          sx={{
            fontFamily: fontFamily.display,
            fontWeight: 600,
            fontSize: 11,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: tone === 'navy' || tone === 'ink' ? brand.brown : brand.amber,
            border: `1px solid ${tone === 'navy' || tone === 'ink' ? neutral.lineStrong : 'rgba(250, 182, 42, 0.6)'}`,
            borderRadius: `${radius.control - 2}px`,
            px: 0.75,
            lineHeight: '18px',
          }}
        >
          {product}
        </Box>
      )}
    </Box>
  )
}

// The S monogram, for tight spaces (collapsed bars, avatars of the brand itself).
export function Monogram({ size = 24, tone = 'navy', decorative = false }: { size?: number; tone?: LogoTone; decorative?: boolean }) {
  const width = Math.round((size * MONOGRAM.w) / MONOGRAM.h)
  return (
    <Box
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': 'Shazlo' })}
      data-tone={tone}
      style={{ width: size, height: size }}
      sx={{ display: 'inline-block', ...maskStyle(monogram, toneColour[tone]), maskSize: `${width}px ${size}px`, WebkitMaskSize: `${width}px ${size}px` }}
    />
  )
}
