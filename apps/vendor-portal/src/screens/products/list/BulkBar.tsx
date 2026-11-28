import { Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Menu, MenuItem, Stack, Typography } from '@mui/material'
import { Banner, neutral, radius } from '@shazlo/ui'
import { useId } from 'react'
import type { Schemas } from '../../../api/model'
import { useProduct } from '../../../api/queries'
import { productsCopy } from '../../../copy/products'
import { bulkDeleteText, deleteOutcome, deleteText, type DeleteOutcome } from '../deleteOutcome'

const copy = productsCopy
type Product = Schemas['ProductSummary']
export type BulkAction = 'submit' | 'archive'

const barButton = { minHeight: 36 } as const

// A quiet bar above the table while rows are selected (calm rules, spec §8: no extra colour).
export function BulkBar({ count, pending, onAction, onClear }: { count: number; pending: BulkAction | null; onAction: (action: BulkAction) => void; onClear: () => void }) {
  return (
    <Box
      role="region"
      aria-label={copy.bulk.label}
      sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1.5, minHeight: 56, px: 2, py: 1, bgcolor: neutral.surface, color: neutral.ink, border: `1px solid ${neutral.lineStrong}`, borderRadius: `${radius.card}px` }}
    >
      <Typography variant="body1" role="status" sx={{ fontVariantNumeric: 'tabular-nums', mr: 1 }}>
        {copy.bulk.selected(count)}
      </Typography>
      <Button variant="outlined" disabled={pending !== null} onClick={() => onAction('submit')} sx={barButton}>
        {pending === 'submit' ? copy.bulk.submitting : copy.bulk.submit}
      </Button>
      <Button variant="outlined" disabled={pending !== null} onClick={() => onAction('archive')} sx={barButton}>
        {pending === 'archive' ? copy.bulk.archiving : copy.bulk.archive}
      </Button>
      <Box sx={{ flex: 1 }} />
      <Button variant="text" color="inherit" onClick={onClear} sx={{ ...barButton, textDecoration: 'underline', textUnderlineOffset: '0.2em' }}>
        {copy.bulk.clear}
      </Button>
    </Box>
  )
}

/** What the confirmation is about: one product from its row menu, or the selection. */
export type DeleteTarget = { products: Product[]; open: boolean }

// One product: what deleting does depends on whether it was ever sent for review, which only the
// product read in full can say for a draft (main's delete rules, ../deleteOutcome.ts).
function useOutcome(target: DeleteTarget | null): { outcome: DeleteOutcome; checking: boolean } {
  const single = target?.products.length === 1 ? target.products[0]! : null
  const draft = single?.status === 'draft' ? single : null
  // Kept while the dialog fades out, so its words do not change.
  const detail = useProduct(draft?.id)
  if (!single) return { outcome: 'unknown', checking: false }
  if (!draft) return { outcome: deleteOutcome(single), checking: false }
  if (detail.isPending) return { outcome: 'unknown', checking: true }
  return { outcome: detail.data ? deleteOutcome(detail.data) : 'unknown', checking: false }
}

export function DeleteDialog({ target, pending, onCancel, onConfirm }: { target: DeleteTarget | null; pending: boolean; onCancel: () => void; onConfirm: (outcome: DeleteOutcome) => void }) {
  const titleId = useId()
  const bodyId = useId()
  const { outcome, checking } = useOutcome(target)
  const items = target?.products ?? []
  const single = items.length === 1 ? items[0]! : null
  const text = single ? deleteText(single.title, outcome, single.status) : { ...bulkDeleteText(items), confirm: copy.deleteDialog.bulk.confirm }
  return (
    <Dialog open={target?.open ?? false} onClose={pending ? undefined : onCancel} aria-labelledby={titleId} aria-describedby={bodyId} maxWidth="xs" fullWidth>
      <DialogTitle id={titleId} variant="h2" component="h2" sx={{ pb: 1, overflowWrap: 'anywhere' }}>
        {items.length ? text.title : ''}
      </DialogTitle>
      <DialogContent>
        <DialogContentText id={bodyId} variant="body1" role={checking ? 'status' : undefined}>
          {checking ? copy.deleteDialog.checking : text.body}
        </DialogContentText>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
        <Button variant={text.confirm ? 'text' : 'outlined'} onClick={onCancel} disabled={pending}>
          {text.confirm ? copy.deleteDialog.cancel : copy.deleteDialog.close}
        </Button>
        {text.confirm && (
          <Button variant="contained" onClick={() => onConfirm(outcome)} disabled={pending || checking}>
            {pending ? copy.bulk.archiving : text.confirm}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}

// Only the actions that apply to the product's state are offered; nothing is shown disabled.
// Sending is for drafts: vendor-api refuses a sent-back product until it has been changed. Nothing
// in review can be archived until the decision.
export function RowMenu({ target, onClose, onEdit, onAction }: { target: { anchor: HTMLElement; product: Product } | null; onClose: () => void; onEdit: (product: Product) => void; onAction: (action: BulkAction, product: Product) => void }) {
  const product = target?.product
  const canSubmit = product?.status === 'draft'
  const outcome = product ? deleteOutcome(product) : 'none'
  const canDelete = outcome !== 'none' && outcome !== 'blocked'
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
        canDelete && (
          <MenuItem key="archive" onClick={() => onAction('archive', product)}>
            {product.status === 'draft' ? copy.menu.delete : copy.menu.archive}
          </MenuItem>
        ),
      ]}
    </Menu>
  )
}

export type BulkOutcome = { tone: 'success' | 'warning' | 'error'; title: string; messages: string[]; body?: string }

// What a bulk action did, in the page (no toasts, spec §8): how many went through, and the
// products that did not, each with the reason the API gave.
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
      {outcome.tone === 'warning' && outcome.body && <Box sx={{ mt: 0.75 }}>{outcome.body}</Box>}
    </Banner>
  )
}
