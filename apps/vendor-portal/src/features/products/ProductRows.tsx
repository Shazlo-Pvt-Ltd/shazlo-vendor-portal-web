import { Box, Button, Card, CardContent, Chip, Link as MuiLink, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { Link } from 'react-router'
import { STATUS_COLOR, STATUS_LABEL, isProductStatus, statusLabel, type ProductSummary } from './status'

const date = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' })

export function formatDate(iso: string): string {
  const parsed = new Date(iso)
  return Number.isNaN(parsed.getTime()) ? iso : date.format(parsed)
}

export interface RowActions {
  /** Warm the cache for the product's page when a pointer or focus reaches its link. */
  onPrefetch: (product: ProductSummary) => void
  onDelete: (product: ProductSummary) => void
  /** The id of the product whose delete is being checked or carried out. */
  busyId: string | undefined
}

function StatusChip({ status }: { status: string }) {
  return (
    <Chip
      size="small"
      label={statusLabel(status)}
      color={isProductStatus(status) ? STATUS_COLOR[status] : 'default'}
      variant={status === 'archived' ? 'outlined' : 'filled'}
    />
  )
}

function PendingBadge() {
  // Words, not just a colour: an approved product that is being edited has changes waiting.
  return <Chip size="small" variant="outlined" color="warning" label="Changes pending" />
}

function deleteLabel(product: ProductSummary): string {
  return product.status === 'approved' || product.status === 'rejected' ? 'Archive' : 'Delete'
}

function ActionButtons({ product, actions }: { product: ProductSummary; actions: RowActions }) {
  const inReview = product.status === 'pending_review'
  const archived = product.status === 'archived'
  const hint = `${product.id}-hint`
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
      <Button component={Link} to={`/products/${product.id}`} size="small" aria-label={`${archived ? 'View' : 'Edit'} ${product.title}`}>
        {archived ? 'View' : 'Edit'}
      </Button>
      {archived ? null : (
        <>
          <Button
            size="small"
            color="error"
            disabled={actions.busyId === product.id}
            aria-describedby={inReview ? hint : undefined}
            onClick={() => actions.onDelete(product)}
            aria-label={`${deleteLabel(product)} ${product.title}`}
          >
            {actions.busyId === product.id ? 'Checking…' : deleteLabel(product)}
          </Button>
          {inReview ? (
            <Typography id={hint} variant="caption" color="text.secondary">
              In review: wait for the decision
            </Typography>
          ) : null}
        </>
      )}
    </Stack>
  )
}

function TitleLink({ product, actions }: { product: ProductSummary; actions: RowActions }) {
  return (
    <MuiLink
      component={Link}
      to={`/products/${product.id}`}
      onPointerEnter={() => actions.onPrefetch(product)}
      onFocus={() => actions.onPrefetch(product)}
      sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}
    >
      {product.title}
    </MuiLink>
  )
}

/** The products as a table, for wide screens. */
export function ProductsTable({ products, actions }: { products: ProductSummary[]; actions: RowActions }) {
  return (
    <Table aria-label="Your products" size="small">
      <TableHead>
        <TableRow>
          <TableCell scope="col">Product</TableCell>
          <TableCell scope="col">SKU</TableCell>
          <TableCell scope="col">Category</TableCell>
          <TableCell scope="col">Status</TableCell>
          <TableCell scope="col">Updated</TableCell>
          <TableCell scope="col">Actions</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {products.map((product) => (
          <TableRow key={product.id} hover>
            <TableCell component="th" scope="row" sx={{ maxWidth: 320 }}>
              <TitleLink product={product} actions={actions} />
            </TableCell>
            <TableCell sx={{ overflowWrap: 'anywhere' }}>{product.sku}</TableCell>
            <TableCell>{product.category}</TableCell>
            <TableCell>
              <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                <StatusChip status={product.status} />
                {product.has_pending_changes ? <PendingBadge /> : null}
              </Stack>
            </TableCell>
            <TableCell>
              <time dateTime={product.updated_at}>{formatDate(product.updated_at)}</time>
            </TableCell>
            <TableCell>
              <ActionButtons product={product} actions={actions} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/** The products as cards, for phones: the same information, stacked. */
export function ProductCards({ products, actions }: { products: ProductSummary[]; actions: RowActions }) {
  return (
    <Box component="ul" aria-label="Your products" sx={{ p: 0, m: 0, display: 'grid', gap: 2, listStyle: 'none' }}>
      {products.map((product) => (
        <li key={product.id}>
          <Card variant="outlined">
            <CardContent>
              <Typography component="h2" variant="subtitle1" sx={{ mb: 0.5 }}>
                <TitleLink product={product} actions={actions} />
              </Typography>
              <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
                <StatusChip status={product.status} />
                {product.has_pending_changes ? <PendingBadge /> : null}
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                SKU {product.sku} · {product.category}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Updated <time dateTime={product.updated_at}>{formatDate(product.updated_at)}</time>
              </Typography>
              <ActionButtons product={product} actions={actions} />
            </CardContent>
          </Card>
        </li>
      ))}
    </Box>
  )
}

export { STATUS_LABEL }
