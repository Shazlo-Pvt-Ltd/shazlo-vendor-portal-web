import { Stack } from '@mui/material'
import { Banner, PageHeader, StatusPill } from '@shazlo/ui'
import { useState } from 'react'
import { useParams } from 'react-router'
import { ApiError } from '../../api/http'
import { useApproveReview, useProductReview, useRejectReview } from '../../api/queries'
import { reviewCopy } from '../../copy/review'
import { usePhone } from '../../lib/responsive'
import { decisionPill, queuePill } from '../../lib/status'
import { useModuleTitle } from '../../runtime/runtime'
import { DecisionBar, DecisionCard, useChecklist } from './DecisionCard'
import { AboutCard, CompareCard, PriceCard, SizeChartCard, SizesCard } from './ProductDetails'
import { ProductPhotos } from './ProductPhotos'
import { decidedOf, HistoryCard, LoadError, NotFound, OutcomeBanner, QueueNav, ReviewColumns, ReviewSkeleton, submittedLine, submitterOf } from './parts'
import { SendBackDialog } from './SendBackDialog'
import { useDecision } from './useDecision'

const copy = reviewCopy.product

// A-05: one product submission (the page's id is the review's), compared with what the reviewer saw before, with the checklist,
// approve and send back (A-06). The main column follows the seller's form: photos, about the
// product, sizes and stock (with the brand's size chart), price.
export default function ProductReview() {
  const { id = '' } = useParams()
  // A new id is a new review: the checklist and any outcome start again.
  return <Review key={id} id={id} />
}

function Review({ id }: { id: string }) {
  const review = useProductReview(id)
  const data = review.data
  const notFound = review.error instanceof ApiError && review.error.status === 404
  useModuleTitle(data?.submitted.title ?? (notFound ? copy.notFoundTitle : null))

  const title = data?.submitted.title ?? ''
  const seller = data ? submitterOf(data.history, data.vendor.name) : ''
  const decision = useDecision({
    approve: useApproveReview(id, data?.version),
    reject: useRejectReview(id, data?.version),
    reload: () => void review.refetch(),
    toasts: { approved: copy.toast.approved(title), sentBack: copy.toast.sentBack(title, seller) },
  })
  const [sending, setSending] = useState(false)
  const checklist = useChecklist(copy.checks, data?.version)
  const phone = usePhone()

  if (review.isPending) return <ReviewSkeleton />
  if (notFound) return <NotFound title={copy.notFound} body={copy.notFoundBody} />
  if (review.isError || !data) return <LoadError onRetry={() => void review.refetch()} />

  const decided = decision.outcome?.decision ?? decidedOf(data.status)
  const kindPill = data.resubmission > 0 || data.compare_label === 'live' ? queuePill({ kind: 'product', change: data.compare_label === 'live' ? 'edit' : 'new', resubmission: data.resubmission }) : null
  const pills = decided ? (
    <StatusPill {...decisionPill[decided]} />
  ) : (
    <>
      <StatusPill status="pending" label={copy.pending} />
      {kindPill && <StatusPill {...kindPill} />}
    </>
  )

  return (
    <>
      <QueueNav prev={data.prev} next={data.next} />
      <PageHeader title={title} status={pills} subtitle={copy.subtitle(data.vendor.name, data.sku, submittedLine(data.submitted_at))} />
      <Stack spacing={3}>
        <OutcomeBanner decided={decided} decision={decision} history={data.history} next={data.next} seller={seller} where="product" />
        {decision.failure && <Banner tone="error" title={decision.failure} />}
        <ReviewColumns
          main={
            <>
              <ProductPhotos title={title} version={data.submitted} compareTo={data.compare_to} />
              {data.compare_to && data.compare_label && <CompareCard label={data.compare_label} before={data.compare_to} after={data.submitted} />}
              <AboutCard version={data.submitted} />
              <SizesCard version={data.submitted} />
              {data.submitted.size_chart && <SizeChartCard chart={data.submitted.size_chart} />}
              <PriceCard version={data.submitted} />
            </>
          }
          side={
            <>
              {!decided && <DecisionCard checklist={checklist} withActions={!phone} approving={decision.approving} onApprove={decision.approve} onSendBack={() => setSending(true)} />}
              <HistoryCard history={data.history} />
            </>
          }
        />
      </Stack>
      {phone && !decided && <DecisionBar checklist={checklist} approving={decision.approving} onApprove={decision.approve} onSendBack={() => setSending(true)} />}
      <SendBackDialog open={sending && !decided} subject={title} reasons={reviewCopy.productReasons} onClose={() => setSending(false)} onSubmit={decision.sendBack} />
    </>
  )
}
