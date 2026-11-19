import { Alert } from '@mui/material'
import { useSession } from '../../session/AuthProvider'

/** The text a vendor sees while their application is under review. */
export const PENDING_MESSAGE =
  'Your application is under review. You can prepare your brand page and products; nothing is shown to shoppers until you are approved.'

/** Tells a pending vendor where they stand. An approved vendor sees nothing. */
export function StatusBanner() {
  const { vendor } = useSession()
  if (vendor?.status !== 'pending') {
    return null
  }
  return (
    <Alert severity="info" role="status" square sx={{ borderRadius: 0 }}>
      {PENDING_MESSAGE}
    </Alert>
  )
}
