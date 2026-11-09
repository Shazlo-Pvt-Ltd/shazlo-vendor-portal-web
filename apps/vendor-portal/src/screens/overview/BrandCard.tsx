import { Box, Button, Skeleton, Stack, Typography } from '@mui/material'
import { Banner, SectionCard, StatusPill, type PillStatus } from '@shazlo/ui'
import { Link as RouterLink } from 'react-router'
import type { Schemas } from '../../api/client'
import { useBrandPage } from '../../api/queries'
import { paths } from '../../app/paths'
import { changedFieldList, overviewCopy } from '../../copy/overview'
import { onDay, onDayAt } from '../review/when'

const copy = overviewCopy.brand
const touch = { minHeight: { xs: 44, md: 36 } }

function describe(page: Schemas['BrandPage']): { pills: PillStatus[]; lines: string[]; reason: string | null } {
  const { live, live_since, draft, changed_fields, review } = page
  const pills: PillStatus[] = []
  const lines: string[] = []
  if (live) pills.push('live')
  if (review.state === 'waiting') pills.push(live ? 'editInReview' : 'pending')
  if (review.state === 'rejected') pills.push('sentBack')

  if (live) {
    if (live_since) lines.push(copy.published(onDay(live_since)))
  } else {
    lines.push(copy.notPublished)
  }
  if (review.state === 'waiting' && review.at) lines.push(copy.inReview(onDayAt(review.at)))
  if (review.state === 'rejected' && review.at) lines.push(copy.sentBack(onDayAt(review.at)))
  // While a version is in review its changes are not "unpublished drafts" any more.
  if (review.state !== 'waiting' && draft) {
    if (!live) lines.push(copy.draftNew)
    else if (changed_fields.length > 0) lines.push(copy.draft(changed_fields.length, changedFieldList(changed_fields)))
  }
  return { pills, lines, reason: review.state === 'rejected' ? (review.reason ?? null) : null }
}

function BrandSummary({ page }: { page: Schemas['BrandPage'] }) {
  const { pills, lines, reason } = describe(page)
  return (
    <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
      {pills.length > 0 && (
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
          {pills.map((p) => (
            <StatusPill key={p} status={p} />
          ))}
        </Stack>
      )}
      {lines.map((line) => (
        <Typography key={line} variant="body1">
          {line}
        </Typography>
      ))}
      {reason && (
        <Typography variant="body2" color="text.secondary">
          {copy.reason(reason)}
        </Typography>
      )}
      <Box sx={{ pt: 0.5 }}>
        <Button variant="outlined" component={RouterLink} to={paths.brand} sx={touch}>
          {page.live || page.draft ? copy.edit : copy.setUp}
        </Button>
      </Box>
    </Stack>
  )
}

// The shopper-facing brand page: live or not, and whether a draft or a review is in flight.
export function BrandCard() {
  const page = useBrandPage()
  return (
    <SectionCard title={copy.title}>
      {page.isPending ? (
        <Box role="status" aria-label={copy.loading} aria-busy="true">
          <Skeleton variant="rounded" width={56} height={22} />
          <Skeleton variant="text" width="60%" sx={{ mt: 1.5 }} />
          <Skeleton variant="text" width="90%" />
          <Skeleton variant="text" width="70%" />
          <Skeleton variant="rounded" width={150} height={36} sx={{ mt: 2 }} />
        </Box>
      ) : page.isError ? (
        // The card is narrow, so the retry button sits under the message rather than beside it.
        <Banner tone="error" title={copy.error}>
          <Button variant="outlined" sx={{ ...touch, mt: 1.5 }} onClick={() => void page.refetch()}>
            {overviewCopy.retry}
          </Button>
        </Banner>
      ) : (
        <BrandSummary page={page.data} />
      )}
    </SectionCard>
  )
}
