import { Alert, Box, Tab, Tabs, Typography } from '@mui/material'
import { useState } from 'react'
import { api } from '../../api'
import { ApiError } from '../../api/errors'
import { ErrorState, PageHeader, PageSkeleton } from '../../ui'
import { BrandEditor } from './BrandEditor'
import { BrandPreview } from './BrandPreview'
import { formatDate } from './review'
import { toValues } from './rules'

type View = 'draft' | 'published'

function PublishedVersion() {
  const published = api.useQuery('get', '/v1/vendor/brand-profile/published')
  if (published.isPending) return <PageSkeleton />
  const failure: unknown = published.error
  if (failure instanceof ApiError && failure.status === 404) {
    return (
      <Alert severity="info">
        <strong>Nothing is published yet.</strong> When our team approves your brand page, the approved version appears here.
      </Alert>
    )
  }
  if (published.isError) {
    return <ErrorState error={published.error} title="We couldn't load the published version" onRetry={() => void published.refetch()} />
  }
  const version = published.data
  return (
    <Box>
      <Typography sx={{ mb: 2 }}>
        Version {version.version}, published on {formatDate(version.published_at)}. This is what shoppers see now. To change it,
        edit the draft and submit it for review.
      </Typography>
      <BrandPreview values={toValues(version)} title="Published version" />
    </Box>
  )
}

/** `/brand`: edit the brand page's draft beside a live preview, submit it, and see the published version. */
export default function BrandPage() {
  const draft = api.useQuery('get', '/v1/vendor/brand-profile')
  // The latest decision (or the one waiting) gives the "in review since" date and a rejection's reason.
  // It is a nicety: the page works without it.
  const latest = api.useQuery('get', '/v1/vendor/submissions', { params: { query: { subject: 'brand_profile', limit: 1 } } })
  const [view, setView] = useState<View>('draft')

  let body
  if (draft.isPending) {
    body = <PageSkeleton />
  } else if (draft.isError) {
    body = <ErrorState error={draft.error} title="We couldn't load your brand page" onRetry={() => void draft.refetch()} />
  } else {
    body = (
      <>
        <Tabs value={view} onChange={(_event, next: View) => setView(next)} aria-label="Brand page versions" sx={{ mb: 3 }}>
          <Tab value="draft" label="Draft" id="brand-tab-draft" aria-controls="brand-panel-draft" />
          <Tab value="published" label="Published version" id="brand-tab-published" aria-controls="brand-panel-published" />
        </Tabs>
        {/* Both stay mounted: switching tabs must not throw away what is being typed. */}
        <Box role="tabpanel" id="brand-panel-draft" aria-labelledby="brand-tab-draft" hidden={view !== 'draft'}>
          <BrandEditor key={draft.data.id} draft={draft.data} latest={latest.data?.items[0]} />
        </Box>
        <Box role="tabpanel" id="brand-panel-published" aria-labelledby="brand-tab-published" hidden={view !== 'published'}>
          {view === 'published' ? <PublishedVersion /> : null}
        </Box>
      </>
    )
  }

  return (
    <>
      <PageHeader title="Brand page" description="How shoppers see your brand. Changes go live only after our team approves them." />
      {body}
    </>
  )
}
