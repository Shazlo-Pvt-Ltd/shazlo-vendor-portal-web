import { Box, Button, InputAdornment, Skeleton, Stack, Typography } from '@mui/material'
import { neutral, radius, SectionCard } from '@shazlo/ui'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ApiError, NetworkError } from '../../api/errors'
import type { Schemas } from '../../api/model'
import { useProposeCommission } from '../../api/queries'
import { catalogCopy } from '../../copy/catalog'
import { storeCopy } from '../../copy/store'
import { keyboards, TextInput, touch } from './topics/controls'
import { checkPercent, proposedBps } from './topics/model'

const copy = storeCopy.commission

// Commission, the seller's side (spec §6). There is no default rate: until one is agreed the seller
// may propose one, and Shazlo approves it or sends it back with a note. The card sits on Store
// details with id="commission", so /store/details#commission lands on it.
export function CommissionCard({ commission }: { commission: Schemas['Commission'] | undefined }) {
  const [asking, setAsking] = useState(false)
  const [sent, setSent] = useState(false)
  const statusRef = useRef<HTMLDivElement>(null)

  // After a proposal the form goes away; focus moves to what the card now says.
  useEffect(() => {
    if (sent) statusRef.current?.focus()
  }, [sent])

  const onSent = () => {
    setAsking(false)
    setSent(true)
  }

  let body
  if (!commission) {
    body = (
      <Box role="status" aria-busy="true" aria-label={copy.title}>
        <Skeleton variant="text" width="70%" />
        <Skeleton variant="text" width="40%" />
      </Box>
    )
  } else {
    const { state, agreed_bps: agreed, proposed_bps: proposed, note } = commission
    const holding = agreed !== null && state !== 'agreed' ? <Typography variant="body2" color="textSecondary">{copy.stillAgreed(agreed)}</Typography> : null
    if (state === 'agreed' && agreed !== null) {
      body = (
        <Stack spacing={2}>
          <Typography variant="h3" component="p">
            {copy.agreed(agreed)}
          </Typography>
          {asking ? (
            <ProposeForm agreed={agreed} onSent={onSent} onCancel={() => setAsking(false)} />
          ) : (
            <Box>
              <Button variant="outlined" onClick={() => setAsking(true)} sx={touch}>
                {copy.askDifferent}
              </Button>
            </Box>
          )}
        </Stack>
      )
    } else if (state === 'proposed' && proposed !== null) {
      body = (
        <Stack spacing={1}>
          {sent && <Typography variant="body1">{copy.sent}</Typography>}
          <Typography variant="body1">{copy.proposed(proposed)}</Typography>
          {holding}
        </Stack>
      )
    } else if (state === 'sent_back') {
      body = (
        <Stack spacing={2}>
          <Typography variant="body1">{proposed !== null ? copy.sentBackWithRate(proposed) : copy.sentBack}</Typography>
          {note && (
            <Box component="figure" sx={{ m: 0, p: 2, borderRadius: `${radius.card}px`, bgcolor: neutral.placeholder }}>
              <Typography component="figcaption" variant="body2" color="textSecondary">
                {copy.note}
              </Typography>
              <Typography component="blockquote" variant="body1" sx={{ m: 0, mt: 0.5, overflowWrap: 'anywhere' }}>
                “{note}”
              </Typography>
            </Box>
          )}
          {holding}
          <Typography variant="body2" color="textSecondary">
            {copy.proposeAgain}
          </Typography>
          <ProposeForm agreed={agreed} onSent={onSent} />
        </Stack>
      )
    } else {
      body = (
        <Stack spacing={2}>
          <Typography variant="body1">{copy.notSet}</Typography>
          <ProposeForm agreed={agreed} onSent={onSent} />
        </Stack>
      )
    }
  }

  return (
    <Box id="commission" sx={{ scrollMarginTop: 72 }}>
      <SectionCard title={copy.title}>
        <Box ref={statusRef} tabIndex={-1} sx={{ outline: 'none' }}>
          {body}
        </Box>
      </SectionCard>
    </Box>
  )
}

// What went wrong, in words a seller can act on: vendor-api without the route (404, 405) is not a
// failure to retry; a network or server problem is.
function proposalFailure(error: unknown): string {
  if (error instanceof ApiError && (error.status === 404 || error.status === 405)) return copy.unavailable
  if (error instanceof ApiError && error.status < 500) return error.message
  if (error instanceof NetworkError) return error.message
  return copy.failed
}

// A rate in %, checked like the API checks it; the agreed rate stays until Shazlo answers.
function ProposeForm({ agreed, onSent, onCancel }: { agreed: number | null; onSent: () => void; onCancel?: () => void }) {
  const propose = useProposeCommission()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  // A second press while the first proposal is on its way, or after it went, sends nothing:
  // isPending and the card's new state arrive a render late.
  const sending = useRef(false)

  const problem = (value: string): string | null => {
    const bps = proposedBps(value)
    if (bps === null) return catalogCopy.errors.commission.format
    const format = checkPercent(value, 'rate').rate
    if (format) return format
    return bps === agreed ? catalogCopy.errors.commission.sameAsAgreed : null
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setFailure(null)
    const found = problem(text)
    setError(found)
    if (found) {
      document.getElementById('field-rate')?.focus()
      return
    }
    if (sending.current) return
    sending.current = true
    propose.mutate(proposedBps(text)!, {
      onSuccess: onSent,
      onError: (err) => {
        // Sent once: after a success the form goes away, so only a failure lets it send again.
        sending.current = false
        if (err instanceof ApiError && err.fields.rate_bps) setError(err.fields.rate_bps)
        else setFailure(proposalFailure(err))
      },
    })
  }

  return (
    <Box component="form" noValidate onSubmit={onSubmit} aria-label={copy.field}>
      <Box sx={{ maxWidth: 320 }}>
        <TextInput
          path="rate"
          label={copy.field}
          value={text}
          onChange={(value) => {
            setText(value)
            // A message shown stays until the rate is fixed.
            if (error) setError(problem(value))
          }}
          error={error ?? undefined}
          hint={copy.fieldHint}
          autoComplete="off"
          attrs={keyboards.decimal}
          end={<InputAdornment position="end">%</InputAdornment>}
        />
      </Box>
      {failure && (
        <Typography role="alert" variant="body2" color="error" sx={{ mt: 1 }}>
          {failure}
        </Typography>
      )}
      <Stack direction="row" spacing={1.5} sx={{ mt: 2 }}>
        <Button type="submit" variant="contained" disabled={propose.isPending} sx={touch}>
          {propose.isPending ? copy.sending : copy.send}
        </Button>
        {onCancel && (
          <Button onClick={onCancel} sx={touch}>
            {copy.cancel}
          </Button>
        )}
      </Stack>
    </Box>
  )
}
