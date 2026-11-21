import { Box, Button, Card, IconButton, Stack, Typography } from '@mui/material'
import { Banner, fontFamily, neutral, radius, StatusPill } from '@shazlo/ui'
import { Copy, RefreshCw, X } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import type { components } from '../../../api/schema'
import { publishingCopy } from '../../../copy/publishing'
import { formatCount, formatRelative, formatStamp } from '../../../lib/format'
import { outboxPill } from '../../../lib/status'
import { formatUntil } from './when'

const copy = publishingCopy.details
type OutboxEvent = components['schemas']['OutboxEvent']

const icon = { size: 16, strokeWidth: 1.5, 'aria-hidden': true } as const

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '112px minmax(0, 1fr)', gap: 1.5, py: 0.75, borderBottom: `1px solid ${neutral.line}`, '&:last-of-type': { borderBottom: 0 } }}>
      <Typography component="dt" variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography component="dd" variant="body2" sx={{ m: 0, minWidth: 0, overflowWrap: 'anywhere' }}>
        {children}
      </Typography>
    </Box>
  )
}

type Props = {
  event: OutboxEvent
  retrying: boolean
  retryError: string | null
  onRetry: () => void
  onCopy: () => void
  onClose: () => void
}

// The chosen event: what was sent, how it went, and the two things a reviewer can do about it.
export function EventDetails({ event, retrying, retryError, onRetry, onCopy, onClose }: Props) {
  const headingId = useId()
  const pill = outboxPill[event.status]
  return (
    <Card component="section" aria-label={copy.label} sx={{ p: { xs: 2, sm: 2.5 } }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography id={headingId} variant="h2" component="h2" sx={{ overflowWrap: 'anywhere' }}>
            {event.subject}
          </Typography>
          <Box sx={{ mt: 0.75 }}>
            <StatusPill status={pill.status} label={pill.label} />
          </Box>
        </Box>
        <IconButton aria-label={copy.close} onClick={onClose} size="small" sx={{ color: neutral.inkSecondary, mt: -0.5, mr: -1 }}>
          <X size={18} strokeWidth={1.5} aria-hidden="true" />
        </IconButton>
      </Stack>

      <Box component="dl" sx={{ my: 2 }}>
        <Field label={copy.event}>
          <Typography variant="mono" component="span">
            {event.event}
          </Typography>
        </Field>
        <Field label={copy.vendor}>{event.vendor.name}</Field>
        <Field label={copy.created}>{formatStamp(event.created_at)}</Field>
        <Field label={copy.tries}>
          <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {formatCount(event.tries)}
          </Box>
        </Field>
        <Field label={copy.lastAttempt}>{event.last_attempt_at ? formatRelative(event.last_attempt_at) : '—'}</Field>
        {event.status !== 'delivered' && <Field label={copy.nextAttempt}>{event.next_attempt_at ? formatUntil(event.next_attempt_at) : '—'}</Field>}
      </Box>

      <Stack spacing={2}>
        {event.last_error && (
          <Banner tone="error" title={copy.lastError}>
            {event.last_error}
          </Banner>
        )}
        {retryError && (
          <Banner tone="error" title={copy.retryFailed}>
            {retryError}
          </Banner>
        )}

        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 0.75 }}>
            {copy.payload}
          </Typography>
          <Box
            component="pre"
            role="region"
            aria-label={copy.payload}
            tabIndex={0}
            sx={{
              m: 0,
              p: 1.5,
              maxHeight: 280,
              overflow: 'auto',
              fontFamily: fontFamily.mono,
              fontSize: 12,
              lineHeight: '18px',
              whiteSpace: 'pre',
              bgcolor: neutral.canvas,
              color: neutral.ink,
              border: `1px solid ${neutral.line}`,
              borderRadius: `${radius.control}px`,
              '&:focus-visible': { outline: `2px solid ${neutral.inkSecondary}`, outlineOffset: 2 },
            }}
          >
            {JSON.stringify(event.payload, null, 2)}
          </Box>
        </Box>

        <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
          {event.status !== 'delivered' && (
            <Button variant="contained" startIcon={<RefreshCw {...icon} />} onClick={onRetry} disabled={retrying}>
              {retrying ? copy.retrying : copy.retry}
            </Button>
          )}
          <Button variant="outlined" startIcon={<Copy {...icon} />} onClick={onCopy}>
            {copy.copy}
          </Button>
        </Stack>
      </Stack>
    </Card>
  )
}
