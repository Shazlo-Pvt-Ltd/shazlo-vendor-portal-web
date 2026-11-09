import { Box, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { Banner, neutral, PageHeader, radius, SectionCard, StatusPill } from '@shazlo/ui'
import { useState, type ReactNode } from 'react'
import { useParams } from 'react-router'
import { ApiError } from '../../api/http'
import { useApproveBrand, useBrandReview, useRejectBrand } from '../../api/queries'
import type { components } from '../../api/schema'
import { reviewCopy } from '../../copy/review'
import { decisionPill, queuePill } from '../../lib/status'
import { useModuleTitle } from '../../runtime/runtime'
import { DecisionCard } from './DecisionCard'
import { decisionIn, HistoryCard, LoadError, NotFound, OutcomeBanner, QueueNav, ReviewColumns, ReviewSkeleton, submittedLine, submitterOf } from './parts'
import { dispatchLabel, PhonePreview, returnsLabel } from './PhonePreview'
import { SendBackDialog } from './SendBackDialog'
import { useDecision } from './useDecision'

const copy = reviewCopy.brand
type Profile = components['schemas']['BrandProfile']
type Field = keyof Profile
const FIELDS = Object.keys(copy.fields) as Field[]
const isField = (key: string): key is Field => (FIELDS as string[]).includes(key)

// A-07: a brand page submission beside the live page, with what changed, the checklist and the decision.
export default function BrandReview() {
  const { vendorId = '' } = useParams()
  return <Review key={vendorId} vendorId={vendorId} />
}

function Thumb({ url, alt }: { url: string | null; alt: string }) {
  if (!url) return <>{copy.changes.noImage}</>
  return <Box component="img" src={url} alt={alt} sx={{ display: 'block', width: 160, maxWidth: '100%', aspectRatio: '8 / 3', objectFit: 'cover', borderRadius: `${radius.control}px`, border: `1px solid ${neutral.line}` }} />
}

function valueOf(field: Field, profile: Profile, when: 'before' | 'after'): ReactNode {
  const label = `${copy.fields[field]} ${when === 'before' ? copy.changes.before.toLowerCase() : copy.changes.after.toLowerCase()}`
  if (field === 'cover_url' || field === 'logo_url') return <Thumb url={profile[field]} alt={label} />
  const raw = profile[field]
  if (field === 'return_policy') return returnsLabel(raw)
  if (field === 'dispatch_time') return dispatchLabel(raw)
  return raw || '—'
}

const cellSx = { verticalAlign: 'top', overflowWrap: 'anywhere', whiteSpace: 'pre-line' } as const

// Each changed field, the live value struck through and the submitted one beside it.
function ChangesCard({ live, draft, changed }: { live: Profile; draft: Profile; changed: string[] }) {
  const fields = FIELDS.filter((f) => changed.includes(f))
  return (
    <SectionCard title={copy.changes.title} padded={fields.length === 0}>
      {fields.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {copy.changes.none}
        </Typography>
      ) : (
        <Box sx={{ overflowX: 'auto' }}>
          <Table sx={{ tableLayout: 'fixed', minWidth: 480 }}>
            <TableHead>
              <TableRow>
                <TableCell component="th" scope="col" sx={{ width: '22%' }}>
                  {reviewCopy.product.compare.field}
                </TableCell>
                <TableCell component="th" scope="col">
                  {copy.preview.live}
                </TableCell>
                <TableCell component="th" scope="col">
                  {copy.preview.draft}
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {fields.map((f) => (
                <TableRow key={f}>
                  <TableCell component="th" scope="row" sx={{ ...cellSx, color: neutral.inkSecondary }}>
                    {copy.fields[f]}
                  </TableCell>
                  <TableCell sx={cellSx}>
                    <Box component="del" sx={{ color: neutral.inkTertiary, textDecorationThickness: '1px' }}>
                      {valueOf(f, live, 'before')}
                    </Box>
                  </TableCell>
                  <TableCell sx={cellSx}>
                    <Box component="ins" sx={{ textDecoration: 'none' }}>
                      {valueOf(f, draft, 'after')}
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}
    </SectionCard>
  )
}

function Review({ vendorId }: { vendorId: string }) {
  const review = useBrandReview(vendorId)
  const data = review.data
  const notFound = review.error instanceof ApiError && review.error.status === 404
  const vendor = data?.vendor.name ?? ''
  useModuleTitle(data ? copy.title(vendor) : notFound ? copy.notFoundTitle : null)

  const seller = data ? submitterOf(data.history, vendor) : ''
  const decision = useDecision({
    approve: useApproveBrand(vendorId),
    reject: useRejectBrand(vendorId),
    reload: () => void review.refetch(),
    toasts: { approved: copy.toast.approved(vendor), sentBack: copy.toast.sentBack(vendor, seller) },
  })
  const [sending, setSending] = useState(false)

  if (review.isPending) return <ReviewSkeleton />
  if (notFound) return <NotFound title={copy.notFound} body={copy.notFoundBody} />
  if (review.isError || !data) return <LoadError onRetry={() => void review.refetch()} />

  // The review has no status of its own; a decision newer than the last submission means it was decided.
  const decided = decision.outcome?.decision ?? decisionIn(data.history)
  const kind = queuePill({ kind: 'brand_page', change: data.live ? 'edit' : 'new', resubmission: 0 })
  const pills = decided ? (
    <StatusPill {...decisionPill[decided]} />
  ) : (
    <>
      <StatusPill status="pending" label={reviewCopy.product.pending} />
      <StatusPill {...kind} />
    </>
  )
  const changed = data.changed_fields.filter(isField)

  return (
    <>
      <QueueNav prevId={data.prev_id} nextId={data.next_id} />
      <PageHeader title={copy.heading(vendor)} status={pills} subtitle={`${vendor} · ${submittedLine(data.submitted_at)}`} />
      <Stack spacing={3}>
        <OutcomeBanner decided={decided} decision={decision} history={data.history} nextId={data.next_id} seller={seller} where="brand page" />
        {decision.failure && <Banner tone="error" title={decision.failure} />}
        <ReviewColumns
          main={
            <>
              <SectionCard title={copy.preview.title}>
                <Box sx={{ display: 'grid', gridTemplateColumns: data.live ? 'repeat(auto-fit, minmax(240px, 1fr))' : 'minmax(0, 1fr)', gap: 3, pt: 1 }}>
                  {data.live && <PhonePreview heading={copy.preview.live} brandName={vendor} profile={data.live} />}
                  <PhonePreview heading={copy.preview.draft} brandName={vendor} profile={data.draft} note={data.live ? undefined : copy.preview.notLive} />
                </Box>
              </SectionCard>
              {data.live && <ChangesCard live={data.live} draft={data.draft} changed={changed} />}
            </>
          }
          side={
            <>
              {!decided && <DecisionCard checks={copy.checks} approving={decision.approving} onApprove={decision.approve} onSendBack={() => setSending(true)} />}
              <HistoryCard history={data.history} />
            </>
          }
        />
      </Stack>
      <SendBackDialog open={sending && !decided} subject={copy.title(vendor)} reasons={reviewCopy.brandReasons} onClose={() => setSending(false)} onSubmit={decision.sendBack} />
    </>
  )
}
