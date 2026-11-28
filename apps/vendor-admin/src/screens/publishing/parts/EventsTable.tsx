import { Box, Card, LinearProgress, Skeleton, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { brand, emphasis, neutral, StatusPill } from '@shazlo/ui'
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table'
import { useMemo, type KeyboardEvent } from 'react'
import type * as M from '../../../api/model'
import { focusRing, RowChevron } from '../../../components/rows'
import { publishingCopy } from '../../../copy/publishing'
import { formatCount, formatRelative } from '../../../lib/format'
import { outboxPill } from '../../../lib/status'
import { formatUntil } from './when'

const copy = publishingCopy.table
type OutboxEvent = M.OutboxEvent

const DASH = '—'
const SKELETON_ROWS = 8
const tabular = { fontVariantNumeric: 'tabular-nums' } as const

// Fixed widths leave the item column the rest; the semibold headings stay on one line. With the
// details panel open the table needs about 820 px; narrower frames scroll the table, not the page.
const layout: Record<string, { align?: 'right'; width?: number }> = {
  event: { width: 176 },
  vendor: { width: 128 },
  status: { width: 112 },
  tries: { align: 'right', width: 64 },
  last: { width: 112 },
  next: { width: 116 },
  open: { width: 44 },
}

// The chevron column is a visual cue only; screen readers read the facts.
const decorative = (id: string) => id === 'open'

const cellSx = { py: 1, px: 1.5, borderColor: neutral.line } as const

function Muted({ children }: { children: string }) {
  return (
    <Typography variant="body2" color="textSecondary" component="span" sx={{ whiteSpace: 'nowrap' }}>
      {children}
    </Typography>
  )
}

function SkeletonRows({ columns }: { columns: number }) {
  return Array.from({ length: SKELETON_ROWS }, (_, i) => (
    <TableRow key={i} sx={{ height: 56 }}>
      {Array.from({ length: columns - 1 }, (_, c) => (
        <TableCell key={c} sx={cellSx}>
          <Skeleton variant="text" />
        </TableCell>
      ))}
      <TableCell aria-hidden="true" sx={cellSx} />
    </TableRow>
  ))
}

type Props = {
  items: OutboxEvent[] | undefined
  fetching: boolean
  selectedId: string | null
  onSelect: (event: OutboxEvent) => void
}

export function EventsTable({ items, fetching, selectedId, onSelect }: Props) {
  const columns = useMemo<ColumnDef<OutboxEvent>[]>(
    () => [
      {
        id: 'event',
        header: copy.event,
        cell: ({ row }) => (
          <Typography variant="mono" component="span" sx={{ display: 'block', overflowWrap: 'anywhere' }}>
            {row.original.event}
          </Typography>
        ),
      },
      {
        id: 'item',
        header: copy.item,
        cell: ({ row }) => (
          <Typography variant="body1" component="span" noWrap title={row.original.subject} sx={{ ...emphasis.semibold, display: 'block' }}>
            {row.original.subject}
          </Typography>
        ),
      },
      {
        id: 'vendor',
        header: copy.vendor,
        cell: ({ row }) => (
          <Typography variant="body2" component="span" noWrap title={row.original.vendor.name} sx={{ display: 'block' }}>
            {row.original.vendor.name}
          </Typography>
        ),
      },
      {
        id: 'status',
        header: copy.status,
        cell: ({ row }) => {
          const pill = outboxPill[row.original.status]
          return <StatusPill status={pill.status} label={pill.label} />
        },
      },
      { id: 'tries', header: copy.tries, cell: ({ row }) => formatCount(row.original.tries) },
      { id: 'last', header: copy.lastAttempt, cell: ({ row }) => <Muted>{row.original.last_attempt_at ? formatRelative(row.original.last_attempt_at) : DASH}</Muted> },
      { id: 'next', header: copy.nextAttempt, cell: ({ row }) => <Muted>{row.original.next_attempt_at ? formatUntil(row.original.next_attempt_at) : DASH}</Muted> },
      { id: 'open', header: () => null, cell: () => <RowChevron /> },
    ],
    [],
  )

  const data = useMemo(() => items ?? [], [items])
  // TanStack Table is the picked table engine (docs/ui-plan). Its instance stays inside this
  // component, so the compiler skipping memoisation here is expected.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel(), getRowId: (row) => row.id })

  const loading = items === undefined
  const selectedBg = alpha(brand.cream, 0.55)

  function onKeyDown(event: KeyboardEvent, item: OutboxEvent) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect(item)
    }
  }

  return (
    <Card sx={{ position: 'relative', minWidth: 0 }}>
      <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, zIndex: 1 }}>{fetching && !loading && <LinearProgress aria-label={publishingCopy.updating} sx={{ height: 2 }} />}</Box>
      <TableContainer>
        <Table aria-label={copy.label} aria-busy={loading || undefined} sx={{ minWidth: 824, tableLayout: 'fixed' }}>
          <TableHead>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => {
                  const { align, width } = layout[header.column.id] ?? {}
                  return (
                    <TableCell key={header.id} align={align} aria-hidden={decorative(header.column.id) || undefined} sx={{ ...cellSx, width, typography: 'subtitle2', color: neutral.ink, whiteSpace: 'nowrap' }}>
                      {flexRender(header.column.columnDef.header, header.getContext())}
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
              table.getRowModel().rows.map((row) => {
                const selected = row.id === selectedId
                return (
                  <TableRow
                    key={row.id}
                    data-item={row.original.subject}
                    tabIndex={0}
                    selected={selected}
                    aria-selected={selected}
                    onClick={() => onSelect(row.original)}
                    onKeyDown={(event) => onKeyDown(event, row.original)}
                    sx={{
                      height: 56,
                      cursor: 'pointer',
                      '&.Mui-selected, &.Mui-selected:hover': { bgcolor: selectedBg },
                      '@media (hover: hover)': { '&:hover:not(.Mui-selected)': { bgcolor: 'action.hover' }, '&:hover [data-chevron]': { color: neutral.ink } },
                      '&:focus-visible': focusRing,
                      '&:last-of-type td': { borderBottom: 0 },
                    }}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const { align } = layout[cell.column.id] ?? {}
                      return (
                        <TableCell
                          key={cell.id}
                          align={align}
                          aria-hidden={decorative(cell.column.id) || undefined}
                          sx={{ ...cellSx, ...(align === 'right' ? tabular : null), ...(decorative(cell.column.id) ? { pl: 0, textAlign: 'right' } : null) }}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      )
                    })}
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Card>
  )
}
