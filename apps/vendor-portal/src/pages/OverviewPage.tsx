import { Box, Button, Card, CardActions, CardContent, Chip, Stack, Typography } from '@mui/material'
import { useId, type ReactNode } from 'react'
import { Link } from 'react-router'
import { api } from '../api'
import { ApiError } from '../api/errors'
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

function SubmissionsCard() {
  const pending = useProductCount('pending_review')
  return (
    <SectionCard title="Submissions" to="/submissions" action="See submissions">
      {pending.isPending ? <LoadingState label="Loading…" /> : null}
      {pending.isError ? <ErrorState error={pending.error} title="We couldn't load this" onRetry={() => void pending.refetch()} /> : null}
      {pending.data ? (
        <Typography>
          {pending.data.total === 0
            ? 'Nothing is waiting for review.'
            : `${pending.data.total} ${pending.data.total === 1 ? 'product is' : 'products are'} waiting for review.`}
        </Typography>
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
