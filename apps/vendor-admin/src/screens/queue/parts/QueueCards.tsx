import { Box, Link, Stack, Typography } from '@mui/material'
import { emphasis, neutral, StatusPill } from '@shazlo/ui'
import { Link as RouterLink } from 'react-router'
import type * as M from '../../../api/model'
import { CardList, ListCard, stretchSx } from '../../../components/CardList'
import { ProductThumb } from '../../../components/ProductThumb'
import { RowChevron } from '../../../components/rows'
import { queueCopy } from '../../../copy/queue'
import { srOnly } from '../../../lib/a11y'
import { formatStamp } from '../../../lib/format'
import { queuePill } from '../../../lib/status'
import { Initials, reviewPath, Waiting } from './QueueTable'

const copy = queueCopy.table
type QueueItem = M.QueueItem

function QueueCard({ item }: { item: QueueItem }) {
  const pill = queuePill(item)
  return (
    <ListCard>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
        {item.kind === 'application' ? <Initials name={item.title} /> : <ProductThumb src={item.thumbnail_url} size={32} />}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Link component={RouterLink} to={reviewPath(item)} data-stretch="" underline="none" variant="body1" sx={{ ...stretchSx, ...emphasis.semibold, display: 'block', color: neutral.ink, overflowWrap: 'break-word' }}>
            {item.title}
          </Link>
          <Typography variant={item.kind === 'product' ? 'mono' : 'caption'} component="div" color="textSecondary" sx={{ overflowWrap: 'anywhere' }}>
            {item.detail}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', flexShrink: 0 }}>
          <RowChevron />
        </Box>
      </Stack>
      <Typography variant="body2" color="textSecondary" sx={{ mt: 1.25 }}>
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
          <Typography variant="caption" color="textSecondary" component="span">
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
