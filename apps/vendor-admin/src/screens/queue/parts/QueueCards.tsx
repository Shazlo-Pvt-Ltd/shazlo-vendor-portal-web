import { Box, Link, Stack, Typography } from '@mui/material'
import { neutral, StatusPill } from '@shazlo/ui'
import { ChevronRight } from 'lucide-react'
import { Link as RouterLink } from 'react-router'
import type { components } from '../../../api/schema'
import { modulePaths } from '../../../app/routes'
import { CardList, ListCard, stretchSx } from '../../../components/CardList'
import { ProductThumb } from '../../../components/ProductThumb'
import { queueCopy } from '../../../copy/queue'
import { srOnly } from '../../../lib/a11y'
import { formatStamp } from '../../../lib/format'
import { queuePill } from '../../../lib/status'
import { Initials, Waiting } from './QueueTable'

const copy = queueCopy.table
type QueueItem = components['schemas']['QueueItem']

// Where each kind of item is decided.
export function reviewPath(item: Pick<QueueItem, 'kind' | 'subject_id'>): string {
  if (item.kind === 'product') return modulePaths.product(item.subject_id)
  if (item.kind === 'brand_page') return modulePaths.brand(item.subject_id)
  return modulePaths.vendor(item.subject_id)
}

function QueueCard({ item }: { item: QueueItem }) {
  const pill = queuePill(item)
  return (
    <ListCard>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
        {item.kind === 'application' ? <Initials name={item.title} /> : <ProductThumb src={item.thumbnail_url} size={32} />}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Link component={RouterLink} to={reviewPath(item)} data-stretch="" underline="none" variant="body1" sx={{ ...stretchSx, display: 'block', color: neutral.ink, overflowWrap: 'break-word' }}>
            {item.title}
          </Link>
          <Typography variant={item.kind === 'product' ? 'mono' : 'caption'} component="div" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
            {item.detail}
          </Typography>
        </Box>
        <Box component="span" aria-hidden="true" sx={{ color: neutral.inkTertiary, display: 'flex', pt: 0.25 }}>
          <ChevronRight size={18} strokeWidth={1.5} />
        </Box>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1.25 }}>
        <Box component="span" sx={srOnly}>
          {`${copy.vendor}: `}
        </Box>
        <Box component="span" sx={{ color: neutral.ink }}>
          {item.vendor.name}
        </Box>
        {' · '}
        <Box component="span" sx={srOnly}>
          {`${copy.submitted}: `}
        </Box>
        {formatStamp(item.submitted_at)}
      </Typography>
      <Stack direction="row" useFlexGap sx={{ mt: 1.25, gap: 1, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <StatusPill status={pill.status} label={pill.label} />
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
          <Typography variant="caption" color="text.secondary" component="span">
            {copy.waiting}
          </Typography>
          <Waiting submittedAt={item.submitted_at} />
        </Box>
      </Stack>
    </ListCard>
  )
}

// A-04 on frames under 900 px: each waiting item a card that opens its review.
export function QueueCards({ items, fetching }: { items: QueueItem[] | undefined; fetching: boolean }) {
  return (
    <CardList label={copy.label} loading={items === undefined} fetching={fetching} updatingLabel={queueCopy.updating}>
      {items?.map((item) => (
        <QueueCard key={item.id} item={item} />
      ))}
    </CardList>
  )
}
