import { Box, ButtonBase, Stack, Typography } from '@mui/material'
import { neutral, StatusPill } from '@shazlo/ui'
import { ChevronRight } from 'lucide-react'
import type { components } from '../../../api/schema'
import { CardList, ListCard, stretchSx } from '../../../components/CardList'
import { publishingCopy } from '../../../copy/publishing'
import { formatCount, formatRelative } from '../../../lib/format'
import { outboxPill } from '../../../lib/status'
import { formatUntil } from './when'

const copy = publishingCopy.table
type OutboxEvent = components['schemas']['OutboxEvent']

const DASH = '—'

// A label over its value, for the attempt facts along the bottom of a card.
function Fact({ term, value, numeric = false }: { term: string; value: string; numeric?: boolean }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography component="dt" variant="caption" color="text.secondary">
        {term}
      </Typography>
      <Typography component="dd" variant="body2" sx={{ m: 0, ...(numeric ? { fontVariantNumeric: 'tabular-nums' } : null) }}>
        {value}
      </Typography>
    </Box>
  )
}

function EventCard({ event, selected, onSelect }: { event: OutboxEvent; selected: boolean; onSelect: (event: OutboxEvent) => void }) {
  const pill = outboxPill[event.status]
  return (
    <ListCard item={event.subject} selected={selected}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <ButtonBase
            data-stretch=""
            onClick={() => onSelect(event)}
            aria-haspopup="dialog"
            aria-current={selected || undefined}
            sx={{ ...stretchSx, display: 'block', textAlign: 'left', typography: 'body1', color: neutral.ink, overflowWrap: 'break-word', maxWidth: '100%' }}
          >
            {event.subject}
          </ButtonBase>
          <Typography variant="mono" component="div" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
            {event.event}
          </Typography>
        </Box>
        <Box component="span" aria-hidden="true" sx={{ color: neutral.inkTertiary, display: 'flex', pt: 0.25 }}>
          <ChevronRight size={18} strokeWidth={1.5} />
        </Box>
      </Stack>
      <Stack direction="row" useFlexGap sx={{ mt: 1.25, gap: 1, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <StatusPill status={pill.status} label={pill.label} />
        <Typography variant="body2" color="text.secondary" component="span" sx={{ overflowWrap: 'break-word', minWidth: 0 }}>
          {event.vendor.name}
        </Typography>
      </Stack>
      <Box component="dl" sx={{ m: 0, mt: 1.25, pt: 1.25, borderTop: `1px solid ${neutral.line}`, display: 'grid', gridTemplateColumns: 'minmax(0, 0.7fr) minmax(0, 1fr) minmax(0, 1fr)', gap: 1.5 }}>
        <Fact term={copy.tries} value={formatCount(event.tries)} numeric />
        <Fact term={copy.lastAttempt} value={event.last_attempt_at ? formatRelative(event.last_attempt_at) : DASH} />
        <Fact term={copy.nextAttempt} value={event.next_attempt_at ? formatUntil(event.next_attempt_at) : DASH} />
      </Box>
    </ListCard>
  )
}

// A-10 on frames under 900 px: each outbox event a card; choosing one opens its details.
export function EventCards({ items, fetching, selectedId, onSelect }: { items: OutboxEvent[] | undefined; fetching: boolean; selectedId: string | null; onSelect: (event: OutboxEvent) => void }) {
  return (
    <CardList label={copy.label} loading={items === undefined} fetching={fetching} updatingLabel={publishingCopy.updating}>
      {items?.map((event) => (
        <EventCard key={event.id} event={event} selected={event.id === selectedId} onSelect={onSelect} />
      ))}
    </CardList>
  )
}
