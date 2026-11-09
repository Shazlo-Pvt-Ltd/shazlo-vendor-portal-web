import { StatusBadge } from '@shazlo/ui/components'
import type { Vendor, VendorStatus } from '../../api'
import { useSuspendVendor } from '../../api'
import { useShell } from '../../app/shell'
import { ReasonDialog } from '../shared/ReasonDialog'

export const vendorStatusLabel: Record<VendorStatus, string> = {
  applied: 'Applied',
  under_review: 'Under review',
  approved: 'Approved',
  rejected: 'Rejected',
  suspended: 'Suspended',
}

export function VendorStatusBadge({ status }: { status: VendorStatus }) {
  const label = vendorStatusLabel[status]
  if (status === 'applied' || status === 'under_review') return <StatusBadge tone="pending" icon="clock">{label}</StatusBadge>
  if (status === 'approved') return <StatusBadge tone="approved">{label}</StatusBadge>
  if (status === 'rejected') return <StatusBadge tone="rejected">{label}</StatusBadge>
  return <StatusBadge tone="suspended">{label}</StatusBadge>
}

export const needsDecision = (v: Pick<Vendor, 'status'>) => v.status === 'applied' || v.status === 'under_review'

/** Suspending needs a reason (A-09 notes); vendor-api then sends vendor.status_changed. */
export function SuspendDialog({ vendor, open, onClose }: { vendor: Pick<Vendor, 'id' | 'brand'>; open: boolean; onClose: () => void }) {
  const { toast } = useShell()
  const suspend = useSuspendVendor()
  return (
    <ReasonDialog
      open={open}
      onClose={() => { suspend.reset(); onClose() }}
      title={`Suspend ${vendor.brand}`}
      subtitle="Hides all of their products from the app"
      messageLabel="Reason (required)"
      helper="Saved in the audit trail and shown to the vendor"
      consequence={`All of ${vendor.brand}’s products leave the app within minutes. Open orders are not touched, and you can reactivate them later.`}
      confirmLabel="Suspend vendor"
      confirmIcon="ban"
      pending={suspend.isPending}
      error={suspend.error?.message ?? null}
      onConfirm={({ message }) => suspend.mutate({ id: vendor.id, message }, {
        onSuccess: () => { suspend.reset(); onClose(); toast('success', `${vendor.brand} is suspended. Their products leave the app within minutes.`) },
        onError: e => toast('error', e.message),
      })}
    />
  )
}
