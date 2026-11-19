import { Box, Stack, Typography } from '@mui/material'
import { SectionCard, status } from '@shazlo/ui'
import { AlertTriangle } from 'lucide-react'
import type { ReactNode } from 'react'
import type { NamedPhotoAngle, SubmitRequirement } from '../../../lib/catalog'

// The four parts of the form, in order (spec §7). On phones each is one step.
export const STEPS = ['photos', 'about', 'sizes', 'price'] as const
export type StepKey = (typeof STEPS)[number]

// Which step holds what a send-for-review problem is about. Store details live elsewhere.
export const STEP_OF: Record<SubmitRequirement, StepKey | null> = {
  title: 'about',
  gender: 'about',
  category: 'about',
  main_colour: 'about',
  material: 'about',
  description: 'about',
  photos: 'photos',
  tryon: 'photos',
  variants: 'sizes',
  price_paise: 'price',
  store_details: null,
}

export type Problems = Partial<Record<SubmitRequirement, string>>

// Element ids a problem link moves focus to.
export const fieldId = (prefix: string, key: SubmitRequirement | 'mrp') => `${prefix}-${key}`
export const slotId = (prefix: string, angle: NamedPhotoAngle) => `${prefix}-photo-${angle}`
export const firstEmptyTryonId = (prefix: string) => `${prefix}-tryon-empty`

// A form part: a card on wider screens. On a phone step the page heading already names it, so it
// is a plain region without a card or a second heading.
export function EditorSection({ title, action, plain = false, children }: { title: string; action?: ReactNode; plain?: boolean; children: ReactNode }) {
  if (!plain) {
    return (
      <SectionCard title={title} action={action}>
        {children}
      </SectionCard>
    )
  }
  return (
    <Box component="section" aria-label={title}>
      {action && <Box sx={{ mb: 2 }}>{action}</Box>}
      {children}
    </Box>
  )
}

// A problem shown under a part of the form that is not a single text field.
export function InlineProblem({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <Stack id={id} direction="row" spacing={0.75} sx={{ alignItems: 'flex-start', color: status.error, mt: 1.5 }}>
      <AlertTriangle size={16} strokeWidth={1.75} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
      <Typography variant="body2" color="inherit">
        {children}
      </Typography>
    </Stack>
  )
}
