import type { Schemas } from '../../api/model'
import { paths } from '../../app/paths'

// Where a review item is edited: the product editor, or the brand page editor. A product the
// portal could not identify (vendor-api named only a code nobody has now) opens Products.
export function subjectHref(item: Schemas['ReviewItem']): string {
  if (item.subject.type === 'brand_page') return paths.brand
  return item.subject.id ? paths.product(item.subject.id) : paths.products
}
