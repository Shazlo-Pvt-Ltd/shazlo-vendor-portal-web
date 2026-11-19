import { Alert, Box, Button, Chip, MenuItem, Pagination, Paper, Stack, TextField, Typography } from '@mui/material'
import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { api } from '../../api'
import { EmptyState, ErrorState, PageHeader, PageSkeleton } from '../../ui'
import { endVisit, previousVisit } from './lastVisit'
import { ReviewReason } from './ReviewReason'
import {
  PAGE_SIZE,
  REFRESH_MS,
  STATUS_COLOR,
  STATUS_LABEL,
  SUBJECTS,
  SUBJECT_LABEL,
  SUBMISSION_STATUSES,
  exactTime,
  filtersFromSearch,
  fixLink,
  isNewSince,
  isSuperseded,
  itemName,
  queryFromFilters,
  relativeTime,
  reviewKey,
  searchFromFilters,
  statusChanges,
  statusLabel,
  type Submission,
  type SubmissionFilters,
} from './rules'

function When({ label, iso }: { label: string; iso: string }) {
  return (
    <Typography variant="body2" color="text.secondary" component="span">
      {label}{' '}
      <time dateTime={iso} title={exactTime(iso)}>
        {relativeTime(iso)}
      </time>{' '}
      <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
        ({exactTime(iso)})
      </Box>
    </Typography>
  )
}

/** For a rejected new version of a product that is already on sale: say that shoppers still see the approved one. */
function LiveVersionNote({ productId }: { productId: string }) {
  const product = api.useQuery('get', '/v1/vendor/products/{product_id}', { params: { path: { product_id: productId } } })
  if (!product.data?.live) return null
  return (
    <Typography variant="body2" sx={{ mt: 1 }}>
      The live version (version {product.data.live.version}) is unchanged: shoppers still see it.
    </Typography>
  )
}

function Row({ item, items, since }: { item: Submission; items: readonly Submission[]; since: number | null }) {
  const name = itemName(item)
  const rejected = item.status === 'rejected'
  const superseded = rejected && isSuperseded(item, items)
  const fresh = isNewSince(item, since)
  return (
    <Paper component="li" variant="outlined" sx={{ listStyle: 'none', p: 2, borderColor: rejected && !superseded ? 'error.main' : undefined }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ justifyContent: 'space-between', alignItems: { sm: 'flex-start' } }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography component="h3" variant="subtitle1" sx={{ overflowWrap: 'anywhere' }}>
            {name}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {SUBJECT_LABEL[item.subject]}
            {item.sku ? ` · SKU ${item.sku}` : ''} · Version {item.version}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ flexShrink: 0, alignItems: 'center' }}>
          {fresh ? <Chip size="small" color="primary" variant="outlined" label="New since your last visit" /> : null}
          <Chip size="small" label={statusLabel(item.status)} color={STATUS_COLOR[item.status] ?? 'default'} />
        </Stack>
      </Stack>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={{ xs: 0.5, md: 3 }} sx={{ mt: 1 }}>
        <When label="Submitted" iso={item.submitted_at} />
        {item.decided_at ? <When label={item.status === 'withdrawn' ? 'Withdrawn' : 'Decided'} iso={item.decided_at} /> : null}
        {item.status === 'pending' ? (
          <Typography variant="body2" color="text.secondary" component="span">
            Waiting for a decision
          </Typography>
        ) : null}
      </Stack>

      {rejected ? (
        <Alert severity={superseded ? 'info' : 'warning'} sx={{ mt: 2 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            Reason
          </Typography>
          <Typography variant="body2" component="p" sx={{ mb: 1 }}>
            <ReviewReason reason={item.reason} />
          </Typography>
          {superseded ? (
            <Typography variant="body2">A newer version was submitted after this one.</Typography>
          ) : (
            <Button component={Link} to={fixLink(item)} variant="contained" size="small" aria-label={`Fix and resubmit: ${name}`}>
              Fix and resubmit
            </Button>
          )}
          {item.subject === 'product' && !superseded ? <LiveVersionNote productId={item.id} /> : null}
        </Alert>
      ) : null}
    </Paper>
  )
}

/**
 * `/submissions`: everything the vendor sent for review and what came of it, newest first. A
 * rejection shows the admin's reason and a link to fix it. The list refreshes every minute and when
 * the window regains focus, and a status that changes while the page is open is announced.
 */
export default function SubmissionsPage() {
  const [params, setParams] = useSearchParams()
  const filters = filtersFromSearch(params)
  const submissions = api.useQuery(
    'get',
    '/v1/vendor/submissions',
    { params: { query: queryFromFilters(filters) } },
    { refetchInterval: REFRESH_MS, refetchOnWindowFocus: true, placeholderData: (previous) => previous },
  )
  // The previous visit's end, read once: decisions after it are marked as new. Leaving the page records this visit.
  const [since] = useState(previousVisit)
  useEffect(() => () => endVisit(), [])

  // Statuses already shown, to announce one that changes while the vendor watches.
  const seen = useRef(new Map<string, string>())
  const [announcement, setAnnouncement] = useState('')
  useEffect(() => {
    const items = submissions.data?.items
    if (!items) return
    const changes = statusChanges(seen.current, items)
    if (changes.length > 0) setAnnouncement(`Status updated. ${changes.join(' ')}`)
    for (const item of items) seen.current.set(reviewKey(item), item.status)
  }, [submissions.data])

  const update = (next: Partial<SubmissionFilters>) => setParams(searchFromFilters({ ...filters, page: 1, ...next }), { replace: true })
  const filtered = filters.status !== '' || filters.subject !== ''

  let body
  if (submissions.isPending) {
    body = <PageSkeleton />
  } else if (submissions.isError) {
    body = <ErrorState error={submissions.error} title="We couldn't load your submissions" onRetry={() => void submissions.refetch()} />
  } else if (submissions.data.total === 0 && !filtered) {
    body = (
      <EmptyState
        title="Nothing submitted yet"
        description="When you submit your brand page or a product for review, it appears here with our team's decision. Start with your brand page: it is what shoppers see first."
        action={
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ justifyContent: 'center' }}>
            <Button component={Link} to="/brand" variant="contained">
              Edit your brand page
            </Button>
            <Button component={Link} to="/products/new" variant="outlined">
              Add a product
            </Button>
          </Stack>
        }
      />
    )
  } else if (submissions.data.items.length === 0) {
    body = (
      <EmptyState
        title="No submissions match"
        description="Try another status or type."
        action={
          <Button onClick={() => setParams(new URLSearchParams(), { replace: true })} variant="outlined">
            Show everything
          </Button>
        }
      />
    )
  } else {
    const { items, total } = submissions.data
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
    body = (
      <>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {total} {total === 1 ? 'submission' : 'submissions'}
          {filtered ? ' match' : ''}, newest first.
        </Typography>
        <Stack component="ul" aria-label="Submissions" spacing={1.5} sx={{ p: 0, m: 0 }}>
          {items.map((item) => (
            <Row key={reviewKey(item)} item={item} items={items} since={since} />
          ))}
        </Stack>
        {pages > 1 ? (
          <Pagination
            sx={{ mt: 2 }}
            count={pages}
            page={Math.min(filters.page, pages)}
            onChange={(_event, page) => setParams(searchFromFilters({ ...filters, page }))}
            getItemAriaLabel={(type, page, selected) =>
              type === 'page' ? `${selected ? 'Page' : 'Go to page'} ${page}` : type === 'next' ? 'Next page' : type === 'previous' ? 'Previous page' : type
            }
          />
        ) : null}
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Submissions"
        description="What you sent for review and our team's decisions. This page refreshes on its own."
      />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3 }}>
        <TextField select size="small" label="Status" value={filters.status} onChange={(event) => update({ status: event.target.value as SubmissionFilters['status'] })} sx={{ minWidth: 200 }}>
          <MenuItem value="">All statuses</MenuItem>
          {SUBMISSION_STATUSES.map((status) => (
            <MenuItem key={status} value={status}>
              {STATUS_LABEL[status]}
            </MenuItem>
          ))}
        </TextField>
        <TextField select size="small" label="Type" value={filters.subject} onChange={(event) => update({ subject: event.target.value as SubmissionFilters['subject'] })} sx={{ minWidth: 200 }}>
          <MenuItem value="">Brand page and products</MenuItem>
          {SUBJECTS.map((subject) => (
            <MenuItem key={subject} value={subject}>
              {SUBJECT_LABEL[subject]}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
      {body}
      <Box role="status" aria-live="polite" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>
        {announcement}
      </Box>
    </>
  )
}
