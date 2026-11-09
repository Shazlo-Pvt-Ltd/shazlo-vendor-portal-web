import { zodResolver } from '@hookform/resolvers/zod'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, FormControl, FormControlLabel, FormHelperText, FormLabel, Radio, RadioGroup, Stack, TextField } from '@mui/material'
import { Banner } from '@shazlo/ui'
import { useEffect, useId, useRef, useState } from 'react'
import { useController, useForm } from 'react-hook-form'
import { z } from 'zod'
import { ApiError } from '../../api/http'
import type { components } from '../../api/schema'
import { reviewCopy, type ReasonCode } from '../../copy/review'
import { fieldProps } from '../../lib/forms'

const copy = reviewCopy.sendBack
const MAX = 600
const TEMPLATES = new Set(Object.values(reviewCopy.reasons).map((r) => r.message))

const schema = z.object({
  reason_code: z.string().min(1, copy.errors.reason),
  reason: z.string().trim().min(10, copy.errors.tooShort).max(MAX, copy.errors.tooLong),
})
type Values = z.infer<typeof schema>
const EMPTY: Values = { reason_code: '', reason: '' }

type Props = { subject: string; reasons: readonly ReasonCode[]; onClose: () => void; onSubmit: (body: components['schemas']['RejectBody']) => Promise<void> }

// A-06: send an item back with a reason the seller reads word for word. Picking a reason starts the
// message from its template; the reviewer's own edits are kept if they pick another reason.
export function SendBackDialog({ open, onClose, ...props }: Props & { open: boolean }) {
  const titleId = useId()
  const bodyId = useId()
  const [busy, setBusy] = useState(false)
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} aria-labelledby={titleId} aria-describedby={bodyId} maxWidth="sm" fullWidth>
      {/* The form mounts with the dialog, so each opening starts empty. */}
      <SendBackForm {...props} onClose={onClose} titleId={titleId} bodyId={bodyId} onBusy={setBusy} />
    </Dialog>
  )
}

function SendBackForm({ subject, reasons, onClose, onSubmit, titleId, bodyId, onBusy }: Props & { titleId: string; bodyId: string; onBusy: (busy: boolean) => void }) {
  const reasonId = useId()
  const reasonErrorId = useId()
  const [failure, setFailure] = useState<string | null>(null)
  const { control, register, handleSubmit, setValue, getValues, setError, setFocus, watch, formState } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: EMPTY, shouldFocusError: false })
  const { field: reasonField } = useController({ name: 'reason_code', control })
  const firstReason = useRef<HTMLInputElement>(null)
  const length = watch('reason').length
  const pending = formState.isSubmitting

  useEffect(() => onBusy(pending), [pending, onBusy])

  const pick = (code: ReasonCode) => {
    const validate = { shouldValidate: formState.isSubmitted }
    setValue('reason_code', code, validate)
    const current = getValues('reason')
    if (!current.trim() || TEMPLATES.has(current)) setValue('reason', reviewCopy.reasons[code].message, validate)
  }

  // Focus goes to the first field with a problem, in the order they appear.
  const focusFirst = (names: (keyof Values)[]) => {
    if (names.includes('reason_code')) firstReason.current?.focus()
    else if (names.includes('reason')) setFocus('reason')
  }

  const submit = handleSubmit(async (values) => {
    setFailure(null)
    try {
      await onSubmit({ reason_code: values.reason_code as ReasonCode, reason: values.reason.trim() })
      onClose()
    } catch (error) {
      const names = error instanceof ApiError && error.status === 422 ? (['reason_code', 'reason'] as const).filter((name) => error.fields[name]) : []
      if (error instanceof ApiError && names.length > 0) {
        for (const name of names) setError(name, { message: error.fields[name] })
        focusFirst([...names])
      } else {
        setFailure(error instanceof Error ? error.message : String(error))
      }
    }
  }, (errors) => focusFirst(Object.keys(errors) as (keyof Values)[]))

  const reasonError = formState.errors.reason_code?.message
  const messageError = formState.errors.reason
  const message = fieldProps(register('reason'), messageError)

  return (
    <Box component="form" noValidate onSubmit={submit}>
      <DialogTitle id={titleId} variant="h2" component="h2" sx={{ pb: 1, overflowWrap: 'anywhere' }}>
        {copy.title(subject)}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2.5}>
          <DialogContentText id={bodyId} variant="body1">
            {copy.intro}
          </DialogContentText>
          {failure && <Banner tone="error" title={failure} />}
          <FormControl component="fieldset" error={Boolean(reasonError)} required>
            <FormLabel component="legend" id={reasonId} sx={{ mb: 0.5 }}>
              {copy.reason}
            </FormLabel>
            <RadioGroup name={reasonField.name} value={reasonField.value} onChange={(_, v) => pick(v as ReasonCode)} onBlur={reasonField.onBlur} aria-labelledby={reasonId} aria-describedby={reasonError ? reasonErrorId : undefined}>
              {reasons.map((code, i) => (
                <FormControlLabel key={code} value={code} label={reviewCopy.reasons[code].label} control={<Radio slotProps={{ input: { ref: i === 0 ? firstReason : undefined } }} />} />
              ))}
            </RadioGroup>
            {reasonError && <FormHelperText id={reasonErrorId}>{reasonError}</FormHelperText>}
          </FormControl>
          <TextField
            label={copy.message}
            multiline
            minRows={4}
            required
            {...message}
            helperText={
              <Box component="span" sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                <span>{messageError?.message ?? copy.hint}</span>
                <Box component="span" sx={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                  {copy.count(length)}
                </Box>
              </Box>
            }
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
        <Button variant="text" onClick={onClose} disabled={pending}>
          {copy.cancel}
        </Button>
        <Button type="submit" variant="contained" disabled={pending}>
          {pending ? copy.submitting : copy.submit}
        </Button>
      </DialogActions>
    </Box>
  )
}
