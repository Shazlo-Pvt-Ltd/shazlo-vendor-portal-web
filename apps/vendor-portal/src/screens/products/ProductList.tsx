import { Box, Button, Skeleton, Stack, Tab, Tabs, Typography, useMediaQuery } from '@mui/material'
import { type Theme } from '@mui/material/styles'
import { Banner, brand, EmptyState, neutral, PageHeader, useSnackbar } from '@shazlo/ui'
import type { RowSelectionState } from '@tanstack/react-table'
import { Plus, Upload } from 'lucide-react'
import { lazy, Suspense, useCallback, useId, useState } from 'react'
import { Link as RouterLink, useLocation, useNavigate } from 'react-router'
import type { Schemas } from '../../api/client'
import { useBulkProducts, useProducts } from '../../api/queries'
import { paths } from '../../app/paths'
import { productsCopy as copy } from '../../copy/products'
import { formatCount } from '../../lib/format'
import { productTabs } from '../../lib/status'
import { ArchiveDialog, BulkBar, OutcomeBanner, RowMenu, type BulkAction, type BulkOutcome } from './list/BulkBar'
import { DesktopFilters, MobileFilters } from './list/Filters'
import { ProductCards } from './list/ProductCards'
import { ProductTable } from './list/ProductTable'
import { activeFilterCount, PAGE_SIZE, toFilters, useListParams, type ListParams } from './list/useListParams'

// The wizard is its own chunk: most visits to Products never open it.
const BulkImportDialog = lazy(() => import('../import/BulkImportDialog'))

type Product = Schemas['ProductSummary']
type Counts = Schemas['StatusCounts']

const icon = { size: 18, strokeWidth: 1.5, 'aria-hidden': true } as const

function HeaderActions({ importTo }: { importTo: { pathname: string; search: string } }) {
  return (
    <>
      <Button variant="outlined" component={RouterLink} to={importTo} startIcon={<Upload {...icon} />}>
        {copy.bulkImport}
      </Button>
      <Button variant="contained" component={RouterLink} to={paths.newProduct} startIcon={<Plus {...icon} />}>
        {copy.addProduct}
      </Button>
    </>
  )
}

function StatusTabs({ value, counts, onChange }: { value: string; counts: Counts | undefined; onChange: (key: string) => void }) {
  return (
    <Tabs
      value={value}
      onChange={(_, key: string) => onChange(key)}
      variant="scrollable"
      scrollButtons="auto"
      aria-label={copy.tabsLabel}
      textColor="inherit"
      sx={{ borderBottom: `1px solid ${neutral.line}`, minHeight: 44, '& .MuiTabs-indicator': { bgcolor: brand.brown } }}
    >
      {productTabs.map((tab) => (
        <Tab
          key={tab.key}
          value={tab.key}
          sx={{ minHeight: 44, px: 2, color: 'text.secondary', '&.Mui-selected': { color: neutral.ink } }}
          label={
            <span>
              {tab.label}
              {counts && (
                <>
                  {' '}
                  <Box component="span" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums', ml: 0.25 }}>
                    {formatCount(counts[tab.key])}
                  </Box>
                </>
              )}
            </span>
          }
        />
      ))}
    </Tabs>
  )
}

function Pagination({ page, shown, total, onPage }: { page: number; shown: number; total: number; onPage: (page: number) => void }) {
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const to = (page - 1) * PAGE_SIZE + shown
  return (
    <Stack
      component="nav"
      aria-label={copy.pagination.label}
      direction="row"
      spacing={1.5}
      sx={{ alignItems: 'center', justifyContent: 'space-between', px: { xs: 0, md: 2 }, py: 1.5, borderTop: { md: `1px solid ${neutral.line}` } }}
    >
      <Typography variant="body2" color="text.secondary" role="status" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {copy.pagination.showing(from, to, total)}
      </Typography>
      <Stack direction="row" spacing={1}>
        <Button variant="outlined" size="small" disabled={page <= 1} onClick={() => onPage(page - 1)} sx={{ minHeight: { xs: 44, md: 32 } }}>
          {copy.pagination.previous}
        </Button>
        <Button variant="outlined" size="small" disabled={to >= total} onClick={() => onPage(page + 1)} sx={{ minHeight: { xs: 44, md: 32 } }}>
          {copy.pagination.next}
        </Button>
      </Stack>
    </Stack>
  )
}

// Which empty state fits: a brand-new catalogue, a quiet tab, or filters that match nothing.
function ListEmpty({ params, onClearFilters, onShowAll, importTo }: { params: ListParams; onClearFilters: () => void; onShowAll: () => void; importTo: { pathname: string; search: string } }) {
  if (params.q || activeFilterCount(params) > 0) {
    return (
      <EmptyState
        illustration="box"
        title={copy.noResults.title}
        body={copy.noResults.body}
        action={
          <Button variant="outlined" onClick={onClearFilters}>
            {copy.noResults.clear}
          </Button>
        }
      />
    )
  }
  if (params.status) {
    const tab = copy.emptyTab[params.status]
    return (
      <EmptyState
        illustration="box"
        title={tab.title}
        body={tab.body}
        action={
          <Button variant="outlined" onClick={onShowAll}>
            {copy.emptyTab.showAll}
          </Button>
        }
      />
    )
  }
  return <CatalogueEmpty importTo={importTo} />
}

function CatalogueEmpty({ importTo }: { importTo: { pathname: string; search: string } }) {
  return (
    <EmptyState
      illustration="kurta"
      tip={copy.empty.tip}
      title={copy.empty.title}
      body={copy.empty.body}
      action={
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <Button variant="contained" component={RouterLink} to={paths.newProduct} startIcon={<Plus {...icon} />}>
            {copy.addProduct}
          </Button>
          <Button variant="outlined" component={RouterLink} to={importTo} startIcon={<Upload {...icon} />}>
            {copy.bulkImport}
          </Button>
        </Stack>
      }
    />
  )
}

export default function ProductList({ importOpen }: { importOpen?: boolean }) {
  const desktop = useMediaQuery((t: Theme) => t.breakpoints.up('md'))
  const navigate = useNavigate()
  const { search } = useLocation()
  const notify = useSnackbar()
  const selectAllId = useId()
  const [params, update] = useListParams()
  const filters = toFilters(params)
  const query = useProducts(filters)
  const { data } = query
  const bulk = useBulkProducts()

  // Selection belongs to one page of one query: a new tab, filter or page starts with none.
  const selectionKey = JSON.stringify(filters)
  const [selection, setSelection] = useState<{ key: string; rows: RowSelectionState }>({ key: selectionKey, rows: {} })
  const rowSelection = selection.key === selectionKey ? selection.rows : {}
  const selectedIds = Object.keys(rowSelection).filter((id) => rowSelection[id])
  const [menu, setMenu] = useState<{ anchor: HTMLElement; product: Product } | null>(null)
  // Kept after closing (open: false) so the dialog keeps its words while it fades out.
  const [confirm, setConfirm] = useState<{ ids: string[]; name?: string; open: boolean } | null>(null)
  const closeConfirm = () => setConfirm((c) => c && { ...c, open: false })
  const [outcome, setOutcome] = useState<BulkOutcome | null>(null)
  const [pending, setPending] = useState<BulkAction | null>(null)

  const importTo = { pathname: paths.bulkImport, search }
  const onSearch = useCallback((q: string) => update({ q }, { replace: true }), [update])
  const onMenu = useCallback((anchor: HTMLElement, product: Product) => setMenu({ anchor, product }), [])
  const clearFilters = () => update({ q: undefined, category: undefined, gender: undefined, stock: undefined })
  const clearSelection = () => setSelection({ key: selectionKey, rows: {} })
  const focusSelectAll = () => requestAnimationFrame(() => document.getElementById(selectAllId)?.focus())

  async function run(action: BulkAction, ids: string[]) {
    setOutcome(null)
    setPending(action)
    const name = (id: string) => data?.items.find((p) => p.id === id)?.title ?? id
    try {
      const { results } = await bulk.mutateAsync({ action, ids })
      const done = results.filter((r) => r.ok).length
      const failed = results.filter((r) => !r.ok)
      if (done) notify(action === 'submit' ? copy.results.submitted(done) : copy.results.archived(done))
      if (failed.length) {
        setOutcome({
          tone: 'warning',
          title: action === 'submit' ? copy.results.notSubmitted(failed.length) : copy.results.notArchived(failed.length),
          messages: failed.map((r) => r.message ?? `${name(r.id)}: ${copy.results.failed}`),
        })
      }
      clearSelection()
    } catch (error) {
      setOutcome({ tone: 'error', title: copy.results.failed, messages: [error instanceof Error ? error.message : ''].filter(Boolean) })
    } finally {
      setPending(null)
      closeConfirm()
    }
  }

  const askArchive = (ids: string[], name?: string) => setConfirm({ ids, name, open: true })
  const onBulk = (action: BulkAction) => (action === 'archive' ? askArchive(selectedIds) : void run('submit', selectedIds).then(focusSelectAll))
  const onRowAction = (action: BulkAction, product: Product) => {
    setMenu(null)
    if (action === 'archive') askArchive([product.id], product.title)
    else void run('submit', [product.id])
  }
  const openProduct = (product: Product) => navigate(paths.product(product.id))
  const closeImport = () => navigate({ pathname: paths.products, search })

  const catalogueEmpty = data !== undefined && data.counts.all === 0 && data.counts.archived === 0
  const items = data?.items
  const showSelection = desktop && selectedIds.length > 0

  const errorBanner = query.isError ? (
    <Banner
      tone="error"
      title={copy.error.title}
      action={
        <Button variant="outlined" size="small" onClick={() => void query.refetch()} disabled={query.isFetching}>
          {copy.error.retry}
        </Button>
      }
    >
      {query.error.message}
    </Banner>
  ) : null

  let body
  if (query.isError && !data) {
    body = null
  } else if (data && data.items.length === 0 && data.total > 0) {
    body = (
      <EmptyState
        illustration="box"
        title={copy.pagination.pastEnd}
        action={
          <Button variant="outlined" onClick={() => update({ page: undefined })}>
            {copy.pagination.firstPage}
          </Button>
        }
      />
    )
  } else if (items && items.length === 0) {
    body = <ListEmpty params={params} onClearFilters={clearFilters} onShowAll={() => update({ status: undefined })} importTo={importTo} />
  } else {
    const footer = data ? <Pagination page={params.page} shown={data.items.length} total={data.total} onPage={(page) => update({ page })} /> : null
    body = desktop ? (
      <ProductTable
        items={items}
        fetching={query.isFetching}
        selection={rowSelection}
        onSelectionChange={(rows) => setSelection({ key: selectionKey, rows })}
        onOpen={openProduct}
        onMenu={onMenu}
        selectAllId={selectAllId}
        footer={footer}
      />
    ) : (
      <>
        <ProductCards items={items} fetching={query.isFetching && data !== undefined} />
        {footer}
      </>
    )
  }

  return (
    <>
      <PageHeader
        title={copy.title}
        subtitle={data ? copy.subtitle(data.counts.all, data.counts.approved) : query.isPending ? <Skeleton variant="text" width={240} component="span" sx={{ display: 'inline-block' }} /> : undefined}
        actions={catalogueEmpty ? undefined : <HeaderActions importTo={importTo} />}
      />

      {catalogueEmpty ? (
        <CatalogueEmpty importTo={importTo} />
      ) : (
        <Stack spacing={2}>
          {outcome && <OutcomeBanner outcome={outcome} onClose={() => setOutcome(null)} />}
          {errorBanner}
          <StatusTabs value={params.status ?? 'all'} counts={data?.counts} onChange={(key) => update({ status: key === 'all' ? undefined : key })} />
          {showSelection ? (
            <BulkBar
              count={selectedIds.length}
              pending={pending}
              onAction={onBulk}
              onClear={() => {
                clearSelection()
                focusSelectAll()
              }}
            />
          ) : desktop ? (
            <DesktopFilters params={params} update={update} onSearch={onSearch} />
          ) : (
            <MobileFilters params={params} update={update} onSearch={onSearch} onClear={clearFilters} />
          )}
          {body}
        </Stack>
      )}

      <RowMenu target={menu} onClose={() => setMenu(null)} onEdit={(product) => navigate(paths.product(product.id))} onAction={onRowAction} />
      <ArchiveDialog target={confirm} pending={pending === 'archive'} onCancel={closeConfirm} onConfirm={() => confirm && void run('archive', confirm.ids).then(focusSelectAll)} />
      {importOpen && (
        <Suspense fallback={null}>
          <BulkImportDialog onClose={closeImport} />
        </Suspense>
      )}
    </>
  )
}
