import { Box } from '@mui/material'
import { StatusPill } from '@shazlo/ui'
import type { components } from '../../../api/schema'
import { commissionCopy } from '../../../copy/vendors'
import { formatRate, waitingProposal } from '../../../lib/commission'

// A-08's commission fact: the agreed rate, a proposal waiting for Shazlo (a pill: word and icon),
// or "Not set". A rate sent back shows the rate still in force.
export function CommissionValue({ commission }: { commission: components['schemas']['Commission'] }) {
  const proposed = waitingProposal(commission)
  if (proposed != null) return <StatusPill status="pending" label={commissionCopy.proposed(formatRate(proposed))} />
  if (commission.agreed_bps != null) {
    return (
      <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {formatRate(commission.agreed_bps)}
      </Box>
    )
  }
  return (
    <Box component="span" sx={{ color: 'text.secondary' }}>
      {commissionCopy.notSet}
    </Box>
  )
}
