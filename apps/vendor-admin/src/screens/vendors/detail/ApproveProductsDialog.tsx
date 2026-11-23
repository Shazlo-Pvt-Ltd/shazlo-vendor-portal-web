import { Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Stack, Typography } from '@mui/material'
import { Banner, emphasis, neutral, status } from '@shazlo/ui'
import { useId } from 'react'
import type { components } from '../../../api/schema'
import { vendorActionsCopy, vendorDetailCopy } from '../../../copy/vendors'
import { formatINR } from '../../../lib/format'
import { usePhone } from '../../../lib/responsive'

const copy = vendorDetailCopy.products.bulk.dialog
type Product = components['schemas']['VendorDetail']['products'][number]

type Props = {
  open: boolean
  brand: string
  // The products as the reviewer saw them when they opened the dialog: these are what is sent.
  products: Product[]
  sending: boolean
  // Why the last attempt did not go through; the dialog stays open so they can try again.
  failure: string | null
  onCancel: () => void
  onConfirm: () => void
  // Once it has faded out, so focus can move without the dialog taking it back.
  onExited?: () => void
}

// Says what approving several products at once does, and lists each one with its price (and any
// required photos it lacks), so the reviewer sees exactly what goes live. Full screen on phones,
// like the other dialogs with a list.
export function ApproveProductsDialog({ open, brand, products, sending, failure, onCancel, onConfirm, onExited }: Props) {
  const titleId = useId()
  const bodyId = useId()
  const phone = usePhone()
  const k = products.length

  return (
    <Dialog open={open} onClose={sending ? undefined : onCancel} aria-labelledby={titleId} aria-describedby={bodyId} maxWidth="sm" fullWidth fullScreen={phone} slotProps={{ transition: { onExited } }}>
      <DialogTitle id={titleId} variant="h2" component="h2" sx={{ pb: 1, overflowWrap: 'anywhere' }}>
        {copy.title(k, brand)}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <DialogContentText id={bodyId} variant="body1">
            {copy.body(k)}
          </DialogContentText>
          <Box component="ul" aria-label={copy.label} sx={{ listStyle: 'none', p: 0, m: 0, borderTop: `1px solid ${neutral.line}` }}>
            {products.map((product) => (
              <Stack key={product.id} component="li" direction="row" spacing={2} sx={{ alignItems: 'baseline', py: 1.25, borderBottom: `1px solid ${neutral.line}` }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body1" sx={{ ...emphasis.semibold, overflowWrap: 'break-word' }}>
                    {product.title}
                  </Typography>
                  {/* Approving here skips the review page's photo check, so say what it would flag. */}
                  {product.photos_missing > 0 && (
                    <Typography variant="body2" sx={{ color: status.error, mt: 0.25 }}>
                      {copy.photosMissing(product.photos_missing)}
                    </Typography>
                  )}
                </Box>
                <Typography variant="body1" sx={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                  {formatINR(product.price_paise)}
                </Typography>
              </Stack>
            ))}
          </Box>
        </Stack>
      </DialogContent>
      {/* Outside the scrolling list, so it shows beside the buttons however long the list is. */}
      {failure && (
        <Box sx={{ px: { xs: 2, sm: 3 }, pt: 1 }}>
          <Banner tone="error" title={vendorActionsCopy.failed}>
            {failure}
          </Banner>
        </Box>
      )}
      <DialogActions sx={{ px: { xs: 2, sm: 3 }, pb: 'calc(20px + env(safe-area-inset-bottom, 0px))', gap: 1, flexDirection: { xs: 'column-reverse', sm: 'row' }, alignItems: { xs: 'stretch', sm: 'center' }, '& > :not(style) ~ :not(style)': { ml: { xs: 0, sm: 1 } }, '& .MuiButton-root': { minHeight: { xs: 44, sm: 0 } } }}>
        <Button variant="text" onClick={onCancel} disabled={sending}>
          {vendorActionsCopy.cancel}
        </Button>
        <Button variant="contained" onClick={onConfirm} disabled={sending}>
          {sending ? copy.pending : copy.confirm(k)}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
