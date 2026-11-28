import { Box } from '@mui/material'
import { neutral } from '@shazlo/ui'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

// A card or topic title with a small outline icon in front, so the eye finds each part of a long
// page. The icon is decoration: the title's name is its words.
export function CardTitle({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'flex-start', gap: 1, minWidth: 0 }}>
      <Box component="span" data-title-icon="" sx={{ display: 'inline-flex', flexShrink: 0, color: neutral.inkSecondary, mt: '0.2em' }}>
        <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
      </Box>
      <span>{children}</span>
    </Box>
  )
}
