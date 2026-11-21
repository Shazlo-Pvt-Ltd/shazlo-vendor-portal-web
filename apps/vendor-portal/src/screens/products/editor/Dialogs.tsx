import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Typography } from '@mui/material'
import { radius } from '@shazlo/ui'
import { useId } from 'react'
import { productEditorCopy } from '../../../copy/productEditor'

const copy = productEditorCopy
const paper = { paper: { sx: { borderRadius: `${radius.sheet}px`, maxWidth: 440 } } } as const

// Asked when the seller leaves with something not saved. Staying is the main (yellow) button:
// it is the safe choice.
export function LeaveDialog({ open, reasons, onStay, onLeave }: { open: boolean; reasons: string[]; onStay: () => void; onLeave: () => void }) {
  const titleId = useId()
  const bodyId = useId()
  return (
    <Dialog open={open} onClose={onStay} aria-labelledby={titleId} aria-describedby={bodyId} slotProps={paper}>
      <DialogTitle id={titleId} sx={{ typography: 'h2', pt: 3 }}>
        {copy.leave.title}
      </DialogTitle>
      <DialogContent>
        <DialogContentText id={bodyId} component="div" sx={{ color: 'text.primary' }}>
          {reasons.map((reason) => (
            <Typography key={reason} variant="body1">
              {reason}
            </Typography>
          ))}
          <Typography variant="body1" sx={{ mt: 1 }}>
            {copy.leave.lost}
          </Typography>
        </DialogContentText>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
        <Button variant="text" onClick={onLeave}>
          {copy.leave.leave}
        </Button>
        <Button variant="contained" onClick={onStay}>
          {copy.leave.stay}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// Delete or archive, with main's rules in the words (../deleteOutcome.ts).
export function DeleteDialog({ open, title, body, confirm, pending, error, onCancel, onConfirm }: { open: boolean; title: string; body: string; confirm: string; pending: boolean; error: string | null; onCancel: () => void; onConfirm: () => void }) {
  const titleId = useId()
  const bodyId = useId()
  return (
    <Dialog open={open} onClose={() => !pending && onCancel()} aria-labelledby={titleId} aria-describedby={bodyId} slotProps={paper}>
      <DialogTitle id={titleId} sx={{ typography: 'h2', pt: 3, overflowWrap: 'anywhere' }}>
        {title}
      </DialogTitle>
      <DialogContent>
        <DialogContentText id={bodyId} sx={{ color: 'text.primary' }}>
          {body}
        </DialogContentText>
        {error && (
          <Typography role="alert" variant="body2" color="error.main" sx={{ mt: 1.5 }}>
            {error}
          </Typography>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
        <Button variant="outlined" onClick={onCancel} disabled={pending}>
          {copy.archive.cancel}
        </Button>
        <Button variant="contained" color="error" onClick={onConfirm} disabled={pending}>
          {pending ? copy.archive.working : confirm}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
