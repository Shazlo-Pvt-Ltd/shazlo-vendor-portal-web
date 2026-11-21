import { Box, Button, Card, LinearProgress, Skeleton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { brand, neutral, radius, status, statusBackground, StatusPill } from '@shazlo/ui'
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table'
import { Clock } from 'lucide-react'
import { useMemo, type MouseEvent } from 'react'
import type { components } from '../../../api/schema'
import { ProductThumb } from '../../../components/ProductThumb'
import { queueCopy } from '../../../copy/queue'
import { srOnly } from '../../../lib/a11y'
import { formatStamp } from '../../../lib/format'
import { formatWait, queuePill } from '../../../lib/status'

const copy = queueCopy.table
type QueueItem = components['schemas']['QueueItem']

const DAY_MS = 24 * 3_600_000
const SKELETON_ROWS = 8
const tabular = { fontVariantNumeric: 'tabular-nums' } as const

// Column widths keep the 56 px rows on one line on a 1,100 px module; narrower frames scroll the table, not the page.
const layout: Record<string, { width?: number | string }> = {
  item: {},
  vendor: { width: 170 },
  submitted: { width: 140 },
  waiting: { width: 100 },
  type: { width: 190 },
  actions: { width: 104 },
}

const waitedMs = (iso: string) => Date.now() - Date.parse(iso)

// Applications have no photo yet: the brand's initials stand in, shaped like the product thumbs.
export function Initials({ name }: { name: string }) {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
  return (
    <Box aria-hidden="true" sx={{ width: 32, height: 40, flexShrink: 0, borderRadius: `${radius.control}px`, bgcolor: neutral.muted, color: neutral.inkSecondary, display: 'grid', placeItems: 'center', typography: 'body2' }}>
      {letters}
    </Box>
  )
}

function ItemCell({ item }: { item: QueueItem }) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', minWidth: 0 }}>
      {item.kind === 'application' ? <Initials name={item.title} /> : <ProductThumb src={item.thumbnail_url} size={32} />}
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body1" component="div" noWrap title={item.title} sx={{ color: neutral.ink }}>
          {item.title}
        </Typography>
        {item.kind === 'product' ? (
          <Typography variant="mono" component="div" color="text.secondary" noWrap>
            {item.detail}
          </Typography>
        ) : (
          <Typography variant="caption" component="div" color="text.secondary" noWrap>
            {item.detail}
          </Typography>
        )}
      </Box>
    </Stack>
  )
}

// Over a day is flagged with a tint and a clock, so it never rests on colour alone.
export function Waiting({ submittedAt }: { submittedAt: string }) {
  const ms = waitedMs(submittedAt)
  const text = formatWait(ms)
  if (ms <= DAY_MS) {
    return (
      <Typography variant="body2" component="span" sx={{ ...tabular, whiteSpace: 'nowrap' }}>
        {text}
      </Typography>
    )
  }
  return (
    <Box
      component="span"
      data-overdue="true"
      title={copy.overADay}
      sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, height: 22, px: 1, borderRadius: `${radius.pill}px`, bgcolor: statusBackground.warning, color: status.warning, typography: 'caption', lineHeight: 1, whiteSpace: 'nowrap', ...tabular }}
    >
      <Clock size={12} strokeWidth={2} aria-hidden="true" />
      {text}
    </Box>
  )
}

function SkeletonRows({ columns }: { columns: number }) {
  return Array.from({ length: SKELETON_ROWS }, (_, i) => (
    <TableRow key={i} sx={{ height: 56 }}>
      <TableCell>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Skeleton variant="rounded" width={32} height={40} />
          <Box sx={{ flex: 1 }}>
            <Skeleton variant="text" width="70%" />
            <Skeleton variant="text" width={90} height={14} />
          </Box>
        </Stack>
      </TableCell>
      {Array.from({ length: columns - 2 }, (_, c) => (
        <TableCell key={c}>
          <Skeleton variant="text" />
        </TableCell>
      ))}
      <TableCell>
        <Skeleton variant="rounded" width={72} height={30} />
      </TableCell>
    </TableRow>
  ))
}

type Props = {
  items: QueueItem[] | undefined
  fetching: boolean
  onOpen: (item: QueueItem) => void
}

export function QueueTable({ items, fetching, onOpen }: Props) {
  const columns = useMemo<ColumnDef<QueueItem>[]>(
    () => [
      { id: 'item', header: copy.item, cell: ({ row }) => <ItemCell item={row.original} /> },
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
        id: 'submitted',
        header: copy.submitted,
        cell: ({ row }) => (
          <Typography variant="body2" color="text.secondary" component="span" sx={{ whiteSpace: 'nowrap' }}>
            {formatStamp(row.original.submitted_at)}
          </Typography>
        ),
      },
      { id: 'waiting', header: copy.waiting, cell: ({ row }) => <Waiting submittedAt={row.original.submitted_at} /> },
      {
        id: 'type',
        header: copy.type,
        cell: ({ row }) => {
          const pill = queuePill(row.original)
          return <StatusPill status={pill.status} label={pill.label} />
        },
      },
      {
        id: 'actions',
        header: () => <Box sx={srOnly}>{copy.actions}</Box>,
        cell: ({ row }) => (
          <Button
            variant="outlined"
            size="small"
            aria-label={copy.reviewLabel(row.original.title)}
            onClick={(event: MouseEvent) => {
              event.stopPropagation()
              onOpen(row.original)
            }}
          >
            {copy.review}
          </Button>
        ),
      },
    ],
    [onOpen],
  )

  const data = useMemo(() => items ?? [], [items])
  // TanStack Table is the picked table engine (docs/ui-plan). Its instance stays inside this
  // component, so the compiler skipping memoisation here is expected.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel(), getRowId: (row) => row.id, manualSorting: true, manualFiltering: true })

  const loading = items === undefined

  return (
    <Card sx={{ position: 'relative' }}>
      <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, zIndex: 1 }}>{fetching && !loading && <LinearProgress aria-label={queueCopy.updating} sx={{ height: 2 }} />}</Box>
      <TableContainer>
        <Table aria-label={copy.label} aria-busy={loading || undefined} sx={{ minWidth: 900, tableLayout: 'fixed' }}>
          <TableHead>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => (
                  <TableCell key={header.id} sx={{ width: layout[header.column.id]?.width, typography: 'body2', color: 'text.secondary', py: 1, borderColor: neutral.line }}>
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableCell>
                ))}
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
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} sx={{ py: 1, borderColor: neutral.line }}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Card>
  )
}
