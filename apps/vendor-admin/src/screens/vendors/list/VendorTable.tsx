import { Avatar, Box, Card, IconButton, LinearProgress, Link, Skeleton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material'
import { brand, emphasis, neutral, StatusPill } from '@shazlo/ui'
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table'
import { MoreHorizontal } from 'lucide-react'
import { useMemo } from 'react'
import { Link as RouterLink } from 'react-router'
import type * as M from '../../../api/model'
import { modulePaths } from '../../../app/routes'
import { aboveStretch, stretchSx } from '../../../components/CardList'
import { linkRowSx, onRowClick, RowChevron } from '../../../components/rows'
import { sellsLabel, vendorsCopy } from '../../../copy/vendors'
import { srOnly } from '../../../lib/a11y'
import { formatCount, formatDate } from '../../../lib/format'
import { vendorPill } from '../../../lib/status'
import { CommissionValue } from './CommissionValue'

const copy = vendorsCopy.table
type Vendor = M.VendorSummary

const tabular = { fontVariantNumeric: 'tabular-nums' } as const
const SKELETON_ROWS = 8

// Auto layout lets the columns share a 1024 px window; only the brand and sells columns wrap.
const layout: Record<string, { align?: 'right'; width?: number | string }> = {
  live: { align: 'right' },
  commission: { align: 'right' },
  actions: { align: 'right', width: 88 },
}

export const isApplication = (v: Pick<Vendor, 'status'>) => v.status === 'applied' || v.status === 'under_review'

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('')
}

export function BrandAvatar({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <Avatar aria-hidden="true" sx={{ width: size, height: size, bgcolor: brand.cream, color: brand.brown, typography: 'caption', fontSize: size > 40 ? 16 : 12, flexShrink: 0 }}>
      {initials(name)}
    </Avatar>
  )
}

function BrandCell({ vendor }: { vendor: Vendor }) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', minWidth: 0 }}>
      <BrandAvatar name={vendor.brand_name} />
      <Box sx={{ minWidth: 0 }}>
        {/* The row's one link: its cover (stretchSx) spans the whole row. */}
        <Link component={RouterLink} to={modulePaths.vendor(vendor.id)} data-stretch="" underline="none" sx={{ ...stretchSx, ...emphasis.semibold, display: 'block', color: neutral.ink, overflowWrap: 'anywhere' }}>
          {vendor.brand_name}
        </Link>
        <Typography variant="caption" component="div" color="textSecondary">
          {vendor.city}
        </Typography>
      </Box>
    </Stack>
  )
}

function SkeletonRows({ columns }: { columns: number }) {
  return Array.from({ length: SKELETON_ROWS }, (_, i) => (
    <TableRow key={i} sx={{ height: 56 }}>
      <TableCell sx={{ px: 1.5 }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Skeleton variant="circular" width={32} height={32} />
          <Box sx={{ flex: 1 }}>
            <Skeleton variant="text" width="70%" />
            <Skeleton variant="text" width={90} height={14} />
          </Box>
        </Stack>
      </TableCell>
      {Array.from({ length: columns - 1 }, (_, c) => (
        <TableCell key={c} sx={{ px: 1.5 }}>
          <Skeleton variant="text" />
        </TableCell>
      ))}
    </TableRow>
  ))
}

type Props = {
  items: Vendor[] | undefined
  fetching: boolean
  onOpen: (vendor: Vendor) => void
  onMenu: (anchor: HTMLElement, vendor: Vendor) => void
}

export function VendorTable({ items, fetching, onOpen, onMenu }: Props) {
  const columns = useMemo<ColumnDef<Vendor>[]>(
    () => [
      { id: 'brand', header: copy.brand, cell: ({ row }) => <BrandCell vendor={row.original} /> },
      {
        id: 'owner',
        header: copy.owner,
        cell: ({ row }) => (
          <>
            <Typography variant="body1" component="div" sx={{ whiteSpace: 'nowrap' }}>
              {row.original.owner_name}
            </Typography>
            <Typography variant="mono" component="div" color="textSecondary" sx={{ whiteSpace: 'nowrap' }}>
              {row.original.phone}
            </Typography>
          </>
        ),
      },
      {
        id: 'sells',
        header: copy.sells,
        cell: ({ row }) => (
          <Typography variant="body2" component="span" sx={{ whiteSpace: 'nowrap' }}>
            {sellsLabel[row.original.sells]}
          </Typography>
        ),
      },
      { id: 'live', header: copy.liveProducts, cell: ({ row }) => formatCount(row.original.live_products) },
      {
        id: 'status',
        header: copy.status,
        cell: ({ row }) => {
          const pill = vendorPill[row.original.status]
          return <StatusPill status={pill.status} label={pill.label} />
        },
      },
      {
        id: 'since',
        header: copy.since,
        cell: ({ row }) => (
          <Typography variant="body2" component="span" color="textSecondary" sx={{ whiteSpace: 'nowrap' }}>
            {formatDate(row.original.since)}
          </Typography>
        ),
      },
      { id: 'commission', header: copy.commission, cell: ({ row }) => <CommissionValue commission={row.original.commission} /> },
      {
        id: 'actions',
        header: () => <Box sx={srOnly}>{copy.actionsHeader}</Box>,
        // Approved and suspended vendors keep their menu, above the row's link; every row ends in the chevron.
        cell: ({ row }) => (
          <Box sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5, verticalAlign: 'middle' }}>
            {!isApplication(row.original) && (
              <IconButton aria-label={copy.actions(row.original.brand_name)} aria-haspopup="menu" onClick={(event) => onMenu(event.currentTarget, row.original)} sx={{ ...aboveStretch, color: neutral.inkSecondary }}>
                <MoreHorizontal size={18} strokeWidth={1.75} aria-hidden="true" />
              </IconButton>
            )}
            <RowChevron />
          </Box>
        ),
      },
    ],
    [onMenu],
  )

  const data = useMemo(() => items ?? [], [items])
  // TanStack Table is the picked table engine (docs/ui-plan). Its instance stays inside this
  // component, so the compiler skipping memoisation here is expected.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel(), getRowId: (row) => row.id, manualSorting: true, manualFiltering: true })
  const loading = items === undefined

  return (
    <Card sx={{ position: 'relative' }}>
      <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, zIndex: 1 }}>{fetching && !loading && <LinearProgress aria-label={vendorsCopy.updating} sx={{ height: 2 }} />}</Box>
      <TableContainer>
        <Table aria-label={copy.label} aria-busy={loading || undefined}>
          <TableHead>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => {
                  const { align, width } = layout[header.column.id] ?? {}
                  return (
                    <TableCell key={header.id} align={align} sx={{ width, px: 1.5, typography: 'subtitle2', color: neutral.ink, py: 1, borderColor: neutral.line, whiteSpace: 'nowrap' }}>
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
                <TableRow key={row.id} onClick={onRowClick(() => onOpen(row.original))} sx={{ ...linkRowSx, height: 56, '&:last-of-type td': { borderBottom: 0 } }}>
                  {row.getVisibleCells().map((cell) => {
                    const { align } = layout[cell.column.id] ?? {}
                    return (
                      <TableCell key={cell.id} align={align} sx={{ px: 1.5, py: 1, borderColor: neutral.line, ...(align === 'right' ? tabular : null) }}>
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
    </Card>
  )
}
