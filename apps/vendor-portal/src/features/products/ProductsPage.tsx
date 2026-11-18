import { keepPreviousData, useQueryClient } from '@tanstack/react-query'
import { Box, Button, MenuItem, Skeleton, Stack, TextField, Typography, useMediaQuery, useTheme } from '@mui/material'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api } from '../../api'
import { ApiError } from '../../api/errors'
import { friendlyError } from '../errors'
import { EmptyState } from '../../ui/EmptyState'
import { ErrorState } from '../../ui/ErrorState'
import { PageHeader } from '../../ui/PageHeader'
import { useConfirm } from '../../ui/ConfirmDialog'
import { useToast } from '../../ui/Toast'
import { confirmText, deleteOutcome } from './deleteOutcome'
import { PAGE_SIZE, hasActiveFilters, pageCount, queryFromFilters } from './filters'
import { ProductCards, ProductsTable, type RowActions } from './ProductRows'
import { PRODUCT_STATUSES, STATUS_LABEL, type ProductDetail, type ProductSummary } from './status'
import { useProductFilters } from './useProductFilters'

const PRODUCT_PATH = '/v1/vendor/products/{product_id}' as const

function ListSkeleton() {
  return (
    <Box role="status" aria-live="polite" aria-busy="true" aria-label="Loading your products">
      <Stack spacing={1}>
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} variant="rounded" height={52} />
        ))}
      </Stack>
    </Box>
  )
}

/** The vendor's products: search, filters kept in the address, paging, and delete or archive. */
export default function ProductsPage() {
  const theme = useTheme()
  const wide = useMediaQuery(theme.breakpoints.up('md'))
  const queryClient = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const { filters, apply, clear, qInput, setQInput, categoryInput, setCategoryInput } = useProductFilters()
  const [busyId, setBusyId] = useState<string | undefined>()

  const list = api.useQuery('get', '/v1/vendor/products', { params: { query: queryFromFilters(filters) } }, { placeholderData: keepPreviousData })
  const remove = api.useMutation('delete', PRODUCT_PATH)

  const total = list.data?.total ?? 0
  const pages = pageCount(total)
  const products = list.data?.items ?? []
  const first = total === 0 ? 0 : (filters.page - 1) * PAGE_SIZE + 1
  const last = Math.min(filters.page * PAGE_SIZE, total)
  const filtered = hasActiveFilters(filters)

  const detailOptions = (product: ProductSummary) => api.queryOptions('get', PRODUCT_PATH, { params: { path: { product_id: product.id } } })

  const actions: RowActions = {
    busyId,
    onPrefetch: (product) => void queryClient.prefetchQuery({ ...detailOptions(product), staleTime: 30_000 }),
    onDelete: async (product) => {
      // A draft needs a look at its history to know whether deleting erases it or archives it.
      let detail: ProductDetail | undefined
      if (product.status === 'draft') {
        setBusyId(product.id)
        try {
          detail = await queryClient.fetchQuery({ ...detailOptions(product), staleTime: 0 })
        } catch {
          detail = undefined
        } finally {
          setBusyId(undefined)
        }
      }
      const outcome = deleteOutcome(product, detail)
      const text = confirmText(product, outcome)
      if (outcome === 'blocked') {
        await confirm({ title: text.title, message: text.message, confirmLabel: text.confirmLabel, cancelLabel: 'Close' })
        return
      }
      const yes = await confirm({ title: text.title, message: text.message, confirmLabel: text.confirmLabel, destructive: true })
      if (!yes) return
      setBusyId(product.id)
      try {
        await remove.mutateAsync({ params: { path: { product_id: product.id } } })
        toast.success(text.done)
        await queryClient.invalidateQueries({ queryKey: ['get', '/v1/vendor/products'] })
        await queryClient.invalidateQueries({ queryKey: ['get', PRODUCT_PATH] })
      } catch (caught) {
        if (caught instanceof ApiError && caught.code === 'product_in_review') {
          toast.error('This product is in review, so it cannot be deleted. Wait for the decision, then try again.')
          await queryClient.invalidateQueries({ queryKey: ['get', '/v1/vendor/products'] })
        } else {
          toast.error(friendlyError(caught).message)
        }
      } finally {
        setBusyId(undefined)
      }
    },
  }

  // A page that no longer exists (the last item on it was deleted): go to the last page there is.
  const stranded = Boolean(list.data) && !list.isPlaceholderData && products.length === 0 && filters.page > 1
  useEffect(() => {
    if (stranded) apply({ page: pages }, { replace: true })
  }, [stranded, pages, apply])

  const filterBar = (
    <Box
      component="form"
      role="search"
      aria-label="Find a product"
      onSubmit={(event) => event.preventDefault()}
      sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(3, minmax(0, 1fr))' }, mb: 3 }}
    >
      <TextField
        label="Search by title or SKU"
        type="search"
        name="q"
        value={qInput}
        onChange={(event) => setQInput(event.target.value)}
        slotProps={{ htmlInput: { maxLength: 100 } }}
      />
      <TextField label="Category" name="category" value={categoryInput} onChange={(event) => setCategoryInput(event.target.value)} slotProps={{ htmlInput: { maxLength: 100 } }} />
      <TextField
        select
        label="Status"
        name="status"
        value={filters.status}
        onChange={(event) => apply({ status: event.target.value as typeof filters.status })}
        // The default is the empty value; without these MUI draws a blank box instead of "All except archived".
        slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
      >
        <MenuItem value="">All except archived</MenuItem>
        {PRODUCT_STATUSES.map((status) => (
          <MenuItem key={status} value={status}>
            {STATUS_LABEL[status]}
          </MenuItem>
        ))}
      </TextField>
    </Box>
  )

  let body
  if (list.isPending) {
    body = <ListSkeleton />
  } else if (list.isError) {
    body = <ErrorState error={list.error} title="We couldn't load your products" onRetry={() => void list.refetch()} />
  } else if (total === 0 && !filtered) {
    body = (
      <EmptyState
        title="No products yet"
        description="Add your first product, or bring many at once from a spreadsheet."
        action={
          <Stack direction="row" spacing={1} sx={{ justifyContent: 'center', flexWrap: 'wrap', gap: 1 }}>
            <Button component={Link} to="/products/new" variant="contained">
              Add a product
            </Button>
            <Button component={Link} to="/import" variant="outlined">
              Import from a spreadsheet
            </Button>
          </Stack>
        }
      />
    )
  } else if (total === 0) {
    body = (
      <EmptyState
        title="No products match"
        description="Nothing fits those filters. Try a different search, or show everything again."
        action={
          <Button variant="outlined" onClick={clear}>
            Clear filters
          </Button>
        }
      />
    )
  } else {
    body = (
      <>
        {wide ? <ProductsTable products={products} actions={actions} /> : <ProductCards products={products} actions={actions} />}
        <Stack direction="row" spacing={2} sx={{ mt: 2, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
          <Typography role="status" aria-live="polite" variant="body2" color="text.secondary">
            Showing {first}–{last} of {total} {total === 1 ? 'product' : 'products'}
          </Typography>
          <Stack component="nav" aria-label="Pages" direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Button disabled={filters.page <= 1} onClick={() => apply({ page: filters.page - 1 })}>
              Previous
            </Button>
            <Typography variant="body2">
              Page {filters.page} of {pages}
            </Typography>
            <Button disabled={filters.page >= pages} onClick={() => apply({ page: filters.page + 1 })}>
              Next
            </Button>
          </Stack>
        </Stack>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Products"
        description="Everything you sell. Open a product to edit it and send it for review."
        actions={
          <>
            <Button component={Link} to="/import" variant="outlined">
              Import
            </Button>
            <Button component={Link} to="/products/new" variant="contained">
              Add a product
            </Button>
          </>
        }
      />
      {filterBar}
      {body}
    </>
  )
}
