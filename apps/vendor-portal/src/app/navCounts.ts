import { useOverview, useSubmissions } from '../api/hooks'

/**
 * Badge counts beside "Products" and "Review status" in the sidebar (V-04: 27 and 3).
 * V-09 draws the "Review status" badge with the same number as its "Waiting for review" list,
 * so the badge counts everything still waiting on a decision: new products, edits to live
 * products and a submitted brand page draft.
 */
export function useNavCounts() {
  const { data: overview } = useOverview()
  const { data: submissions } = useSubmissions()
  return {
    products: overview?.counts.total,
    review: submissions ? submissions.filter(s => !s.decision).length : undefined,
  }
}
