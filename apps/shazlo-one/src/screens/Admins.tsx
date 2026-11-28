import { Box, Button, Stack, Typography } from '@mui/material'
import { Banner, EmptyState, PageHeader, useSnackbar } from '@shazlo/ui'
import { UserPlus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { ADMINS_PAGE_SIZE, useAdmins, useRoles, useUpdateAdmin, type AdminFilters as Query } from '../api/queries'
import { adminsCopy as copy } from '../copy/admins'
import { useSession } from '../session/useSession'
import { AdminTable, type RowAction } from './admins/AdminTable'
import { AdminFilters, type Filters, type StatusFilter } from './admins/Filters'
import { InviteDialog } from './admins/InviteDialog'
import { ManageDialog, type DialogKind } from './admins/ManageDialogs'
import { refusalOf } from './admins/refusals'
import { RolesSection } from './admins/RolesSection'
import type { Admin } from './admins/shared'

const touch = { minHeight: { xs: 44, md: 36 } }
const STATUSES: StatusFilter[] = ['active', 'inactive', 'all']

// A page number from the address: a whole number from 1, anything else is page 1.
function pageOf(value: string | null): number {
  return value !== null && /^[1-9]\d{0,5}$/.test(value) ? Number(value) : 1
}

// Filters and the page live in the URL so a refresh or a shared link shows the same list. A new
// filter starts again at page 1.
function useFilters() {
  const [params, setParams] = useSearchParams()
  const status = params.get('status') as StatusFilter | null
  const filters: Filters = { q: params.get('q') ?? '', role: params.get('role') ?? '', status: status && STATUSES.includes(status) ? status : 'active' }
  const page = pageOf(params.get('page'))
  const update = useCallback(
    (patch: Partial<Filters>) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [key, value] of Object.entries(patch)) {
            if (!value || (key === 'status' && value === 'active')) next.delete(key)
            else next.set(key, value)
          }
          next.delete('page')
          return next
        },
        { replace: true },
      ),
    [setParams],
  )
  const goTo = useCallback(
    (to: number, options: { replace?: boolean } = {}) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (to <= 1) next.delete('page')
          else next.set('page', String(to))
          return next
        },
        { replace: options.replace ?? false },
      ),
    [setParams],
  )
  return { filters, page, update, goTo, clear: () => setParams(new URLSearchParams(), { replace: true }) }
}

function toQuery({ q, role, status }: Filters): Query {
  return { ...(q ? { q } : {}), ...(role ? { role } : {}), ...(status === 'all' ? {} : { is_active: status === 'active' }) }
}

// A-11: everyone who can sign in, their roles, and the account actions a super admin needs.
export default function Admins() {
  const { admin: me } = useSession()
  const notify = useSnackbar()
  const { filters, page, update, goTo, clear } = useFilters()
  const admins = useAdmins(toQuery(filters), page)
  const everyone = useAdmins({})
  const roles = useRoles()
  const reactivate = useUpdateAdmin()
  const [inviting, setInviting] = useState(false)
  const [dialog, setDialog] = useState<{ kind: DialogKind; admin: Admin; open: boolean } | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)

  // Keep the last list on screen while a new filter loads, instead of flashing skeletons.
  const [shown, setShown] = useState(admins.data)
  if (admins.data && admins.data !== shown) setShown(admins.data)
  const items = (admins.data ?? shown)?.items
  const total = (admins.data ?? shown)?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / ADMINS_PAGE_SIZE))
  // A page past the end (an old link, or the last page emptied behind us): go to the last one with admins.
  const pastTheEnd = admins.isSuccess && admins.data.items.length === 0 && admins.data.total > 0 && page > pages
  useEffect(() => {
    if (pastTheEnd) goTo(pages, { replace: true })
  }, [pastTheEnd, pages, goTo])

  const onAction = useCallback(
    async (action: RowAction, admin: Admin) => {
      setPageError(null)
      if (action !== 'reactivate') {
        setDialog({ kind: action, admin, open: true })
        return
      }
      try {
        await reactivate.mutateAsync({ id: admin.id, is_active: true })
        notify(copy.reactivated(admin.display_name))
      } catch (error) {
        setPageError(refusalOf(error).message)
      }
    },
    [notify, reactivate],
  )

  const filtered = Boolean(filters.q || filters.role || filters.status !== 'active')

  return (
    <>
      <PageHeader
        title={copy.title}
        subtitle={copy.subtitle}
        actions={
          <Button variant="contained" onClick={() => setInviting(true)} startIcon={<UserPlus size={18} strokeWidth={1.75} aria-hidden="true" />} sx={touch}>
            {copy.invite}
          </Button>
        }
      />
      <Stack spacing={{ xs: 2.5, md: 3 }}>
        {pageError && <Banner tone="error" title={pageError} onClose={() => setPageError(null)} />}
        <Stack direction="row" useFlexGap sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', columnGap: 2, rowGap: 1.5 }}>
          <AdminFilters filters={filters} roles={roles.data} onChange={update} />
          {items && (
            <Typography variant="body2" color="textSecondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              {copy.table.count(total)}
            </Typography>
          )}
        </Stack>
        {admins.isError && !items ? (
          <Banner
            tone="error"
            title={copy.table.error}
            action={
              <Button variant="outlined" sx={{ ...touch, bgcolor: 'background.paper' }} onClick={() => void admins.refetch()}>
                {copy.retry}
              </Button>
            }
          >
            {admins.error.message}
          </Banner>
        ) : (
          <AdminTable
            items={items}
            fetching={admins.isFetching}
            selfId={me?.id}
            onAction={(action, admin) => void onAction(action, admin)}
            empty={
              <EmptyState
                illustration="sheet"
                title={copy.table.emptyTitle}
                body={copy.table.emptyBody}
                action={
                  filtered ? (
                    <Button variant="outlined" onClick={clear} sx={touch}>
                      {copy.filters.clear}
                    </Button>
                  ) : undefined
                }
              />
            }
          />
        )}
        {pages > 1 && (
          <Stack component="nav" aria-label={copy.pages.label} direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'flex-end' }}>
            <Button variant="outlined" disabled={page <= 1} onClick={() => goTo(page - 1)} sx={touch}>
              {copy.pages.previous}
            </Button>
            <Typography variant="body2" color="textSecondary" aria-live="polite" sx={{ fontVariantNumeric: 'tabular-nums', px: 1 }}>
              {copy.pages.position(Math.min(page, pages), pages)}
            </Typography>
            <Button variant="outlined" disabled={page >= pages} onClick={() => goTo(page + 1)} sx={touch}>
              {copy.pages.next}
            </Button>
          </Stack>
        )}
        <Box>
          <RolesSection roles={roles.data} admins={everyone.data?.items} />
        </Box>
      </Stack>
      <InviteDialog open={inviting} onClose={() => setInviting(false)} />
      <ManageDialog target={dialog} selfId={me?.id} onClose={() => setDialog((d) => (d ? { ...d, open: false } : d))} onExited={() => setDialog(null)} />
    </>
  )
}
