import { PageHeader } from '../../ui'
import { ProductEditor } from './ProductEditor'

/** `/products/new`: the product form, empty. Saving creates the product and moves to its own page. */
export default function NewProductPage() {
  return (
    <>
      <PageHeader
        title="New product"
        description="Add the details, at least one variant and one image, then submit it for review. It goes on sale once our team approves it."
      />
      <ProductEditor />
    </>
  )
}
