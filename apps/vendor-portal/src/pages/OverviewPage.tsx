import { Box, Button, Card, CardActions, CardContent, Chip, Stack, Typography } from '@mui/material'
import { useId, type ReactNode } from 'react'
import { Link } from 'react-router'
import { api } from '../api'
import { ApiError } from '../api/errors'
import { REFRESH_MS, STATUS_COLOR, fixLink, itemName, relativeTime, statusLabel } from '../features/submissions/rules'
import { useSession } from '../session/AuthProvider'
import { ErrorState } from '../ui/ErrorState'
import { LoadingState } from '../ui/LoadingState'
import { PageHeader } from '../ui/PageHeader'

const PRODUCT_STATUSES = [
  { status: 'draft', label: 'Drafts' },
  { status: 'pending_review', label: 'In review' },
  { status: 'approved', label: 'Live' },
  { status: 'rejected', label: 'Needs changes' },
] as const

type ProductStatus = (typeof PRODUCT_STATUSES)[number]['status']

/** How many products have this status: the list's `total` with `limit=1`, so no products are downloaded. */
function useProductCount(status: ProductStatus) {
  return api.useQuery('get', '/v1/vendor/products', { params: { query: { status, limit: 1 } } })
}

interface CardProps {
  title: string
  to: string
  action: string
  children: ReactNode
}

function SectionCard({ title, to, action, children }: CardProps) {
  const headingId = useId()
  return (
    <Card component="section" aria-labelledby={headingId} variant="outlined" sx={{ display: 'flex', flexDirection: 'column' }}>
      <CardContent sx={{ flexGrow: 1 }}>
        <Typography id={headingId} component="h2" variant="h6" gutterBottom>
          {title}
        </Typography>
        {children}
      </CardContent>
      <CardActions>
        <Button component={Link} to={to} size="small">
          {action}
        </Button>
      </CardActions>
    </Card>
  )
}

/**
 * Where the brand page stands. `GET /v1/vendor/brand-profile` always answers with the editable draft
 * (its `state` is always `draft`); a version waiting for a decision shows as `in_review_version`, and
 * what shoppers see is `GET .../published` (404 until the first approval).
 */
function BrandCard() {
  const draft = api.useQuery('get', '/v1/vendor/brand-profile')
  const published = api.useQuery('get', '/v1/vendor/brand-profile/published')
  const publishedError: unknown = published.error
  const nothingLive = publishedError instanceof ApiError && publishedError.status === 404
  const failed = draft.isError ? draft : published.isError && !nothingLive ? published : undefined
  const pending = draft.isPending || (published.isPending && !failed)
  return (
    <SectionCard title="Brand page" to="/brand" action="Edit your brand page">
      {failed ? <ErrorState error={failed.error} title="We couldn't load your brand page" onRetry={() => void failed.refetch()} /> : null}
      {!failed && pending ? <LoadingState label="Loading your brand page…" /> : null}
      {!failed && !pending && draft.data ? (
        <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
          <Chip label={draft.data.in_review_version === null ? 'Draft' : `Version ${draft.data.in_review_version} in review`} />
          <Typography color="text.secondary">{published.data ? 'A version is live on Shazlo.' : 'Nothing is live on Shazlo yet.'}</Typography>
        </Stack>
      ) : null}
    </SectionCard>
  )
}

function ProductCounts() {
  const counts = [useProductCount('draft'), useProductCount('pending_review'), useProductCount('approved'), useProductCount('rejected')]
  const failed = counts.find((query) => query.isError)
  if (failed?.isError) {
    return <ErrorState error={failed.error} title="We couldn't load your products" onRetry={() => counts.forEach((query) => void query.refetch())} />
  }
  if (counts.some((query) => query.isPending)) {
    return <LoadingState label="Loading your products…" />
  }
  const total = counts.reduce((sum, query) => sum + (query.data?.total ?? 0), 0)
  return (
    <>
      <Typography variant="h3" component="p" sx={{ mb: 1 }}>
        {total}
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 1 }}>
        {total === 1 ? 'product' : 'products'}
      </Typography>
      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
        {PRODUCT_STATUSES.map(({ label }, index) => (
          <Chip key={label} size="small" label={`${label}: ${counts[index]?.data?.total ?? 0}`} />
        ))}
      </Stack>
    </>
  )
}

/** How many decisions the overview lists. */
const LATEST_DECISIONS = 3

/**
 * What is waiting for review (the brand page and products together: the submissions list's `total`
 * with `status=pending`) and the latest decisions. Refreshed like the submissions page.
 */
function SubmissionsCard() {
  const refresh = { refetchInterval: REFRESH_MS, refetchOnWindowFocus: true } as const
  const pending = api.useQuery('get', '/v1/vendor/submissions', { params: { query: { status: 'pending', limit: 1 } } }, refresh)
  const recent = api.useQuery('get', '/v1/vendor/submissions', { params: { query: { status: 'all', limit: 10 } } }, refresh)
  const failed = pending.isError ? pending : recent.isError ? recent : undefined
  const decided = (recent.data?.items ?? []).filter((item) => item.decided_at !== null).slice(0, LATEST_DECISIONS)
  return (
    <SectionCard title="Submissions" to="/submissions" action="See submissions">
      {failed ? <ErrorState error={failed.error} title="We couldn't load your submissions" onRetry={() => void failed.refetch()} /> : null}
      {!failed && (pending.isPending || recent.isPending) ? <LoadingState label="Loading…" /> : null}
      {!failed && pending.data && recent.data ? (
        <>
          <Typography sx={{ mb: decided.length > 0 ? 1.5 : 0 }}>
            {pending.data.total === 0
              ? 'Nothing is waiting for review.'
              : `${pending.data.total} ${pending.data.total === 1 ? 'item is' : 'items are'} waiting for review.`}
          </Typography>
          {decided.length > 0 ? (
            <>
              <Typography component="h3" variant="subtitle2">
                Latest decisions
              </Typography>
              <Box component="ul" sx={{ p: 0, m: 0, mt: 0.5 }}>
                {decided.map((item) => (
                  <Stack component="li" key={`${item.subject}:${item.id}:${item.version}`} direction="row" spacing={1} sx={{ listStyle: 'none', alignItems: 'center', py: 0.5, minWidth: 0 }}>
                    <Chip size="small" label={statusLabel(item.status)} color={STATUS_COLOR[item.status] ?? 'default'} />
                    <Typography variant="body2" noWrap sx={{ minWidth: 0 }} title={itemName(item)}>
                      {item.status === 'rejected' ? <Link to={fixLink(item)}>{itemName(item)}</Link> : itemName(item)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                      {item.decided_at ? relativeTime(item.decided_at) : ''}
                    </Typography>
                  </Stack>
                ))}
              </Box>
            </>
          ) : null}
        </>
      ) : null}
    </SectionCard>
  )
}

/** The landing page: where the brand page and the products stand, with a card for each section. */
export default function OverviewPage() {
  const { role, vendor } = useSession()
  return (
    <>
      <PageHeader title="Overview" description={vendor ? `Welcome, ${vendor.name}.` : undefined} />
      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' },
        }}
      >
        <BrandCard />
        <SectionCard title="Products" to="/products" action="Manage products">
          <ProductCounts />
        </SectionCard>
        <SubmissionsCard />
        <SectionCard title="Bulk import" to="/import" action="Import a spreadsheet">
          <Typography color="text.secondary">Add many products at once from a spreadsheet.</Typography>
        </SectionCard>
        {role === 'owner' ? (
          <SectionCard title="Team" to="/team" action="Manage your team">
            <Typography color="text.secondary">Invite staff to help with your brand page and products.</Typography>
          </SectionCard>
        ) : null}
        <SectionCard title="Account" to="/account" action="Your account">
          <Typography color="text.secondary">Your details and password.</Typography>
        </SectionCard>
      </Box>
    </>
  )
}
