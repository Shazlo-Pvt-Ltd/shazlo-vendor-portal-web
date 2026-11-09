import { Box, Typography } from '@mui/material'
import { brand, fontFamily, radius, SectionCard } from '@shazlo/ui'
import { Check } from 'lucide-react'
import { reviewCopy } from '../../copy/review'

const copy = reviewCopy.how

// The review sequence is a real order, so the steps are numbered.
export function HowReviewWorks() {
  return (
    <SectionCard title={copy.title}>
      <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {copy.steps.map((step, i) => (
          <Box component="li" key={step.title} sx={{ display: 'flex', gap: 1.5, py: 1 }}>
            <Typography component="span" sx={{ fontFamily: fontFamily.display, fontSize: '1.125rem', lineHeight: 1.3, color: brand.brown, width: 16, flexShrink: 0, fontVariantNumeric: 'lining-nums' }}>
              {i + 1}
            </Typography>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h3" component="h3">
                {step.title}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                {step.body}
              </Typography>
            </Box>
          </Box>
        ))}
      </Box>
      <Box sx={{ mt: 2, p: 2, bgcolor: brand.cream, borderRadius: `${radius.card}px` }}>
        <Typography variant="h3" component="h3">
          {copy.checksTitle}
        </Typography>
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, mt: 1 }}>
          {copy.checks.map((check) => (
            <Box component="li" key={check} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', py: 0.5 }}>
              <Box component="span" sx={{ color: brand.brown, display: 'flex', pt: '2px', flexShrink: 0 }}>
                <Check size={16} strokeWidth={1.5} aria-hidden="true" />
              </Box>
              <Typography variant="body2">{check}</Typography>
            </Box>
          ))}
        </Box>
      </Box>
    </SectionCard>
  )
}
