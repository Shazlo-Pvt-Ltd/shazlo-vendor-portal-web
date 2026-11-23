import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Pagination,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, apiQueryKey } from '../api'
import type { components } from '../api'
import { friendlyError } from '../api/friendlyError'
import { ConfirmProvider } from '../components/ConfirmDialog'
import { usePageTitle } from '../hooks/usePageTitle'
import { CreateAdminDialog } from '../features/admins/CreateAdminDialog'
import { EditAdminDialog } from '../features/admins/EditAdminDialog'
import { hasActiveFilters, pageCount, queryFromFilters, type StatusFilter } from '../features/admins/filters'
import { roleLabel } from '../features/admins/rules'
import { useAdminFilters } from '../features/admins/useAdminFilters'
import { useSession } from '../session/AuthProvider'

type AdminOut = components['schemas']['AdminOut']

function when(value: string | null): string {
  if (value === null) return 'Never'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString()
}

/**
 * The admin management screens, for `super_admin` only (the route and the navigation both check it, and
 * identity-api checks it again on every call). A super admin lists admins with search, role and status
 * filters and paging kept in the address, creates one, edits one, deactivates and reactivates, and resets a
 * password.
 */
function AdminsContent() {
  usePageTitle('Admins')
  const queryClient = useQueryClient()
  const { admin: me } = useSession()
  const { filters, apply, clear, qInput, setQInput } = useAdminFilters()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<AdminOut | undefined>()
  const [notice, setNotice] = useState<string | undefined>()

  const roles = api.useQuery('get', '/v1/roles')
  const admins = api.useQuery('get', '/v1/admins', { params: { query: queryFromFilters(filters) } })
  const reload = () => void queryClient.invalidateQueries({ queryKey: apiQueryKey('/v1/admins') })

  const roleOptions = roles.data ?? []
  const items = admins.data?.items ?? []
  const total = admins.data?.total ?? 0
  const pages = pageCount(total)
  const filtered = hasActiveFilters(filters)

  return (
    <Box>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 1 }}>
        <Typography component="h1" variant="h4" tabIndex={-1}>
          Admins
        </Typography>
        <Button variant="contained" onClick={() => setCreating(true)} disabled={roles.isPending || roles.isError}>
          Create an admin
        </Button>
      </Stack>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        Who can sign in to Shazlo-One, and what they can open. Only a super admin sees this page.
      </Typography>

      {notice ? (
        <Alert severity="success" role="status" onClose={() => setNotice(undefined)} sx={{ mb: 2 }}>
          {notice}
        </Alert>
      ) : null}

      <Box component="form" role="search" aria-label="Filter admins" onSubmit={(event) => event.preventDefault()} sx={{ mb: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
          <TextField
            label="Search by name or email"
            type="search"
            size="small"
            value={qInput}
            onChange={(event) => setQInput(event.target.value)}
            slotProps={{ htmlInput: { maxLength: 200 } }}
            sx={{ minWidth: 240 }}
          />
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel id="role-filter-label">Role</InputLabel>
            <Select
              labelId="role-filter-label"
              label="Role"
              value={roleOptions.some((role) => role.name === filters.role) || filters.role === '' ? filters.role : ''}
              onChange={(event) => apply({ role: event.target.value })}
            >
              <MenuItem value="">Any role</MenuItem>
              {roleOptions.map((role) => (
                <MenuItem key={role.name} value={role.name}>
                  {roleLabel(role.name)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel id="status-filter-label">Status</InputLabel>
            <Select
              labelId="status-filter-label"
              label="Status"
              value={filters.status}
              onChange={(event) => apply({ status: event.target.value as StatusFilter })}
            >
              <MenuItem value="all">All</MenuItem>
              <MenuItem value="active">Active</MenuItem>
              <MenuItem value="inactive">Deactivated</MenuItem>
            </Select>
          </FormControl>
          {filtered ? (
            <Button type="button" onClick={clear}>
              Clear filters
            </Button>
          ) : null}
        </Stack>
      </Box>

      {admins.isPending ? (
        <Typography role="status">Loading admins…</Typography>
      ) : admins.isError ? (
        <Alert severity="error" role="alert" action={<Button color="inherit" onClick={() => void admins.refetch()}>Retry</Button>}>
          The admins could not be loaded. {friendlyError(admins.error).message}
        </Alert>
      ) : items.length === 0 ? (
        <Box role="status">
          <Typography component="h2" variant="h6">
            {filtered ? 'No admin matches these filters' : 'There are no admins yet'}
          </Typography>
          {filtered ? (
            <Button type="button" onClick={clear} sx={{ mt: 1 }}>
              Clear filters
            </Button>
          ) : null}
        </Box>
      ) : (
        <>
          <TableContainer>
            <Table size="small" aria-label="Admins">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Email</TableCell>
                  <TableCell>Roles</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Password</TableCell>
                  <TableCell>Last sign-in</TableCell>
                  <TableCell>
                    <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Actions</span>
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {items.map((admin) => (
                  <TableRow key={admin.id} hover>
                    <TableCell sx={{ overflowWrap: 'anywhere' }}>
                      {admin.display_name}
                      {admin.id === me?.id ? ' (you)' : ''}
                    </TableCell>
                    <TableCell sx={{ overflowWrap: 'anywhere' }}>{admin.email}</TableCell>
                    <TableCell>
                      <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap' }}>
                        {admin.roles.map((role) => (
                          <Chip key={role} size="small" label={roleLabel(role)} />
                        ))}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Chip size="small" color={admin.is_active ? 'success' : 'default'} label={admin.is_active ? 'Active' : 'Deactivated'} />
                    </TableCell>
                    <TableCell>{admin.must_change_password ? <Chip size="small" color="warning" label="Must change" /> : 'Chosen by them'}</TableCell>
                    <TableCell>{when(admin.last_login_at)}</TableCell>
                    <TableCell align="right">
                      <Button size="small" onClick={() => setEditing(admin)} aria-label={`Edit ${admin.display_name}`}>
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mt: 2, flexWrap: 'wrap', gap: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {total} {total === 1 ? 'admin' : 'admins'}
              {pages > 1 ? `, page ${filters.page} of ${pages}` : ''}
            </Typography>
            {pages > 1 ? (
              <Pagination
                count={pages}
                page={Math.min(filters.page, pages)}
                onChange={(_event, page) => apply({ page })}
                aria-label="Pages of admins"
                color="primary"
              />
            ) : null}
          </Stack>
        </>
      )}

      {creating ? (
        <CreateAdminDialog
          roles={roleOptions}
          onClose={() => setCreating(false)}
          onStale={reload}
          onCreated={(created) => {
            setCreating(false)
            reload()
            setNotice(
              `Created ${created.display_name}. They must change the temporary password at their first sign-in. Hand it over in person or through a secure channel: it is never emailed.`,
            )
          }}
        />
      ) : null}

      {editing ? (
        <EditAdminDialog
          admin={editing}
          roles={roleOptions}
          isSelf={editing.id === me?.id}
          onClose={() => setEditing(undefined)}
          // The dialog stays open with the explanation while the list reloads behind it.
          onStale={reload}
          onChanged={(message) => {
            setEditing(undefined)
            reload()
            setNotice(message)
          }}
        />
      ) : null}
    </Box>
  )
}

export function AdminsPage() {
  return (
    <ConfirmProvider>
      <AdminsContent />
    </ConfirmProvider>
  )
}
