import { Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Menu, MenuItem, Stack, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { Banner, brand, radius } from '@shazlo/ui'
import { useId } from 'react'
import type { Schemas } from '../../../api/client'
import { productsCopy } from '../../../copy/products'

const copy = productsCopy
type Product = Schemas['ProductSummary']
export type BulkAction = 'submit' | 'archive'

const onNavy = {
  color: brand.offWhite,
  borderColor: alpha(brand.offWhite, 0.6),
  minHeight: 36,
  '@media (hover: hover)': { '&:hover': { borderColor: brand.offWhite, bgcolor: alpha(brand.offWhite, 0.08) } },
  // The app's navy focus ring would vanish on the navy bar.
  '&:focus-visible': { outline: `2px solid ${brand.offWhite}`, outlineOffset: 2 },
  '&.Mui-disabled': { color: alpha(brand.offWhite, 0.6), borderColor: alpha(brand.offWhite, 0.3) },
} as const

// Navy bar above the table while rows are selected (options board pick for V-06).
export function BulkBar({ count, pending, onAction, onClear }: { count: number; pending: BulkAction | null; onAction: (action: BulkAction) => void; onClear: () => void }) {
  return (
    <Box
      role="region"
      aria-label={copy.bulk.label}
      sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1.5, minHeight: 56, px: 2, py: 1, bgcolor: brand.navy, color: brand.offWhite, borderRadius: `${radius.card}px` }}
    >
      <Typography variant="body1" role="status" sx={{ fontVariantNumeric: 'tabular-nums', mr: 1 }}>
        {copy.bulk.selected(count)}
      </Typography>
      <Button variant="outlined" color="inherit" disabled={pending !== null} onClick={() => onAction('submit')} sx={onNavy}>
        {pending === 'submit' ? copy.bulk.submitting : copy.bulk.submit}
      </Button>
      <Button variant="outlined" color="inherit" disabled={pending !== null} onClick={() => onAction('archive')} sx={onNavy}>
        {pending === 'archive' ? copy.bulk.archiving : copy.bulk.archive}
      </Button>
      <Box sx={{ flex: 1 }} />
      <Button variant="text" color="inherit" onClick={onClear} sx={{ ...onNavy, textDecoration: 'underline', textUnderlineOffset: '0.2em' }}>
        {copy.bulk.clear}
      </Button>
    </Box>
  )
}

export function ArchiveDialog({ target, pending, onCancel, onConfirm }: { target: { ids: string[]; name?: string; open: boolean } | null; pending: boolean; onCancel: () => void; onConfirm: () => void }) {
  const titleId = useId()
  const bodyId = useId()
  const count = target?.ids.length ?? 0
  return (
    <Dialog open={target?.open ?? false} onClose={pending ? undefined : onCancel} aria-labelledby={titleId} aria-describedby={bodyId} maxWidth="xs" fullWidth>
      <DialogTitle id={titleId} variant="h2" component="h2" sx={{ pb: 1 }}>
        {count ? copy.archiveDialog.title(count, target?.name) : ''}
      </DialogTitle>
      <DialogContent>
        <DialogContentText id={bodyId} variant="body1">
          {copy.archiveDialog.body(count)}
        </DialogContentText>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
        <Button variant="text" onClick={onCancel} disabled={pending}>
          {copy.archiveDialog.cancel}
        </Button>
        <Button variant="contained" onClick={onConfirm} disabled={pending}>
          {pending ? copy.bulk.archiving : copy.archiveDialog.confirm}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// Only the actions that apply to the product's state are offered; nothing is shown disabled.
export function RowMenu({ target, onClose, onEdit, onAction }: { target: { anchor: HTMLElement; product: Product } | null; onClose: () => void; onEdit: (product: Product) => void; onAction: (action: BulkAction, product: Product) => void }) {
  const product = target?.product
  const canSubmit = product?.status === 'draft' || product?.status === 'rejected'
  const canArchive = product !== undefined && product.status !== 'archived'
  return (
    <Menu anchorEl={target?.anchor ?? null} open={target !== null} onClose={onClose} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
      {product && [
        <MenuItem key="edit" onClick={() => onEdit(product)}>
          {copy.menu.edit}
        </MenuItem>,
        canSubmit && (
          <MenuItem key="submit" onClick={() => onAction('submit', product)}>
            {copy.menu.submit}
          </MenuItem>
        ),
        canArchive && (
          <MenuItem key="archive" onClick={() => onAction('archive', product)}>
            {copy.menu.archive}
          </MenuItem>
        ),
      ]}
    </Menu>
  )
}

export type BulkOutcome = { tone: 'warning' | 'error'; title: string; messages: string[] }

// Products that did not go through, each with the reason the API gave.
export function OutcomeBanner({ outcome, onClose }: { outcome: BulkOutcome; onClose: () => void }) {
  return (
    <Banner tone={outcome.tone} title={outcome.title} onClose={onClose}>
      {outcome.messages.length > 0 && (
        <Stack component="ul" spacing={0.25} aria-label={copy.results.failedLabel} sx={{ m: 0, pl: 2.5 }}>
          {outcome.messages.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </Stack>
      )}
      {outcome.tone === 'warning' && <Box sx={{ mt: 0.75 }}>{copy.results.failedBody}</Box>}
    </Banner>
  )
}
