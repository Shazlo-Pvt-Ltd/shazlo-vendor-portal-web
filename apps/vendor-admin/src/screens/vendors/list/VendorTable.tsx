import { Avatar, Box, Button, Card, IconButton, LinearProgress, Link, Skeleton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { brand, neutral, StatusPill } from '@shazlo/ui'
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table'
import { MoreHorizontal } from 'lucide-react'
import { useMemo, type MouseEvent } from 'react'
import { Link as RouterLink } from 'react-router'
import type { components } from '../../../api/schema'
import { modulePaths } from '../../../app/routes'
import { vendorsCopy } from '../../../copy/vendors'
import { srOnly } from '../../../lib/a11y'
import { formatCount, formatDate } from '../../../lib/format'
import { vendorPill } from '../../../lib/status'
import { formatCommission } from './csv'

const copy = vendorsCopy.table
type Vendor = components['schemas']['VendorSummary']

const tabular = { fontVariantNumeric: 'tabular-nums' } as const
const stop = (event: MouseEvent) => event.stopPropagation()
const SKELETON_ROWS = 8

// Auto layout lets the columns share a 1024 px window; only the brand and sells columns wrap.
const layout: Record<string, { align?: 'right'; width?: number | string }> = {
  live: { align: 'right' },
  commission: { align: 'right' },
  actions: { align: 'right', width: 96 },
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
        <Link component={RouterLink} to={modulePaths.vendor(vendor.id)} onClick={stop} underline="hover" sx={{ display: 'block', color: neutral.ink, overflowWrap: 'anywhere' }}>
          {vendor.brand_name}
        </Link>
        <Typography variant="caption" component="div" color="text.secondary">
          {vendor.city}
        </Typography>
      </Box>
    </Stack>
  )
}

function Sells({ sells }: { sells: string[] }) {
  if (sells.length === 0) return <>—</>
  const extra = sells.length - 2
  return (
    <Typography variant="body2" component="span">
      {sells.slice(0, 2).join(', ')}
      {extra > 0 && (
        <Box component="span" sx={{ color: 'text.secondary' }}>
          {' '}
          {copy.more(extra)}
        </Box>
      )}
    </Typography>
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
            <Typography variant="mono" component="div" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
              {row.original.phone}
            </Typography>
          </>
        ),
      },
      { id: 'sells', header: copy.sells, cell: ({ row }) => <Sells sells={row.original.sells} /> },
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
          <Typography variant="body2" component="span" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
            {formatDate(row.original.since)}
          </Typography>
        ),
      },
      { id: 'commission', header: copy.commission, cell: ({ row }) => formatCommission(row.original.commission_bps) },
      {
        id: 'actions',
        header: () => <Box sx={srOnly}>{copy.actionsHeader}</Box>,
        cell: ({ row }) =>
          isApplication(row.original) ? (
            <Button variant="outlined" size="small" component={RouterLink} to={modulePaths.vendor(row.original.id)} onClick={stop} aria-label={copy.reviewLabel(row.original.brand_name)}>
              {copy.review}
            </Button>
          ) : (
            <IconButton
              aria-label={copy.actions(row.original.brand_name)}
              aria-haspopup="menu"
              onClick={(event) => {
                event.stopPropagation()
                onMenu(event.currentTarget, row.original)
              }}
              sx={{ color: neutral.inkSecondary }}
            >
              <MoreHorizontal size={18} strokeWidth={1.5} aria-hidden="true" />
            </IconButton>
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
                    <TableCell key={header.id} align={align} sx={{ width, px: 1.5, typography: 'body2', color: 'text.secondary', py: 1, borderColor: neutral.line, whiteSpace: 'nowrap' }}>
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
                  onClick={() => onOpen(row.original)}
                  sx={{
                    height: 56,
                    cursor: 'pointer',
                    '@media (hover: hover)': { '&:hover': { bgcolor: alpha(brand.cream, 0.25) } },
                    '&:last-of-type td': { borderBottom: 0 },
                  }}
                >
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
