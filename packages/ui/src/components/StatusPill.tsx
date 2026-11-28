import { Box } from '@mui/material'
import { Archive, Ban, Check, Clock, PencilLine, RefreshCw, X, type LucideIcon } from 'lucide-react'
import { neutral, radius, reviewStatus } from '../tokens'

export type PillStatus = 'live' | 'pending' | 'sentBack' | 'draft' | 'editInReview' | 'publishing' | 'archived' | 'suspended'

export const statusPillLabel: Record<PillStatus, string> = {
  live: 'Live',
  pending: 'Pending review',
  sentBack: 'Sent back',
  draft: 'Draft',
  editInReview: 'Edit in review',
  publishing: 'Publishing',
  archived: 'Archived',
  suspended: 'Suspended',
}

const look: Record<PillStatus, { icon: LucideIcon; foreground: string; background: string }> = {
  live: { icon: Check, ...reviewStatus.live },
  pending: { icon: Clock, ...reviewStatus.pending },
  sentBack: { icon: X, ...reviewStatus.sentBack },
  editInReview: { icon: PencilLine, ...reviewStatus.pending },
  publishing: { icon: RefreshCw, ...reviewStatus.live },
  suspended: { icon: Ban, ...reviewStatus.suspended },
  draft: { icon: PencilLine, foreground: neutral.inkSecondary, background: neutral.placeholder },
  archived: { icon: Archive, foreground: neutral.inkSecondary, background: neutral.placeholder },
}

// Status is always a word plus an icon, so it never relies on colour alone.
export function StatusPill({ status, label }: { status: PillStatus; label?: string }) {
  const { icon: Icon, foreground, background } = look[status]
  return (
    <Box
      component="span"
      data-status={status}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        height: 22,
        px: 1,
        borderRadius: `${radius.pill}px`,
        color: foreground,
        bgcolor: background,
        typography: 'caption',
        lineHeight: 1,
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      <Icon size={12} strokeWidth={2} aria-hidden="true" />
      {label ?? statusPillLabel[status]}
    </Box>
  )
}
