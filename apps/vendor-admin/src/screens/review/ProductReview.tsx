import { Stack } from '@mui/material'
import { Banner, PageHeader, StatusPill } from '@shazlo/ui'
import { useState } from 'react'
import { useParams } from 'react-router'
import { ApiError } from '../../api/http'
import { useApproveProduct, useProductReview, useRejectProduct } from '../../api/queries'
import { reviewCopy } from '../../copy/review'
import { usePhone } from '../../lib/responsive'
import { decisionPill, queuePill } from '../../lib/status'
import { useModuleTitle } from '../../runtime/runtime'
import { DecisionBar, DecisionCard, useChecklist } from './DecisionCard'
import { CompareCard, DescriptionCard, SizesCard } from './ProductDetails'
import { ProductPhotos } from './ProductPhotos'
import { HistoryCard, LoadError, NotFound, OutcomeBanner, QueueNav, ReviewColumns, ReviewSkeleton, submittedLine, submitterOf } from './parts'
import { SendBackDialog } from './SendBackDialog'
import { useDecision } from './useDecision'

const copy = reviewCopy.product

// A-05: one product submission, compared with what the reviewer saw before, with the checklist,
// approve and send back (A-06).
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
    approve: useApproveProduct(id),
    reject: useRejectProduct(id),
    reload: () => void review.refetch(),
    toasts: { approved: copy.toast.approved(title), sentBack: copy.toast.sentBack(title, seller) },
  })
  const [sending, setSending] = useState(false)
  const checklist = useChecklist(copy.checks)
  const phone = usePhone()

  if (review.isPending) return <ReviewSkeleton />
  if (notFound) return <NotFound title={copy.notFound} body={copy.notFoundBody} />
  if (review.isError || !data) return <LoadError onRetry={() => void review.refetch()} />

  const decided = decision.outcome?.decision ?? (data.status === 'pending_review' ? null : data.status)
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
      <QueueNav prevId={data.prev_id} nextId={data.next_id} />
      <PageHeader title={title} status={pills} subtitle={copy.subtitle(data.vendor.name, data.sku, submittedLine(data.submitted_at))} />
      <Stack spacing={3}>
        <OutcomeBanner decided={decided} decision={decision} history={data.history} nextId={data.next_id} seller={seller} where="product" />
        {decision.failure && <Banner tone="error" title={decision.failure} />}
        <ReviewColumns
          main={
            <>
              <ProductPhotos title={title} version={data.submitted} compareTo={data.compare_to} />
              {data.compare_to && data.compare_label && <CompareCard label={data.compare_label} before={data.compare_to} after={data.submitted} />}
              <DescriptionCard text={data.submitted.description} />
              <SizesCard variants={data.submitted.variants} />
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
