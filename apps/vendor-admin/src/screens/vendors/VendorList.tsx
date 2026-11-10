// A-08 · Vendors: every vendor account and application, tabbed by the vendor state machine (flow S1).
import Popover from '@mui/material/Popover'
import { styled } from '@mui/material/styles'
import { useMemo, useState, type MouseEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import {
  Avatar, Button, Card, EmptyState, Icon, IconButton, kit, Mono, PageHeader, Skeleton, Table, TableFrame, Tabs, Text, TextInput, textStyle,
} from '@shazlo/ui/components'
import { useReactivateVendor, useVendors, type Vendor, type VendorStatus } from '../../api'
import { useModuleTitle, useShell } from '../../app/shell'
import { downloadCsv, plural } from '../shared/format'
import { CardLine, CardList, ErrorCard, FilterMenu, RowCard, Screen, Toolbar, useIsCompact, useIsPhone } from '../shared/ui'
import { needsDecision, SuspendDialog, VendorStatusBadge, vendorStatusLabel } from './shared'

type Tab = 'all' | VendorStatus

const rank: Record<VendorStatus, number> = { under_review: 0, applied: 1, approved: 2, suspended: 3, rejected: 4 }

const sortOptions = [
  { value: 'action', label: 'Needs action first' },
  { value: 'name', label: 'Name A–Z' },
  { value: 'live', label: 'Most live products' },
]

const MenuItem = styled('button')({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '8px 12px',
  border: 0,
  borderRadius: 4,
  background: 'transparent',
  ...textStyle.small,
  color: kit.ink,
  cursor: 'pointer',
  textAlign: 'left',
  '&:hover, &:focus-visible': { background: kit.chip, outline: 'none' },
})

function RowMenu({ vendor, onSuspend, className }: { vendor: Vendor; onSuspend: () => void; className?: string }) {
  const navigate = useNavigate()
  const { toast } = useShell()
  const reactivate = useReactivateVendor()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const close = () => setAnchor(null)
  return (
    <>
      <IconButton className={className} aria-label={`More actions for ${vendor.brand}`} aria-haspopup="menu" aria-expanded={Boolean(anchor)} onClick={e => setAnchor(e.currentTarget)} style={{ margin: '-8px -8px -8px 0' }}>
        <Icon name="more" size={16} color={kit.ink} />
      </IconButton>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { mt: 0.5, p: 0.5, minWidth: 180, background: kit.surface, border: `1px solid ${kit.line}`, borderRadius: '8px', boxShadow: '0 12px 24px rgba(23, 18, 14, 0.12)' } } }}
      >
        <div role="menu" aria-label={`${vendor.brand} actions`}>
          <MenuItem role="menuitem" autoFocus onClick={() => { close(); navigate(`/vendors/${vendor.id}`) }}>
            <Icon name="eye" size={16} /> Open vendor
          </MenuItem>
          {vendor.status === 'approved' && (
            <MenuItem role="menuitem" style={{ color: '#8F3504' }} onClick={() => { close(); onSuspend() }}>
              <Icon name="ban" size={16} /> Suspend…
            </MenuItem>
          )}
          {vendor.status === 'suspended' && (
            <MenuItem
              role="menuitem"
              disabled={reactivate.isPending}
              onClick={() => reactivate.mutate(vendor.id, {
                onSuccess: () => { close(); toast('success', `${vendor.brand} is active again. Their products return to the app within minutes.`) },
                onError: e => toast('error', e.message),
              })}
            >
              <Icon name="refresh" size={16} /> Reactivate
            </MenuItem>
          )}
        </div>
      </Popover>
    </>
  )
}

/** The brand name as the card's link, covering the card (vendors with no decision to make). */
const BrandLink = styled(Link)({
  ...textStyle.label,
  color: kit.ink,
  textDecoration: 'none',
  borderRadius: 4,
  '&:focus-visible': { outline: `2px solid ${kit.focus}`, outlineOffset: 2 },
})

/** The decision a vendor's row offers: Open (under review), Review (applied), else the row menu. */
function decisionLink(v: Vendor) {
  if (v.status === 'under_review') return { label: 'Open', name: `Open ${v.brand}` }
  if (v.status === 'applied') return { label: 'Review', name: `Review ${v.brand}` }
  return null
}

/** A-08 on phones: each vendor is a card; tapping it opens the vendor. */
function VendorCards({ rows, onSuspend }: { rows: Vendor[]; onSuspend: (v: Vendor) => void }) {
  return (
    <CardList aria-label="Vendors">
      {rows.map(v => {
        const decision = decisionLink(v)
        return (
          <RowCard key={v.id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <Avatar initials={v.initials} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                {decision ? <Text v="label">{v.brand}</Text> : <BrandLink className="stretch" to={`/vendors/${v.id}`}>{v.brand}</BrandLink>}
                <Text v="caption" tone="subtle">{v.city} · {v.categories.join(', ')}</Text>
              </div>
              {!decision && <RowMenu vendor={v} className="above" onSuspend={() => onSuspend(v)} />}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <Text v="small">{v.owner}</Text>
              <Mono>{v.phone}</Mono>
            </div>
            <CardLine>
              <VendorStatusBadge status={v.status} />
              <Text v="caption" tone="muted" tabular>
                {[v.liveCount === null ? null : `${v.liveCount} live`, v.commissionPct === null ? null : `${v.commissionPct}%`, `since ${v.sinceLabel}`].filter(Boolean).join(' · ')}
              </Text>
            </CardLine>
            {decision && (
              <Button size="sm" fullWidth className="stretch shz-btn" to={`/vendors/${v.id}`} aria-label={decision.name} iconEnd="chevronRight">{decision.label}</Button>
            )}
          </RowCard>
        )
      })}
    </CardList>
  )
}

export function VendorList() {
  useModuleTitle('Vendors')
  const navigate = useNavigate()
  const phone = useIsPhone()
  const compact = useIsCompact()
  const vendors = useVendors()
  const [tab, setTab] = useState<Tab>('all')
  const [search, setSearch] = useState('')
  const [city, setCity] = useState('all')
  const [sells, setSells] = useState('any')
  const [sort, setSort] = useState('action')
  const [suspending, setSuspending] = useState<Vendor | null>(null)

  const all = useMemo(() => vendors.data ?? [], [vendors.data])
  const count = (s: VendorStatus) => all.filter(v => v.status === s).length

  const cityOptions = useMemo(() => [{ value: 'all', label: 'All' }, ...[...new Set(all.map(v => v.city))].sort().map(c => ({ value: c, label: c }))], [all])
  const sellsOptions = useMemo(() => [{ value: 'any', label: 'Any' }, ...[...new Set(all.flatMap(v => v.categories))].sort().map(c => ({ value: c, label: c[0]!.toUpperCase() + c.slice(1) }))], [all])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const digits = q.replace(/\D/g, '')
    const list = all.filter(v =>
      (tab === 'all' || v.status === tab)
      && (city === 'all' || v.city === city)
      && (sells === 'any' || v.categories.includes(sells))
      && (!q || [v.brand, v.owner, v.email].some(s => s.toLowerCase().includes(q)) || (digits.length >= 3 && v.phone.replace(/\D/g, '').includes(digits))))
    return [...list].sort((a, b) => {
      if (sort === 'name') return a.brand.localeCompare(b.brand)
      if (sort === 'live') return (b.liveCount ?? -1) - (a.liveCount ?? -1) || a.seq - b.seq
      return rank[a.status] - rank[b.status] || a.seq - b.seq
    })
  }, [all, tab, city, sells, search, sort])

  const pendingDecisions = all.filter(needsDecision).length
  const onRowClick = (e: MouseEvent, v: Vendor) => {
    if ((e.target as HTMLElement).closest('a, button, .MuiModal-root')) return
    navigate(`/vendors/${v.id}`)
  }

  const exportCsv = () => downloadCsv('vendors.csv', [
    ['Vendor', 'City', 'Sells', 'Owner', 'Phone', 'Email', 'Live products', 'Status', 'Since', 'Commission'],
    ...rows.map(v => [v.brand, v.city, v.categories.join('; '), v.owner, v.phone, v.email, v.liveCount, vendorStatusLabel[v.status], v.sinceLabel, v.commissionPct === null ? null : `${v.commissionPct}%`]),
  ])

  return (
    <Screen>
      <PageHeader
        title="Vendors"
        subtitle={vendors.data ? `${plural(all.length, 'vendor')} · ${plural(pendingDecisions, 'application')} ${pendingDecisions === 1 ? 'needs' : 'need'} a decision` : ' '}
        actions={<Button size="sm" icon="download" onClick={exportCsv} disabled={!rows.length}>Export CSV</Button>}
      />

      {vendors.isError ? (
        <ErrorCard title="The vendor list didn’t load" onRetry={() => vendors.refetch()}>
          vendor-api did not answer. Check your connection and try again.
        </ErrorCard>
      ) : (
        <>
          <Tabs<Tab>
            label="Vendor status"
            value={tab}
            onChange={setTab}
            items={[
              { value: 'all', label: 'All', count: all.length },
              { value: 'applied', label: 'Applied', count: count('applied') },
              { value: 'under_review', label: 'Under review', count: count('under_review') },
              { value: 'approved', label: 'Approved', count: count('approved') },
              { value: 'rejected', label: 'Rejected', count: count('rejected') },
              { value: 'suspended', label: 'Suspended', count: count('suspended') },
            ]}
          />

          <Toolbar>
            <TextInput
              icon="search"
              type="search"
              aria-label="Search brand, owner, email or phone"
              placeholder="Search brand, owner, email or phone"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: 320, maxWidth: '100%' }}
            />
            <FilterMenu label="City" value={city} options={cityOptions} onChange={setCity} />
            <FilterMenu label="Sells" value={sells} options={sellsOptions} onChange={setSells} />
            <span className="spacer" />
            <FilterMenu bare label="Sort" value={sort} options={sortOptions} onChange={setSort} />
          </Toolbar>

          {vendors.isPending ? (
            <TableFrame role="status" aria-label="Loading vendors">
              {[0, 1, 2, 3, 4, 5].map(i => (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '12px 16px', borderTop: i ? `1px solid ${kit.line}` : 0 }}>
                  <Skeleton width={28} height={28} radius={14} />
                  <Skeleton width="25%" />
                  <Skeleton width="12%" style={{ marginLeft: 'auto' }} />
                </div>
              ))}
            </TableFrame>
          ) : rows.length === 0 ? (
            <Card pad={0}>
              <EmptyState
                icon="users"
                title={all.length ? 'No vendors match' : 'No vendors yet'}
                action={all.length ? <Button size="sm" onClick={() => { setSearch(''); setCity('all'); setSells('any'); setTab('all') }}>Clear filters</Button> : undefined}
              >
                {all.length ? 'Try another name, city or category, or clear the filters.' : 'Applications from the website’s “Sell on Shazlo” form appear here.'}
              </EmptyState>
            </Card>
          ) : phone ? (
            <VendorCards rows={rows} onSuspend={setSuspending} />
          ) : (
            <TableFrame style={{ position: 'relative' }}>
              {/* Tablets drop Since and Commission (both are on the vendor's page). */}
              <Table aria-label="Vendors" style={{ tableLayout: 'fixed', minWidth: compact ? 640 : 900 }}>
                <colgroup>
                  <col />
                  <col style={{ width: compact ? 160 : 186 }} />
                  <col style={{ width: compact ? 56 : 72 }} />
                  <col style={{ width: compact ? 136 : 146 }} />
                  {!compact && <col style={{ width: 112 }} />}
                  {!compact && <col style={{ width: 112 }} />}
                  <col style={{ width: compact ? 96 : 104 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col">Vendor</th>
                    <th scope="col">Owner</th>
                    <th scope="col" className="num">Live</th>
                    <th scope="col">Status</th>
                    {!compact && <th scope="col">Since</th>}
                    {!compact && <th scope="col" className="num">Commission</th>}
                    <th scope="col"><span className="shz-visually-hidden">Action</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(v => (
                    <tr key={v.id} onClick={e => onRowClick(e, v)} style={{ cursor: 'pointer' }}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                          <Avatar initials={v.initials} />
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                            <Text v="label" truncate>{v.brand}</Text>
                            <Text v="caption" tone="subtle" truncate>{v.city} · {v.categories.join(', ')}</Text>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                          <Text v="small" truncate>{v.owner}</Text>
                          <Mono>{v.phone}</Mono>
                        </div>
                      </td>
                      <td className="num">{v.liveCount ?? '—'}</td>
                      <td><VendorStatusBadge status={v.status} /></td>
                      {!compact && <td><Text v="small" tone="muted">{v.sinceLabel}</Text></td>}
                      {!compact && <td className="num">{v.commissionPct === null ? '—' : `${v.commissionPct}%`}</td>}
                      <td style={{ textAlign: 'right' }}>
                        {v.status === 'under_review' ? (
                          <Button size="sm" to={`/vendors/${v.id}`} aria-label={`Open ${v.brand}`}>Open</Button>
                        ) : v.status === 'applied' ? (
                          <Button size="sm" to={`/vendors/${v.id}`} aria-label={`Review ${v.brand}`}>Review</Button>
                        ) : (
                          <RowMenu vendor={v} onSuspend={() => setSuspending(v)} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableFrame>
          )}
        </>
      )}

      {suspending && <SuspendDialog vendor={suspending} open onClose={() => setSuspending(null)} />}
    </Screen>
  )
}
