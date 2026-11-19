import { Typography } from '@mui/material'
import type { Schemas } from '../../api/client'
import { productsCopy } from '../../copy/products'

type HasStatus = Pick<Schemas['ProductSummary'], 'status' | 'edit_in_review'>

// A product's status in plain words (spec §8: calm, no colour): "Live", "In review", "Needs
// changes", "Draft", "Archived", and "Live · Changes in review" while an edit waits.
export function statusWords(p: HasStatus): string {
  const word = productsCopy.statuses[p.status]
  return p.edit_in_review && p.status === 'approved' ? `${word} · ${productsCopy.changesInReview}` : word
}

export function ProductStatus({ product, variant = 'body2' }: { product: HasStatus; variant?: 'body1' | 'body2' }) {
  return (
    <Typography component="span" variant={variant} color="text.secondary" data-status={product.status}>
      {statusWords(product)}
    </Typography>
  )
}
