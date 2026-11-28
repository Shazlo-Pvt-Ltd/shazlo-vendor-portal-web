import { Banner } from '@shazlo/ui'
import { useSubmissions } from '../../../api/queries'
import { productEditorCopy } from '../../../copy/productEditor'
import { formatRelative } from '../../../lib/format'

const copy = productEditorCopy

// The reviewer's reason, in the reviewer's words.
export function SentBackBanner({ reason, at }: { reason: string; at?: string | null }) {
  return (
    <Banner tone="warning" title={`“${reason}”`}>
      {copy.banners.reviewedBy(at ? formatRelative(at) : '')}
    </Banner>
  )
}

/**
 * vendor-api makes a new version of a sent-back product on its first save, and the product then
 * reads as a draft without the reason. Opened again, the reason comes from the latest decision on
 * it in the review list (`/v1/vendor/submissions`), by its id or its code.
 */
export function ReworkReason({ productId, code }: { productId: string; code: string }) {
  const decisions = useSubmissions({ subject: 'product', status: 'rejected', limit: 100 })
  const latest = decisions.data?.items.find((s) => s.status === 'rejected' && (s.productId === productId || (s.code ?? '').toLowerCase() === code.toLowerCase()))
  if (!latest?.reason) return null
  return <SentBackBanner reason={latest.reason} at={latest.decidedAt} />
}
