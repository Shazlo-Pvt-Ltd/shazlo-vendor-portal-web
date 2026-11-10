import { Avatar, Box, Card, IconButton, LinearProgress, ListItemText, Menu, MenuItem, Skeleton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography, useMediaQuery, useTheme } from '@mui/material'
import { brand, neutral } from '@shazlo/ui'
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table'
import { MoreHorizontal } from 'lucide-react'
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { adminsCopy } from '../../copy/admins'
import { srOnly } from '../../lib/a11y'
import { formatRelative } from '../../lib/format'
import { AdminStatus, initials, RolePill, type Admin } from './shared'

const copy = adminsCopy.table
export type RowAction = 'roles' | 'reset' | 'deactivate' | 'reactivate'

const layout: Record<string, { width?: number | string }> = {
  roles: { width: 220 },
  status: { width: 240 },
  last: { width: 140 },
  actions: { width: 56 },
}
// Tablets drop the last sign-in column so the people column keeps room to read.
const tabletLayout: Record<string, { width?: number | string }> = { ...layout, roles: { width: 180 }, status: { width: 220 } }

function Person({ admin, self }: { admin: Admin; self: boolean }) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', minWidth: 0 }}>
      <Avatar aria-hidden="true" sx={{ width: 36, height: 36, bgcolor: brand.cream, color: brand.brown, fontSize: 13, flexShrink: 0 }}>
        {initials(admin.display_name)}
      </Avatar>
      <Box sx={{ minWidth: 0 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
          <Typography variant="body1" noWrap title={admin.display_name}>
            {admin.display_name}
          </Typography>
          {self && (
            <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
              {copy.you}
            </Typography>
          )}
        </Stack>
        <Typography variant="body2" color="text.secondary" noWrap title={admin.email}>
          {admin.email}
        </Typography>
      </Box>
    </Stack>
  )
}

function SkeletonRows({ last }: { last: boolean }) {
  return Array.from({ length: 4 }, (_, i) => (
    <TableRow key={i} sx={{ height: 64 }}>
      <TableCell>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Skeleton variant="circular" width={36} height={36} />
          <Box sx={{ flex: 1 }}>
            <Skeleton variant="text" width="45%" />
            <Skeleton variant="text" width="60%" height={14} />
          </Box>
        </Stack>
      </TableCell>
      <TableCell>
        <Skeleton variant="rounded" width={110} height={22} />
      </TableCell>
      <TableCell>
        <Skeleton variant="rounded" width={80} height={22} />
      </TableCell>
      {last && (
        <TableCell>
          <Skeleton variant="text" width={70} />
        </TableCell>
      )}
      <TableCell />
    </TableRow>
  ))
}

function LastSignIn({ at }: { at: string | null | undefined }) {
  return at ? <time dateTime={at}>{formatRelative(at)}</time> : <>{copy.never}</>
}

function ActionsButton({ admin, onOpen, size }: { admin: Admin; onOpen: (anchor: HTMLElement, admin: Admin) => void; size?: number }) {
  return (
    <IconButton aria-label={copy.actions(admin.display_name)} aria-haspopup="menu" onClick={(event) => onOpen(event.currentTarget, admin)} sx={{ color: neutral.inkSecondary, flexShrink: 0, ...(size ? { width: size, height: size } : {}) }}>
      <MoreHorizontal size={18} strokeWidth={1.5} aria-hidden="true" />
    </IconButton>
  )
}

// Phones: one card row per person instead of a table that would scroll sideways.
const AVATAR_GUTTER = '48px'
function PersonCards({ items, selfId, onOpen }: { items: Admin[] | undefined; selfId: string | undefined; onOpen: (anchor: HTMLElement, admin: Admin) => void }) {
  if (!items)
    return (
      <Box role="status" aria-label={copy.loading}>
        {Array.from({ length: 4 }, (_, i) => (
          <Stack key={i} direction="row" spacing={1.5} sx={{ alignItems: 'center', px: 2, py: 2, borderTop: i ? `1px solid ${neutral.line}` : 0 }}>
            <Skeleton variant="circular" width={36} height={36} />
            <Box sx={{ flex: 1 }}>
              <Skeleton variant="text" width="50%" />
              <Skeleton variant="text" width="70%" height={14} />
              <Skeleton variant="rounded" width={140} height={22} sx={{ mt: 1 }} />
            </Box>
          </Stack>
        ))}
      </Box>
    )
  if (items.length === 0) return null
  return (
    <Box component="ul" aria-label={copy.label} sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {items.map((admin, i) => (
        <Box component="li" key={admin.id} sx={{ pl: 2, pr: 0.5, py: 1.5, borderTop: i ? `1px solid ${neutral.line}` : 0 }}>
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'flex-start' }}>
            <Box sx={{ flex: 1, minWidth: 0, pt: 0.5 }}>
              <Person admin={admin} self={admin.id === selfId} />
            </Box>
            <ActionsButton admin={admin} onOpen={onOpen} size={44} />
          </Stack>
          <Stack direction="row" useFlexGap sx={{ gap: 0.75, flexWrap: 'wrap', alignItems: 'center', pl: AVATAR_GUTTER, pr: 1.5, mt: 1 }}>
            {admin.roles.map((r) => (
              <RolePill key={r} role={r} />
            ))}
            <AdminStatus admin={admin} />
          </Stack>
          <Typography variant="caption" color="text.secondary" component="p" sx={{ pl: AVATAR_GUTTER, mt: 0.75, fontVariantNumeric: 'tabular-nums' }}>
            {copy.lastSignIn}
            <Box component="span" aria-hidden="true" sx={{ mx: 0.5 }}>
              ·
            </Box>
            <Box component="span" sx={srOnly}>{': '}</Box>
            <LastSignIn at={admin.last_login_at} />
          </Typography>
        </Box>
      ))}
    </Box>
  )
}

function RowMenu({ anchor, admin, self, onClose, onAction }: { anchor: HTMLElement | null; admin: Admin | null; self: boolean; onClose: () => void; onAction: (action: RowAction, admin: Admin) => void }) {
  const m = adminsCopy.menu
  const pick = (action: RowAction) => () => {
    onClose()
    if (admin) onAction(action, admin)
  }
  const item = (label: string, action: RowAction, blockedBy?: string) => (
    <MenuItem onClick={pick(action)} disabled={Boolean(blockedBy)} sx={{ minHeight: 44, alignItems: 'flex-start', '&.Mui-disabled': { opacity: 1 } }}>
      <ListItemText
        primary={label}
        secondary={blockedBy}
        slotProps={{ primary: { sx: { color: blockedBy ? 'text.secondary' : undefined } }, secondary: { variant: 'caption', sx: { display: 'block', maxWidth: 240, whiteSpace: 'normal' } } }}
      />
    </MenuItem>
  )
  return (
    <Menu anchorEl={anchor} open={Boolean(anchor && admin)} onClose={onClose} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
      {item(m.editRoles, 'roles')}
      {item(m.resetPassword, 'reset', self ? m.selfReset : undefined)}
      {admin?.is_active === false ? item(m.reactivate, 'reactivate') : item(m.deactivate, 'deactivate', self ? m.selfDeactivate : undefined)}
    </Menu>
  )
}

type Props = { items: Admin[] | undefined; fetching: boolean; selfId: string | undefined; onAction: (action: RowAction, admin: Admin) => void; empty?: ReactNode }

export function AdminTable({ items, fetching, selfId, onAction, empty }: Props) {
  const theme = useTheme()
  const phone = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true })
  const tablet = useMediaQuery(theme.breakpoints.between('sm', 'md'), { noSsr: true })
  const [menu, setMenu] = useState<{ anchor: HTMLElement; admin: Admin } | null>(null)
  const openMenu = useCallback((anchor: HTMLElement, admin: Admin) => setMenu({ anchor, admin }), [])
  const columns = useMemo<ColumnDef<Admin>[]>(
    () => [
      { id: 'person', header: copy.person, cell: ({ row }) => <Person admin={row.original} self={row.original.id === selfId} /> },
      {
        id: 'roles',
        header: copy.roles,
        cell: ({ row }) => (
          <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap' }}>
            {row.original.roles.map((r) => (
              <RolePill key={r} role={r} />
            ))}
          </Stack>
        ),
      },
      { id: 'status', header: copy.status, cell: ({ row }) => <AdminStatus admin={row.original} /> },
      {
        id: 'last',
        header: copy.lastSignIn,
        cell: ({ row }) => {
          const at = row.original.last_login_at
          return (
            <Typography variant="body2" color="text.secondary" component="span" sx={{ whiteSpace: 'nowrap' }}>
              <LastSignIn at={at} />
            </Typography>
          )
        },
      },
      {
        id: 'actions',
        header: () => <Box sx={srOnly}>{copy.actionsHeader}</Box>,
        cell: ({ row }) => <ActionsButton admin={row.original} onOpen={openMenu} />,
      },
    ],
    [selfId, openMenu],
  )
  const data = useMemo(() => items ?? [], [items])
  // TanStack Table is the picked table engine (docs/ui-plan); its instance stays in this component.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel(), getRowId: (row) => row.id, state: { columnVisibility: { last: !tablet } } })
  const loading = items === undefined
  const widths = tablet ? tabletLayout : layout

  return (
    <Card sx={{ position: 'relative' }}>
      <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, zIndex: 1 }}>{fetching && !loading && <LinearProgress aria-label={copy.updating} sx={{ height: 2 }} />}</Box>
      {phone ? (
        <PersonCards items={items} selfId={selfId} onOpen={openMenu} />
      ) : (
        <TableContainer>
          <Table aria-label={copy.label} aria-busy={loading || undefined} sx={{ minWidth: tablet ? 640 : 820, tableLayout: 'fixed' }}>
            <TableHead>
              {table.getHeaderGroups().map((group) => (
                <TableRow key={group.id}>
                  {group.headers.map((header) => (
                    <TableCell key={header.id} sx={{ width: widths[header.column.id]?.width, typography: 'body2', color: 'text.secondary', py: 1, borderColor: neutral.line }}>
                      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableHead>
            <TableBody>
              {loading ? (
                <SkeletonRows last={!tablet} />
              ) : (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id} sx={{ height: 64, '&:last-of-type td': { borderBottom: 0 } }}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} padding={cell.column.id === 'actions' ? 'none' : 'normal'} sx={{ py: 1, borderColor: neutral.line }}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      {!loading && data.length === 0 && empty}
      <RowMenu anchor={menu?.anchor ?? null} admin={menu?.admin ?? null} self={menu?.admin.id === selfId} onClose={() => setMenu(null)} onAction={onAction} />
    </Card>
  )
}
