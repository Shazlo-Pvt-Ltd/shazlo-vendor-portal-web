import { Box, Card, Checkbox, IconButton, LinearProgress, Link, Skeleton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material'
import { emphasis, neutral } from '@shazlo/ui'
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef, type RowSelectionState, type Updater } from '@tanstack/react-table'
import { MoreHorizontal } from 'lucide-react'
import { useMemo, type MouseEvent, type ReactNode } from 'react'
import { Link as RouterLink } from 'react-router'
import type { Schemas } from '../../../api/model'
import { paths } from '../../../app/paths'
import { ColourName } from '../../../components/ColourSwatch'
import { ProductThumb } from '../../../components/ProductThumb'
import { productsCopy } from '../../../copy/products'
import { formatCount, formatINR, formatRelative } from '../../../lib/format'
import { srOnly } from '../../../lib/a11y'
import { ProductStatus } from '../status'
import { PAGE_SIZE } from './useListParams'

const copy = productsCopy.table
type Product = Schemas['ProductSummary']

// Strings, not numbers: sx reads width: 1 as 100%.
const tabular = { fontVariantNumeric: 'tabular-nums' } as const
const stop = (event: MouseEvent) => event.stopPropagation()

// Column layout; widths keep the comfortable 56 px rows from wrapping on a 1200 px page.
const layout: Record<string, { align?: 'right'; width?: number | string }> = {
  select: { width: 52 },
  category: { width: 120 },
  price: { align: 'right', width: 116 },
  stock: { align: 'right', width: 76 },
  status: { width: 196 },
  updated_at: { width: 112 },
  actions: { width: 56 },
}

export function Price({ product, align = 'right' }: { product: Product; align?: 'right' | 'left' }) {
  const { price_paise: price, mrp_paise: mrp } = product
  return (
    <Box sx={{ textAlign: align }}>
      <Typography variant="body1" component="div" sx={tabular}>
        {formatINR(price)}
      </Typography>
      {price != null && mrp != null && mrp > price && (
        <Typography variant="caption" component="div" color="textSecondary" sx={tabular}>
          {copy.mrp(formatINR(mrp))}
        </Typography>
      )}
    </Box>
  )
}

function ProductCell({ product }: { product: Product }) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', minWidth: 0 }}>
      <ProductThumb src={product.thumbnail_url} size={32} />
      <Box sx={{ minWidth: 0 }}>
        <Link
          component={RouterLink}
          to={paths.product(product.id)}
          onClick={stop}
          underline="hover"
          title={product.title}
          sx={{ ...emphasis.semibold, display: 'block', color: neutral.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 340 }}
        >
          {product.title}
        </Link>
        <Typography variant="caption" component="div" color="textSecondary" noWrap>
          <span>{product.sku}</span>
          {product.main_colour && (
            <>
              {' · '}
              <ColourName value={product.main_colour} size={10} />
            </>
          )}
        </Typography>
      </Box>
    </Stack>
  )
}

function SkeletonRows({ columns }: { columns: number }) {
  return Array.from({ length: PAGE_SIZE }, (_, i) => (
    <TableRow key={i} sx={{ height: 56 }}>
      <TableCell padding="checkbox" />
      <TableCell>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Skeleton variant="rounded" width={32} height={40} />
          <Box sx={{ flex: 1 }}>
            <Skeleton variant="text" width="70%" />
            <Skeleton variant="text" width={90} height={14} />
          </Box>
        </Stack>
      </TableCell>
      {Array.from({ length: columns - 3 }, (_, c) => (
        <TableCell key={c}>
          <Skeleton variant="text" />
        </TableCell>
      ))}
      <TableCell />
    </TableRow>
  ))
}

type Props = {
  items: Product[] | undefined
  fetching: boolean
  selection: RowSelectionState
  onSelectionChange: (next: RowSelectionState) => void
  onOpen: (product: Product) => void
  onMenu: (anchor: HTMLElement, product: Product) => void
  selectAllId: string
  footer?: ReactNode
}

export function ProductTable({ items, fetching, selection, onSelectionChange, onOpen, onMenu, selectAllId, footer }: Props) {
  const columns = useMemo<ColumnDef<Product>[]>(
    () => [
      {
        id: 'select',
        header: ({ table }) => (
          <Checkbox
            checked={table.getIsAllPageRowsSelected()}
            indeterminate={table.getIsSomePageRowsSelected()}
            onChange={table.getToggleAllPageRowsSelectedHandler()}
            disabled={table.getRowModel().rows.length === 0}
            slotProps={{ input: { 'aria-label': copy.selectAll, id: selectAllId } as object }}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
            onClick={stop}
            slotProps={{ input: { 'aria-label': copy.select(row.original.title) } as object }}
          />
        ),
      },
      { id: 'product', header: copy.product, cell: ({ row }) => <ProductCell product={row.original} /> },
      { accessorKey: 'category', header: copy.category, cell: ({ row }) => row.original.category || copy.noCategory },
      { id: 'price', header: copy.price, cell: ({ row }) => <Price product={row.original} /> },
      { accessorKey: 'stock', header: copy.stock, cell: ({ row }) => formatCount(row.original.stock) },
      { id: 'status', header: copy.status, cell: ({ row }) => <ProductStatus product={row.original} /> },
      {
        accessorKey: 'updated_at',
        header: copy.updated,
        cell: ({ row }) => (
          <Typography variant="body2" color="textSecondary" component="span" sx={{ whiteSpace: 'nowrap' }}>
            {formatRelative(row.original.updated_at)}
          </Typography>
        ),
      },
      {
        id: 'actions',
        header: () => <Box sx={srOnly}>{copy.actionsHeader}</Box>,
        cell: ({ row }) => (
          <IconButton
            aria-label={copy.actions(row.original.title)}
            aria-haspopup="menu"
            onClick={(event) => {
              event.stopPropagation()
              onMenu(event.currentTarget, row.original)
            }}
            sx={{ color: neutral.inkSecondary }}
          >
            <MoreHorizontal size={18} strokeWidth={1.75} aria-hidden="true" />
          </IconButton>
        ),
      },
    ],
    [onMenu, selectAllId],
  )

  const data = useMemo(() => items ?? [], [items])
  // TanStack Table is the picked table engine (docs/ui-plan). Its instance stays inside this
  // component, so the compiler skipping memoisation here is expected.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
    state: { rowSelection: selection },
    enableRowSelection: true,
    onRowSelectionChange: (updater: Updater<RowSelectionState>) => onSelectionChange(typeof updater === 'function' ? updater(selection) : updater),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
  })

  const loading = items === undefined

  return (
    <Card sx={{ position: 'relative' }}>
      <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, zIndex: 1 }}>
        {fetching && !loading && <LinearProgress aria-label={productsCopy.updating} sx={{ height: 2 }} />}
      </Box>
      <TableContainer>
        <Table aria-label={copy.label} aria-busy={loading || undefined} sx={{ minWidth: 860, tableLayout: 'fixed' }}>
          <TableHead>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => {
                  const { align, width } = layout[header.column.id] ?? {}
                  return (
                    <TableCell
                      key={header.id}
                      align={align}
                      padding={header.column.id === 'select' ? 'checkbox' : 'normal'}
                      sx={{ width, typography: 'subtitle2', color: 'text.secondary', py: 1, borderColor: neutral.line }}
                    >
                      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableCell>
                  )
                })}
              </TableRow>
            ))}
          </TableHead>
          <TableBody>
            {loading ? (
              <SkeletonRows columns={columns.length} />
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  selected={row.getIsSelected()}
                  onClick={() => onOpen(row.original)}
                  sx={{
                    height: 56,
                    cursor: 'pointer',
                    // Calm (spec §8): a neutral tint for hover and selection, no yellow.
                    '&.Mui-selected, &.Mui-selected:hover': { bgcolor: neutral.placeholder },
                    '@media (hover: hover)': { '&:hover:not(.Mui-selected)': { bgcolor: neutral.canvas } },
                    '&:last-of-type td': { borderBottom: footer ? undefined : 0 },
                  }}
                >
                  {row.getVisibleCells().map((cell) => {
                    const { align } = layout[cell.column.id] ?? {}
                    const id = cell.column.id
                    return (
                      <TableCell
                        key={cell.id}
                        align={align}
                        padding={id === 'select' ? 'checkbox' : id === 'actions' ? 'none' : 'normal'}
                        sx={{ py: 1, borderColor: neutral.line, ...(align === 'right' ? tabular : null) }}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
      {footer}
    </Card>
  )
}
