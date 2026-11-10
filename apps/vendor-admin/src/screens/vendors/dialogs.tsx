import { zodResolver } from '@hookform/resolvers/zod'
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Stack, TextField } from '@mui/material'
import { useEffect, useId } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { ApiError } from '../../api/http'
import { useVendorAction } from '../../api/queries'
import type { components } from '../../api/schema'
import { REASON_MIN, vendorActionsCopy } from '../../copy/vendors'
import { fieldProps } from '../../lib/forms'
import { usePhone } from '../../lib/responsive'

const copy = vendorActionsCopy
type VendorDetail = components['schemas']['VendorDetail']

const reasonSchema = z.object({ text: z.string().trim().min(REASON_MIN, copy.reasonShort) })
type ReasonValues = z.infer<typeof reasonSchema>

type ReasonProps = {
  open: boolean
  title: string
  body: string
  label: string
  confirm: string
  pending: string
  onCancel: () => void
  // Resolves with a message to show on the field when the API rejects the text itself.
  onSubmit: (text: string) => Promise<string | void>
}

// A consequential action that needs words: says what happens next, and the reason is required.
export function ReasonDialog({ open, title, body, label, confirm, pending, onCancel, onSubmit }: ReasonProps) {
  const titleId = useId()
  const bodyId = useId()
  const { register, handleSubmit, reset, setError, formState } = useForm<ReasonValues>({ resolver: zodResolver(reasonSchema), defaultValues: { text: '' } })
  const busy = formState.isSubmitting
  const phone = usePhone()

  useEffect(() => {
    if (open) reset({ text: '' })
  }, [open, reset])

  const submit = handleSubmit(async ({ text }) => {
    const fieldError = await onSubmit(text.trim())
    if (fieldError) setError('text', { type: 'server', message: fieldError }, { shouldFocus: true })
  })

  return (
    <Dialog open={open} onClose={busy ? undefined : onCancel} aria-labelledby={titleId} aria-describedby={bodyId} maxWidth="sm" fullWidth fullScreen={phone}>
      <form noValidate onSubmit={submit}>
        <DialogTitle id={titleId} variant="h2" component="h2" sx={{ pb: 1 }}>
          {title}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2.5}>
            <DialogContentText id={bodyId} variant="body1">
              {body}
            </DialogContentText>
            <TextField {...fieldProps(register('text'), formState.errors.text, copy.reasonHint)} label={label} multiline minRows={3} required autoFocus disabled={busy} />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
          <Button variant="text" onClick={onCancel} disabled={busy}>
            {copy.cancel}
          </Button>
          <Button type="submit" variant="contained" disabled={busy}>
            {busy ? pending : confirm}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

type ConfirmProps = { open: boolean; title: string; body: string; confirm: string; pendingLabel: string; pending: boolean; onCancel: () => void; onConfirm: () => void }

export function ConfirmDialog({ open, title, body, confirm, pendingLabel, pending, onCancel, onConfirm }: ConfirmProps) {
  const titleId = useId()
  const bodyId = useId()
  return (
    <Dialog open={open} onClose={pending ? undefined : onCancel} aria-labelledby={titleId} aria-describedby={bodyId} maxWidth="xs" fullWidth>
      <DialogTitle id={titleId} variant="h2" component="h2" sx={{ pb: 1 }}>
        {title}
      </DialogTitle>
      <DialogContent>
        <DialogContentText id={bodyId} variant="body1">
          {body}
        </DialogContentText>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
        <Button variant="text" onClick={onCancel} disabled={pending}>
          {copy.cancel}
        </Button>
        <Button variant="contained" onClick={onConfirm} disabled={pending}>
          {pending ? pendingLabel : confirm}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export type DialogKind = 'suspend' | 'reactivate' | 'reject' | 'request-info'

const reasonCopy = {
  suspend: { copy: copy.suspend, field: 'reason' },
  reject: { copy: copy.reject, field: 'reason' },
  'request-info': { copy: copy.requestInfo, field: 'message' },
} as const

type ActionProps = {
  vendor: { id: string; brand_name: string }
  kind: DialogKind
  open: boolean
  onClose: () => void
  onDone: (kind: DialogKind, vendor: VendorDetail) => void
  onFailed: (kind: DialogKind, error: Error) => void
}

// The dialog for one vendor action. Field errors stay in the dialog; anything else closes it and
// goes back to the screen (`onFailed`), which says so in a banner or a toast.
export function VendorActionDialog({ vendor, kind, open, onClose, onDone, onFailed }: ActionProps) {
  const action = useVendorAction(vendor.id)

  if (kind === 'reactivate') {
    const run = async () => {
      try {
        onDone(kind, await action.mutateAsync({ action: 'reactivate' }))
      } catch (error) {
        onFailed(kind, error as Error)
      }
    }
    return (
      <ConfirmDialog
        open={open}
        title={copy.reactivate.title(vendor.brand_name)}
        body={copy.reactivate.body}
        confirm={copy.reactivate.confirm}
        pendingLabel={copy.reactivate.pending}
        pending={action.isPending}
        onCancel={onClose}
        onConfirm={() => void run()}
      />
    )
  }

  const { copy: words, field } = reasonCopy[kind]
  const submit = async (text: string) => {
    try {
      const updated = await action.mutateAsync(kind === 'request-info' ? { action: kind, body: { message: text } } : { action: kind, body: { reason: text } })
      onDone(kind, updated)
    } catch (error) {
      if (error instanceof ApiError && error.status === 422 && error.fields[field]) return error.fields[field]
      onFailed(kind, error as Error)
    }
  }
  return <ReasonDialog open={open} title={words.title(vendor.brand_name)} body={words.body} label={words.label} confirm={words.confirm} pending={words.pending} onCancel={onClose} onSubmit={submit} />
}
