import { Button, Chip, Stack } from '@mui/material'
import { Link, useParams } from 'react-router'
import { api } from '../../api'
import { ApiError } from '../../api/errors'
import { EmptyState, ErrorState, PageHeader, PageSkeleton } from '../../ui'
import { ProductEditor } from './ProductEditor'
import { STATUS_COLOR, isProductStatus, statusLabel } from './status'

const PRODUCT_PATH = '/v1/vendor/products/{product_id}'

/** `/products/:productId`: one product, its live version and the version being edited. */
export default function EditProductPage() {
  const { productId = '' } = useParams()
  const product = api.useQuery('get', PRODUCT_PATH, { params: { path: { product_id: productId } } })

  if (product.isPending) {
    return (
      <>
        <PageHeader title="Edit product" />
        <PageSkeleton />
      </>
    )
  }
  if (product.isError) {
    const failure: unknown = product.error
    // A malformed id is a 422 from the API; another vendor's product is a 404. Both are "not here".
    if (failure instanceof ApiError && (failure.status === 404 || failure.status === 422)) {
      return (
        <>
          <PageHeader title="Product not found" />
          <EmptyState
            title="We couldn't find this product"
            description="It may have been deleted, or the link is not quite right."
            action={
              <Button component={Link} to="/products" variant="contained">
                Back to products
              </Button>
            }
          />
        </>
      )
    }
    return (
      <>
        <PageHeader title="Edit product" />
        <ErrorState error={product.error} title="We couldn't load this product" onRetry={() => void product.refetch()} />
      </>
    )
  }

  const detail = product.data
  const title = (detail.working ?? detail.live)?.title ?? detail.sku
  return (
    <>
      <PageHeader
        title={title}
        description={
          <Stack direction="row" spacing={1} component="span" sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
            <span>SKU {detail.sku}</span>
            <Chip
              size="small"
              label={statusLabel(detail.status)}
              color={isProductStatus(detail.status) ? STATUS_COLOR[detail.status] : 'default'}
              variant={detail.status === 'archived' ? 'outlined' : 'filled'}
            />
          </Stack>
        }
        actions={
          <Button component={Link} to="/products" variant="text">
            All products
          </Button>
        }
      />
      <ProductEditor key={detail.id} product={detail} />
    </>
  )
}
