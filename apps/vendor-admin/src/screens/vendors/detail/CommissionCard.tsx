import { zodResolver } from '@hookform/resolvers/zod'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, InputAdornment, Stack, TextField, Typography, useMediaQuery } from '@mui/material'
import type { Theme } from '@mui/material/styles'
import { fontFamily, SectionCard, StatusPill } from '@shazlo/ui'
import { useEffect, useId, useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { ApiError } from '../../../api/http'
import { useCommissionAction } from '../../../api/queries'
import type { components } from '../../../api/schema'
import { vendorActionsCopy, vendorDetailCopy } from '../../../copy/vendors'
import { formatRate, rateField, rateText, toBps } from '../../../lib/commission'
import { formatDate } from '../../../lib/format'
import { fieldProps, noAsterisk } from '../../../lib/forms'
import { usePhone } from '../../../lib/responsive'
import { Quote } from '../../review/parts'
import { ReasonDialog } from '../dialogs'

const copy = vendorDetailCopy.commission
const NOTE_MAX = 600
type Vendor = components['schemas']['VendorDetail']

const tabular = { fontVariantNumeric: 'lining-nums tabular-nums' } as const

// The rate in force, large: "12%" over "of each sale".
function Rate({ bps }: { bps: number }) {
  return (
    <Box>
      <Typography variant="stat" component="p" sx={{ ...tabular, fontFamily: fontFamily.display }}>
        {formatRate(bps)}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {copy.ofEachSale}
      </Typography>
    </Box>
  )
}

const setSchema = z.object({ rate: rateField, note: z.string().trim().max(NOTE_MAX, copy.setDialog.noteLong) })
type SetValues = z.infer<typeof setSchema>
type SetErrors = Partial<Record<keyof SetValues, string>>

// Shazlo enters the rate itself: the rate in percent and an optional note the brand reads.
function SetRateDialog({ open, title, initial, onCancel, onSubmit }: { open: boolean; title: string; initial: string; onCancel: () => void; onSubmit: (values: { bps: number; note: string }) => Promise<SetErrors | void> }) {
  const titleId = useId()
  const bodyId = useId()
  // A phone gets the whole screen: the keyboard takes half of it.
  const phone = usePhone()
  const { register, handleSubmit, reset, setError, formState } = useForm<SetValues>({ resolver: zodResolver(setSchema), defaultValues: { rate: initial, note: '' } })
  const busy = formState.isSubmitting
  const w = copy.setDialog

  useEffect(() => {
    if (open) reset({ rate: initial, note: '' })
  }, [open, initial, reset])

  const submit = handleSubmit(async ({ rate, note }) => {
    const problems = await onSubmit({ bps: toBps(rate), note: note.trim() })
    if (!problems) return
    if (problems.rate) setError('rate', { type: 'server', message: problems.rate }, { shouldFocus: true })
    if (problems.note) setError('note', { type: 'server', message: problems.note }, { shouldFocus: !problems.rate })
  })

  return (
    <Dialog open={open} onClose={busy ? undefined : onCancel} aria-labelledby={titleId} aria-describedby={bodyId} maxWidth="sm" fullWidth fullScreen={phone}>
      <form noValidate onSubmit={submit}>
        <DialogTitle id={titleId} variant="h2" component="h2" sx={{ pb: 1, overflowWrap: 'anywhere' }}>
          {title}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2.5}>
            <DialogContentText id={bodyId} variant="body1">
              {w.body}
            </DialogContentText>
            <TextField
              {...fieldProps(register('rate'), formState.errors.rate, w.rateHint)}
              label={w.rate}
              required
              autoFocus
              autoComplete="off"
              disabled={busy}
              sx={{ maxWidth: { sm: 240 } }}
              slotProps={{
                ...noAsterisk,
                htmlInput: { inputMode: 'decimal', enterKeyHint: 'done', style: tabular },
                input: { endAdornment: <InputAdornment position="end">%</InputAdornment> },
              }}
            />
            <TextField {...fieldProps(register('note'), formState.errors.note, w.noteHint)} label={w.note} multiline minRows={2} disabled={busy} />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: { xs: 2, sm: 3 }, pb: 'calc(20px + env(safe-area-inset-bottom, 0px))', gap: 1, flexDirection: { xs: 'column-reverse', sm: 'row' }, alignItems: { xs: 'stretch', sm: 'center' }, '& > :not(style) ~ :not(style)': { ml: { xs: 0, sm: 1 } }, '& .MuiButton-root': { minHeight: { xs: 44, sm: 0 } } }}>
          <Button variant="text" onClick={onCancel} disabled={busy}>
            {vendorActionsCopy.cancel}
          </Button>
          <Button type="submit" variant="contained" disabled={busy}>
            {busy ? w.pending : w.confirm}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

type Props = {
  vendor: Vendor
  // Whether this card may hold the page's one primary button (not while the header has one).
  primary: boolean
  onDone: (banner: string, toast: string) => void
  onFailed: (error: Error) => void
}

// A-09 for approved brands: the commission in its state (spec §6). A waiting proposal is approved,
// sent back with a note, or replaced by a rate Shazlo sets; an agreed rate can be changed.
export function CommissionCard({ vendor, primary, onDone, onFailed }: Props) {
  const action = useCommissionAction(vendor.id)
  // Side by side only where the card is a full-width row (600–899 px); stacked in the side column and on phones.
  const row = useMediaQuery((theme: Theme) => theme.breakpoints.only('sm'), { noSsr: true })
  // Kept after closing (open: false) so the dialog keeps its words while it fades out.
  const [dialog, setDialog] = useState<{ kind: 'send-back' | 'set'; open: boolean } | null>(null)
  const close = () => setDialog((d) => d && { ...d, open: false })

  const c = vendor.commission
  const name = vendor.brand_name
  const agreed = c.agreed_bps
  const proposed = c.proposed_bps
  const now = agreed == null ? copy.noneYet : copy.now(formatRate(agreed))

  const approve = async () => {
    if (proposed == null) return
    try {
      await action.mutateAsync({ step: 'approve' })
      onDone(copy.approveBanner(name, formatRate(proposed)), copy.approveDone(name, formatRate(proposed)))
    } catch (error) {
      onFailed(error as Error)
    }
  }

  const sendBack = async (note: string) => {
    try {
      await action.mutateAsync({ step: 'send-back', body: { note } })
      close()
      onDone(copy.sendBackDialog.banner(name, vendor.owner_name), copy.sendBackDialog.done(name))
    } catch (error) {
      if (error instanceof ApiError && error.status === 422 && error.fields.note) return error.fields.note
      close()
      onFailed(error as Error)
    }
  }

  const setRate = async ({ bps, note }: { bps: number; note: string }): Promise<SetErrors | void> => {
    try {
      await action.mutateAsync({ step: 'set', body: note ? { commission_bps: bps, note } : { commission_bps: bps } })
      close()
      onDone(copy.setDialog.banner(name, formatRate(bps)), copy.setDialog.done(name, formatRate(bps)))
    } catch (error) {
      if (error instanceof ApiError && error.status === 422 && (error.fields.commission_bps || error.fields.note)) return { rate: error.fields.commission_bps, note: error.fields.note }
      close()
      onFailed(error as Error)
    }
  }

  const open = (kind: 'send-back' | 'set') => setDialog({ kind, open: true })
  const main = primary ? 'contained' : 'outlined'
  const setLabel = agreed == null ? copy.set : copy.change

  let pill: ReactNode = null
  let body: ReactNode
  let buttons: ReactNode
  if (c.state === 'proposed' && proposed != null) {
    pill = <StatusPill status="pending" label={copy.proposedPill} />
    body = (
      <>
        <Typography variant="body1">{copy.proposed(name, formatRate(proposed))}</Typography>
        <Typography variant="body2" color="text.secondary">
          {now}
        </Typography>
        {c.updated_at && (
          <Typography variant="caption" color="text.secondary">
            {copy.proposedOn(formatDate(c.updated_at))}
          </Typography>
        )}
      </>
    )
    buttons = (
      <>
        <Button variant={main} onClick={() => void approve()} disabled={action.isPending}>
          {action.isPending ? copy.approving : copy.approve(formatRate(proposed))}
        </Button>
        <Button variant="outlined" onClick={() => open('send-back')} disabled={action.isPending}>
          {copy.sendBack}
        </Button>
        <Button variant="text" onClick={() => open('set')} disabled={action.isPending}>
          {copy.setDifferent}
        </Button>
      </>
    )
  } else if (c.state === 'sent_back') {
    pill = <StatusPill status="sentBack" label={copy.sentBackPill} />
    body = (
      <>
        <Typography variant="body1">{copy.sentBack}</Typography>
        {proposed != null && (
          <Typography variant="body2" color="text.secondary">
            {copy.theyProposed(formatRate(proposed))}
          </Typography>
        )}
        <Typography variant="body2" color="text.secondary">
          {now}
        </Typography>
        {c.note && (
          <Box>
            {c.updated_at && (
              <Typography variant="caption" color="text.secondary">
                {copy.yourNote(formatDate(c.updated_at))}
              </Typography>
            )}
            <Quote>{c.note}</Quote>
          </Box>
        )}
      </>
    )
    buttons = (
      <Button variant="outlined" onClick={() => open('set')}>
        {setLabel}
      </Button>
    )
  } else if (agreed != null) {
    body = (
      <>
        <Rate bps={agreed} />
        {c.updated_at && (
          <Typography variant="caption" color="text.secondary">
            {copy.since(formatDate(c.updated_at))}
          </Typography>
        )}
        {c.note && (
          <Box>
            <Typography variant="caption" color="text.secondary">
              {copy.agreedNote}
            </Typography>
            <Quote>{c.note}</Quote>
          </Box>
        )}
      </>
    )
    buttons = (
      <Button variant="outlined" onClick={() => open('set')}>
        {copy.change}
      </Button>
    )
  } else {
    body = <Typography variant="body1">{copy.notSet}</Typography>
    buttons = (
      <Button variant={main} onClick={() => open('set')}>
        {copy.set}
      </Button>
    )
  }

  return (
    <SectionCard title={copy.title} action={pill}>
      <Stack spacing={1} sx={{ maxWidth: '68ch' }}>
        {body}
      </Stack>
      <Stack
        role="group"
        aria-label={copy.actionsLabel}
        data-layout={row ? 'row' : 'stacked'}
        direction={row ? 'row' : 'column'}
        spacing={1.25}
        useFlexGap
        sx={{ mt: 2.5, flexWrap: 'wrap', '& .MuiButton-root': { minHeight: { xs: 44, md: 0 }, ...(row ? null : { width: '100%' }) } }}
      >
        {buttons}
      </Stack>
      {dialog?.kind === 'send-back' && (
        <ReasonDialog
          open={dialog.open}
          title={copy.sendBackDialog.title(name)}
          body={copy.sendBackDialog.body(agreed == null ? null : formatRate(agreed))}
          label={copy.sendBackDialog.label}
          confirm={copy.sendBackDialog.confirm}
          pending={copy.sendBackDialog.pending}
          onCancel={close}
          onSubmit={sendBack}
        />
      )}
      {dialog?.kind === 'set' && (
        <SetRateDialog
          open={dialog.open}
          title={agreed == null ? copy.setDialog.titleSet(name) : copy.setDialog.titleChange(name)}
          initial={rateText(agreed)}
          onCancel={close}
          onSubmit={setRate}
        />
      )}
    </SectionCard>
  )
}
