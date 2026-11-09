import { Box, Button, Card, Link, Skeleton, Stack, Typography } from '@mui/material'
import { brand, EmptyState, neutral, radius, SectionCard, StatusPill, type IllustrationName } from '@shazlo/ui'
import { Info } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link as RouterLink } from 'react-router'
import type { Schemas } from '../../api/client'
import { ProductThumb } from '../../components/ProductThumb'
import { reviewCopy as copy } from '../../copy/review'
import { reviewPill } from '../../lib/status'
import { subjectHref } from './items'
import { onDay, onDayAt, waitedFor } from './when'

type Item = Schemas['ReviewItem']
export type DecidedFilter = 'all' | 'rejected' | 'approved'

const rowPadding = { px: { xs: 2, sm: 3 } }
const rowSx = { ...rowPadding, display: 'flex', gap: 2, alignItems: 'flex-start', py: 2, borderTop: `1px solid ${neutral.line}` } as const
const listSx = { listStyle: 'none', m: 0, p: 0, pb: 1 } as const

function kindLabel(item: Item): string {
  if (item.subject.type === 'brand_page') return item.kind === 'edit' ? copy.kind.brandEdit : copy.kind.brand
  return item.kind === 'edit' ? copy.kind.productEdit : copy.kind.product
}

function TitleLink({ item }: { item: Item }) {
  return (
    <Link component={RouterLink} to={subjectHref(item)} variant="body1" underline="hover" sx={{ color: neutral.ink, overflowWrap: 'anywhere' }}>
      {item.subject.title}
    </Link>
  )
}

// On phones the pill moves under the title, so the text keeps the row's width.
type RowProps = { item: Item; compact: boolean }

function WaitingRow({ item, compact }: RowProps) {
  const line = item.kind === 'edit' ? copy.waiting.submittedEdit(onDay(item.submitted_at)) : copy.waiting.submitted(onDayAt(item.submitted_at), waitedFor(item.submitted_at))
  const pill = <StatusPill status={reviewPill(item)} />
  return (
    <Box component="li" sx={rowSx}>
      <ProductThumb src={item.subject.thumbnail_url} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <TitleLink item={item} />
        <Typography variant="caption" component="p" color="text.secondary" sx={{ mt: 0.25 }}>
          {kindLabel(item)}
        </Typography>
        {compact && <Box sx={{ mt: 0.75 }}>{pill}</Box>}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {line}
        </Typography>
      </Box>
      {!compact && pill}
    </Box>
  )
}

function decidedLine(item: Item): string {
  const at = item.decided_at ?? item.submitted_at
  if (item.state === 'rejected') return copy.decided.sentBack(onDayAt(at))
  return item.publishing ? copy.decided.publishing(onDay(at)) : copy.decided.live(onDay(at))
}

function DecidedRow({ item, compact }: RowProps) {
  const sentBack = item.state === 'rejected'
  const pill = <StatusPill status={reviewPill(item)} />
  return (
    <Box component="li" sx={rowSx}>
      <ProductThumb src={item.subject.thumbnail_url} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Box sx={{ minWidth: 0 }}>
            <TitleLink item={item} />
            {compact && <Box sx={{ mt: 0.75 }}>{pill}</Box>}
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {decidedLine(item)}
            </Typography>
          </Box>
          {!compact && pill}
        </Stack>
        {sentBack && item.reason && (
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', mt: 1.5, px: 1.5, py: 1.25, bgcolor: brand.cream, borderRadius: `${radius.card}px`, maxWidth: '65ch' }}>
            <Box component="span" sx={{ color: brand.brown, display: 'flex', pt: '2px', flexShrink: 0 }}>
              <Info size={16} strokeWidth={1.5} aria-hidden="true" />
            </Box>
            <Typography component="blockquote" variant="body2" sx={{ m: 0 }}>
              {copy.decided.reason(item.reason)}
            </Typography>
          </Box>
        )}
        {sentBack && (
          <Button variant="outlined" component={RouterLink} to={subjectHref(item)} aria-label={copy.decided.fixLabel(item.subject.title)} sx={{ mt: 1.5, minHeight: { xs: 44, md: 36 } }}>
            {copy.decided.fix}
          </Button>
        )}
      </Box>
    </Box>
  )
}

function ListOrEmpty({ items, empty, children }: { items: Item[]; empty: { illustration: IllustrationName; title: string; body: string }; children: (item: Item) => ReactNode }) {
  if (items.length === 0) return <EmptyState illustration={empty.illustration} title={empty.title} body={empty.body} />
  return (
    <Box component="ul" sx={listSx}>
      {items.map((item) => children(item))}
    </Box>
  )
}

export function WaitingCard({ items, total, compact }: { items: Item[]; total: number; compact: boolean }) {
  return (
    <SectionCard
      title={copy.waiting.title}
      padded={false}
      action={
        total > 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
            {copy.waiting.count(total)}
          </Typography>
        ) : undefined
      }
    >
      <ListOrEmpty items={items} empty={{ illustration: 'clock', title: copy.waiting.emptyTitle, body: copy.waiting.emptyBody }}>
        {(item) => <WaitingRow key={item.id} item={item} compact={compact} />}
      </ListOrEmpty>
    </SectionCard>
  )
}

const decidedEmpty: Record<DecidedFilter, { illustration: IllustrationName; title: string; body: string }> = {
  all: { illustration: 'box', title: copy.decided.emptyTitle, body: copy.decided.emptyBody },
  rejected: { illustration: 'sheet', title: copy.decided.emptyRejectedTitle, body: copy.decided.emptyRejectedBody },
  approved: { illustration: 'kurta', title: copy.decided.emptyApprovedTitle, body: copy.decided.emptyApprovedBody },
}

export function DecidedCard({ items, filter, compact }: { items: Item[]; filter: DecidedFilter; compact: boolean }) {
  return (
    <SectionCard title={copy.decided.title} padded={false}>
      <ListOrEmpty items={items} empty={decidedEmpty[filter]}>
        {(item) => <DecidedRow key={item.id} item={item} compact={compact} />}
      </ListOrEmpty>
    </SectionCard>
  )
}

export function ListsSkeleton() {
  return (
    <Card role="status" aria-label={copy.loading} aria-busy="true">
      <Skeleton variant="text" width={180} height={28} sx={{ mx: { xs: 2, sm: 3 }, mt: 2.5, mb: 1.5 }} />
      {[0, 1, 2, 3].map((i) => (
        <Stack key={i} direction="row" spacing={2} sx={{ ...rowPadding, py: 2, borderTop: `1px solid ${neutral.line}` }}>
          <Skeleton variant="rounded" width={40} height={50} />
          <Box sx={{ flex: 1 }}>
            <Skeleton variant="text" width="50%" />
            <Skeleton variant="text" width="35%" />
          </Box>
          <Skeleton variant="rounded" width={88} height={22} />
        </Stack>
      ))}
    </Card>
  )
}

