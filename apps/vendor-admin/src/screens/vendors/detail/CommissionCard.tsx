import { zodResolver } from '@hookform/resolvers/zod'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, InputAdornment, Stack, TextField, Typography, useMediaQuery } from '@mui/material'
import type { Theme } from '@mui/material/styles'
import { fontFamily, SectionCard, StatusPill } from '@shazlo/ui'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { ApiError } from '../../../api/http'
import { useCommissionAction } from '../../../api/queries'
import type { components } from '../../../api/schema'
import { vendorActionsCopy, vendorDetailCopy } from '../../../copy/vendors'
import { formatRate, lastSentBack, rateField, rateText, sameCommission, toBps } from '../../../lib/commission'
import { formatDate } from '../../../lib/format'
import { fieldProps, noAsterisk } from '../../../lib/forms'
import { dialogActions, usePhone } from '../../../lib/responsive'
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
function SetRateDialog({ open, title, initial, onCancel, onSubmit, onExited }: { open: boolean; title: string; initial: string; onCancel: () => void; onSubmit: (values: { bps: number; note: string }) => Promise<SetErrors | void>; onExited?: () => void }) {
  const titleId = useId()
  const bodyId = useId()
  // A phone gets the whole screen: the keyboard takes half of it.
  const phone = usePhone()
  const { register, handleSubmit, reset, setError, setFocus, formState } = useForm<SetValues>({ resolver: zodResolver(setSchema), defaultValues: { rate: initial, note: '' } })
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
    // As in ReasonDialog: autoFocus loses to the focus trap, so the rate field is focused on entering.
    <Dialog open={open} onClose={busy ? undefined : onCancel} aria-labelledby={titleId} aria-describedby={bodyId} maxWidth="sm" fullWidth fullScreen={phone} slotProps={{ transition: { onEntering: () => setFocus('rate'), onExited } }}>
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
              // The box stays narrow; its hint and errors use the dialog's width.
              sx={{ '& .MuiInputBase-root': { maxWidth: { sm: 240 } } }}
              slotProps={{
                ...noAsterisk,
                htmlInput: { inputMode: 'decimal', enterKeyHint: 'done', style: tabular },
                input: { endAdornment: <InputAdornment position="end">%</InputAdornment> },
              }}
            />
            <TextField {...fieldProps(register('note'), formState.errors.note, w.noteHint)} label={w.note} multiline minRows={2} disabled={busy} />
          </Stack>
        </DialogContent>
        <DialogActions sx={dialogActions}>
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
  const c = vendor.commission
  const name = vendor.brand_name
  const agreed = c.agreed_bps
  const proposed = c.proposed_bps
  const now = agreed == null ? copy.noneYet : copy.now(formatRate(agreed))

  // Kept after closing (open: false) so the dialog keeps its words while it fades out. It also keeps
  // the rates as they were when it opened: the vendor may refetch while the reviewer writes, and the
  // note is about the proposal they saw (and the rate field must not reset under them).
  const [dialog, setDialog] = useState<{ kind: 'send-back' | 'set'; open: boolean; proposed: number | null; agreed: number | null } | null>(null)
  const close = () => setDialog((d) => d && { ...d, open: false })

  // One decision per commission the reviewer saw. `disabled` only lands on the next render, so a
  // double click (or Enter pressed twice) would otherwise send a second request: while the first is
  // still in flight (`busy`), or after it finished but before the new commission is drawn
  // (`decided`: the commission a handler's render showed, now out of date). That second request was
  // a duplicate rate change, or a 409 whose error banner hid the success. A decision the API answers
  // with the commission unchanged (an idempotent save) decides nothing, so it blocks nothing: the
  // data stays identical and would otherwise leave the card ignoring every later click.
  const decided = useRef<typeof c | null>(null)
  const settle = (next: Vendor) => {
    if (!sameCommission(next.commission, c)) decided.current = c
  }
  const busy = useRef(false)
  // The card's buttons, and whether a decision is waiting to hand focus back to them (below).
  const actions = useRef<HTMLDivElement>(null)
  const refocus = useRef(false)
  const once = async <T,>(run: () => Promise<T>): Promise<T | undefined> => {
    if (busy.current || decided.current === c) return undefined
    busy.current = true
    try {
      return await run()
    } finally {
      busy.current = false
    }
  }

  // A decision swaps the card's buttons (Approve becomes Change rate; Send back goes), so the button
  // that had keyboard focus, or the one a dialog would return focus to, is gone and focus falls to
  // the page. Put it on the card's first action instead, but only if it was lost (on the page, or
  // still inside a dialog that is going away): never take it from somewhere the reviewer moved it.
  const restoreFocus = () => {
    const doc = actions.current?.ownerDocument
    const active = doc?.activeElement
    if (doc && (!active || active === doc.body || active.closest('[role="dialog"]'))) actions.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }
  // Approve has no dialog: once the new card is drawn. A dialog's decision waits until the dialog has
  // gone (its onExited), as closing returns focus to the button that opened it, if that still exists.
  useEffect(() => {
    if (!refocus.current) return
    refocus.current = false
    restoreFocus()
  }, [c])

  // Approve and send back name the proposal the reviewer saw, so neither lands on a rate the brand changed since.
  const approve = () =>
    once(async () => {
      if (proposed == null) return
      refocus.current = true
      try {
        settle(await action.mutateAsync({ step: 'approve', body: { proposed_bps: proposed } }))
        onDone(copy.approveBanner(name, formatRate(proposed)), copy.approveDone(name, formatRate(proposed)))
      } catch (error) {
        onFailed(error as Error)
      }
    })

  const sendBack = (note: string) =>
    once(async () => {
      // The proposal shown when the dialog opened: the note is about that one.
      const seen = dialog?.proposed
      if (seen == null) return
      try {
        settle(await action.mutateAsync({ step: 'send-back', body: { note, proposed_bps: seen } }))
        close()
        onDone(copy.sendBackDialog.banner(name, vendor.owner_name), copy.sendBackDialog.done(name))
      } catch (error) {
        if (error instanceof ApiError && error.status === 422 && error.fields.note) return error.fields.note
        close()
        onFailed(error as Error)
      }
    })

  const setRate = ({ bps, note }: { bps: number; note: string }): Promise<SetErrors | void> =>
    once(async () => {
      try {
        settle(await action.mutateAsync({ step: 'set', body: note ? { commission_bps: bps, note } : { commission_bps: bps } }))
        close()
        onDone(copy.setDialog.banner(name, formatRate(bps)), copy.setDialog.done(name, formatRate(bps)))
      } catch (error) {
        if (error instanceof ApiError && error.status === 422 && (error.fields.commission_bps || error.fields.note)) return { rate: error.fields.commission_bps, note: error.fields.note }
        close()
        onFailed(error as Error)
      }
    })

  const open = (kind: 'send-back' | 'set') => setDialog({ kind, open: true, proposed, agreed })
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
    const sentBy = lastSentBack(vendor.history)
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
            {sentBy ? (
              <Typography variant="caption" color="text.secondary">
                {copy.noteFrom(sentBy.by, formatDate(sentBy.at))}
              </Typography>
            ) : (
              c.updated_at && (
                <Typography variant="caption" color="text.secondary">
                  {copy.noteOn(formatDate(c.updated_at))}
                </Typography>
              )
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
        ref={actions}
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
          body={copy.sendBackDialog.body(dialog.agreed == null ? null : formatRate(dialog.agreed))}
          label={copy.sendBackDialog.label}
          confirm={copy.sendBackDialog.confirm}
          pending={copy.sendBackDialog.pending}
          onCancel={close}
          onSubmit={sendBack}
          onExited={restoreFocus}
        />
      )}
      {dialog?.kind === 'set' && (
        <SetRateDialog
          open={dialog.open}
          title={dialog.agreed == null ? copy.setDialog.titleSet(name) : copy.setDialog.titleChange(name)}
          initial={rateText(dialog.agreed)}
          onCancel={close}
          onSubmit={setRate}
          onExited={restoreFocus}
        />
      )}
    </SectionCard>
  )
}
