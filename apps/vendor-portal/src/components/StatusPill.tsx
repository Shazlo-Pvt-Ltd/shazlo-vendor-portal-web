import { StatusPill as SharedStatusPill, type PillStatus } from '@shazlo/ui'
import { pillLabel } from '../copy/status'

// The seller's status pill: @shazlo/ui's colour and icon, with the seller's word (#267). The shared
// pill's own labels are the admin's ("Pending review", "Sent back"), so seller screens use this one
// (ESLint stops the shared pill being imported anywhere else in the app). `label` is for one-off
// words such as "Draft · 2 changes"; an empty one falls back to the seller word, never to nothing.
export function StatusPill({ status, label }: { status: PillStatus; label?: string }) {
  return <SharedStatusPill status={status} label={label || pillLabel[status]} />
}
