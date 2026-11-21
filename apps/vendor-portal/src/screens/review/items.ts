import type { Schemas } from '../../api/client'
import { paths } from '../../app/paths'

// Where a review item is edited: the product editor, or the brand page editor.
export function subjectHref(item: Schemas['ReviewItem']): string {
  return item.subject.type === 'product' ? paths.product(item.subject.id) : paths.brand
}
