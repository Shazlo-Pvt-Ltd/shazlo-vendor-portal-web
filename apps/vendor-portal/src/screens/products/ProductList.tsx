// V-06 · Products (desktop table) and V-06m · Products (mobile card list).
import { useMemo, useState, type CSSProperties } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import {
  Button, Card, Checkbox, Content, EmptyState, Icon, ImagePlaceholder, kit, Mono, PageHeader, Skeleton, Table, TableFrame,
  Tabs, Text, TextInput, textStyle, useToast, type TabItem,
} from '@shazlo/ui/components'
import type { Product } from '../../api'
import { useArchiveProducts, useProducts, useSubmitProducts } from '../../api/hooks'
import { TopBar } from '../../app/topbar'
import { relativeTime, rupees } from '../../lib/format'
import {
  ArchiveDialog, BarIcon, coverUrl, FilterPill, MobilePageBar, ProductStatus, RowMenu, Sheet, totalStock, useIsMobile, type MenuAction,
} from './shared'

/* ---------- filtering ---------- */

export type TabKey = 'all' | 'live' | 'pending' | 'sent_back' | 'drafts' | 'archived'
const tabStatus: Record<Exclude<TabKey, 'all'>, Product['status']> = {
  live: 'approved', pending: 'pending_review', sent_back: 'rejected', drafts: 'draft', archived: 'archived',
}
const isTab = (v: string | null): v is TabKey => v === 'all' || (v !== null && v in tabStatus)

type SortKey = 'updated' | 'name' | 'price_asc' | 'price_desc' | 'stock'
const sortOptions: Array<{ value: SortKey; label: string }> = [
  { value: 'updated', label: 'Recently updated' },
  { value: 'name', label: 'Name A–Z' },
  { value: 'price_asc', label: 'Price, low to high' },
  { value: 'price_desc', label: 'Price, high to low' },
  { value: 'stock', label: 'Stock, lowest first' },
]
type StockKey = 'any' | 'in' | 'low' | 'out'
const stockOptions: Array<{ value: StockKey; label: string }> = [
  { value: 'any', label: 'Any' },
  { value: 'in', label: 'In stock' },
  { value: 'low', label: 'Low (5 or fewer)' },
  { value: 'out', label: 'Sold out' },
]
const genderOptions = [
  { value: 'all', label: 'All' },
  { value: 'women', label: 'Women' },
  { value: 'men', label: 'Men' },
  { value: 'unisex', label: 'Unisex' },
]

interface Filters { q: string; category: string; gender: string; stock: StockKey; sort: SortKey }
const noFilters: Filters = { q: '', category: 'all', gender: 'all', stock: 'any', sort: 'updated' }

function inTab(p: Product, tab: TabKey) {
  // "All" is the catalogue: archived products sit in their own tab.
  return tab === 'all' ? p.status !== 'archived' : p.status === tabStatus[tab]
}

function applyFilters(list: Product[], f: Filters) {
  const q = f.q.trim().toLowerCase()
  const out = list.filter(p => {
    if (q && !p.title.toLowerCase().includes(q) && !p.sku.toLowerCase().includes(q) && !p.sizes.some(s => s.sku.toLowerCase().includes(q))) return false
    if (f.category !== 'all' && p.category !== f.category) return false
    if (f.gender !== 'all' && p.gender !== f.gender) return false
    const stock = totalStock(p)
    if (f.stock === 'in' && !(stock && stock > 0)) return false
    if (f.stock === 'low' && !(stock !== null && stock > 0 && stock <= 5)) return false
    if (f.stock === 'out' && stock !== 0) return false
    return true
  })
  const by: Record<SortKey, (a: Product, b: Product) => number> = {
    // Sent-back rows sort to the top: they are what needs the seller (V-06 note 3).
    updated: (a, b) => Number(b.status === 'rejected') - Number(a.status === 'rejected') || b.updatedAt.localeCompare(a.updatedAt),
    name: (a, b) => a.title.localeCompare(b.title, 'en-IN'),
    price_asc: (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
    price_desc: (a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity),
    stock: (a, b) => (totalStock(a) ?? Infinity) - (totalStock(b) ?? Infinity),
  }
  return out.sort(by[f.sort])
}

const canSubmit = (p: Product) => p.status === 'draft' || p.status === 'rejected'

/* ---------- shared behaviour ---------- */

function useCatalog() {
  const query = useProducts()
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab')
  const tab: TabKey = isTab(raw) ? raw : 'all'
  const setTab = (t: TabKey) => setParams(prev => {
    const next = new URLSearchParams(prev)
    if (t === 'all') next.delete('tab')
    else next.set('tab', t)
    return next
  }, { replace: true })
  const [filters, setFilters] = useState<Filters>(noFilters)
  const products = useMemo(() => query.data ?? [], [query.data])
  const counts = useMemo(() => {
    const c = (t: TabKey) => products.filter(p => inTab(p, t)).length
    return { all: c('all'), live: c('live'), pending: c('pending'), sent_back: c('sent_back'), drafts: c('drafts'), archived: c('archived') }
  }, [products])
  const inThisTab = useMemo(() => products.filter(p => inTab(p, tab)), [products, tab])
  const rows = useMemo(() => applyFilters(inThisTab, filters), [inThisTab, filters])
  const categories = useMemo(
    () => [{ value: 'all', label: 'All' }, ...[...new Set(products.map(p => p.category))].sort().map(c => ({ value: c, label: c }))],
    [products],
  )
  const filtered = filters.q.trim() !== '' || filters.category !== 'all' || filters.gender !== 'all' || filters.stock !== 'any'
  return { query, products, tab, setTab, filters, setFilters, counts, inThisTab, rows, categories, filtered }
}

function useProductActions() {
  const navigate = useNavigate()
  const { show } = useToast()
  const submit = useSubmitProducts()
  const archive = useArchiveProducts()
  const [archiving, setArchiving] = useState<Product[] | null>(null)

  const submitFor = async (list: Product[], after?: () => void) => {
    const ok = list.filter(canSubmit)
    if (!ok.length) return
    try {
      await submit.mutateAsync(ok.map(p => p.id))
      const skipped = list.length - ok.length
      show(`${ok.length === 1 ? `${ok[0]?.title} is` : `${ok.length} products are`} in review now.${skipped ? ` ${skipped} ${skipped === 1 ? 'was' : 'were'} already live or in review, so ${skipped === 1 ? 'it was' : 'they were'} left as is.` : ''}`)
      after?.()
    } catch (e) {
      show(e instanceof Error ? e.message : 'Couldn’t submit. Check your connection and try again.', 'error')
    }
  }
  const confirmArchive = async (after?: () => void) => {
    if (!archiving) return
    const n = archiving.length
    try {
      await archive.mutateAsync(archiving.map(p => p.id))
      show(`${n === 1 ? `${archiving[0]?.title} is` : `${n} products are`} archived. Find ${n === 1 ? 'it' : 'them'} in the Archived tab.`)
      setArchiving(null)
      after?.()
    } catch (e) {
      show(e instanceof Error ? e.message : 'Couldn’t archive. Check your connection and try again.', 'error')
    }
  }
  const menuFor = (p: Product): MenuAction[] => [
    { label: p.status === 'rejected' ? 'Fix and resubmit' : 'Edit product', icon: 'edit', onClick: () => navigate(`/products/${p.id}`) },
    ...(canSubmit(p) ? [{ label: 'Submit for review', icon: 'send' as const, onClick: () => void submitFor([p]) }] : []),
    ...(p.status !== 'archived' ? [{ label: 'Archive', icon: 'layers' as const, onClick: () => setArchiving([p]), danger: true }] : []),
  ]
  return { submitFor, submitting: submit.isPending, archiving, setArchiving, confirmArchive, archivingBusy: archive.isPending, menuFor }
}

const emptyCopy: Record<TabKey, { title: string; body: string; icon: 'package' | 'check' | 'clock' | 'edit' | 'layers' }> = {
  all: { title: 'Add your first product', body: 'Add products one at a time, or import a spreadsheet. Everything is reviewed by Shazlo before it goes live.', icon: 'package' },
  live: { title: 'Nothing live yet', body: 'Products appear here once the Shazlo review team approves them. Submit a draft to get started.', icon: 'check' },
  pending: { title: 'Nothing waiting for review', body: 'Products you submit wait here for the review team, usually 1–2 working days.', icon: 'clock' },
  sent_back: { title: 'Nothing sent back', body: 'When a reviewer asks for a change, the product shows up here with their reason.', icon: 'check' },
  drafts: { title: 'No drafts', body: 'Drafts are products you have saved but not submitted. Imported products land here too.', icon: 'edit' },
  archived: { title: 'Nothing archived', body: 'Archived products leave the app but are never deleted. Archive from a product’s ⋯ menu.', icon: 'layers' },
}

/* ---------- desktop (V-06) ---------- */

const PAGE = 8
const tabsOrder: TabKey[] = ['all', 'live', 'pending', 'sent_back', 'drafts', 'archived']
const tabLabel: Record<TabKey, string> = { all: 'All', live: 'Live', pending: 'Pending review', sent_back: 'Sent back', drafts: 'Drafts', archived: 'Archived' }

function BulkBar({ count, onSubmit, onArchive, submitDisabled, busy, onClear }: {
  count: number
  onSubmit: () => void
  onArchive: () => void
  submitDisabled: string | null
  busy: boolean
  onClear: () => void
}) {
  const ghost: CSSProperties = {
    ...textStyle.caption, color: kit.offWhite, background: 'transparent', border: `1px solid ${kit.subtle}`, borderRadius: 6,
    padding: '5px 10px', minHeight: 25, boxSizing: 'border-box', cursor: 'pointer', whiteSpace: 'nowrap',
  }
  return (
    <div role="region" aria-label="Bulk actions" onKeyDown={e => { if (e.key === 'Escape') onClear() }} style={{ background: kit.navy, borderRadius: 8, display: 'flex', alignItems: 'center', gap: 16, padding: '10px 16px', minHeight: 45, boxSizing: 'border-box' }}>
      <Text v="label" tone="inverse" aria-live="polite">{count} selected</Text>
      <span style={{ flex: 1 }} />
      <button type="button" className="shz-bulk-btn" style={{ ...ghost, opacity: submitDisabled || busy ? 0.5 : 1, cursor: submitDisabled || busy ? 'not-allowed' : 'pointer' }} onClick={onSubmit} aria-disabled={Boolean(submitDisabled) || busy} title={submitDisabled ?? undefined}>
        {busy ? 'Submitting…' : 'Submit for review'}
      </button>
      <button type="button" className="shz-bulk-btn" style={ghost} onClick={onArchive}>Archive</button>
    </div>
  )
}

function PriceCell({ p }: { p: Product }) {
  if (p.price == null) return <>{rupees(null)}</>
  if (p.mrp != null && p.mrp > p.price) {
    return (
      <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
        <Text v="label" tabular>{rupees(p.price)}</Text>
        <Text v="caption" tone="subtle" tabular>MRP {rupees(p.mrp)}</Text>
      </span>
    )
  }
  return <>{rupees(p.price)}</>
}

function LoadingRows() {
  return (
    <>
      {Array.from({ length: 6 }, (_, i) => (
        <tr key={i} aria-hidden>
          <td><Skeleton width={16} height={16} /></td>
          <td>
            <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Skeleton width={36} height={44} radius={6} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}><Skeleton width="60%" /><Skeleton width={74} height={12} /></span>
            </span>
          </td>
          <td><Skeleton width={60} /></td>
          <td><Skeleton width={50} style={{ marginLeft: 'auto' }} /></td>
          <td><Skeleton width={24} style={{ marginLeft: 'auto' }} /></td>
          <td><Skeleton width={70} height={19} radius={999} /></td>
          <td><Skeleton width={56} /></td>
          <td />
        </tr>
      ))}
    </>
  )
}

function DesktopList() {
  const c = useCatalog()
  const a = useProductActions()
  const navigate = useNavigate()
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const pages = Math.max(1, Math.ceil(c.rows.length / PAGE))
  const current = Math.min(page, pages - 1)
  const pageRows = c.rows.slice(current * PAGE, current * PAGE + PAGE)
  const selectedRows = c.products.filter(p => selected.has(p.id))
  const submitable = selectedRows.filter(canSubmit)
  const allOnPage = pageRows.length > 0 && pageRows.every(p => selected.has(p.id))
  const someOnPage = pageRows.some(p => selected.has(p.id))

  const resetView = () => { setPage(0); setSelected(new Set()) }
  const setFilter = (patch: Partial<Filters>) => { c.setFilters(f => ({ ...f, ...patch })); setPage(0) }
  const toggle = (id: string) => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const togglePage = () => setSelected(s => {
    const n = new Set(s)
    for (const p of pageRows) { if (allOnPage) n.delete(p.id); else n.add(p.id) }
    return n
  })

  const tabs: TabItem<TabKey>[] = tabsOrder.map(t => ({ value: t, label: tabLabel[t], count: c.query.data ? c.counts[t] : undefined }))
  const live = c.counts.live
  const total = c.products.length

  return (
    <Content style={{ gap: 20 }}>
      <TopBar crumbs={[{ label: 'Products' }]} />
      <PageHeader
        title="Products"
        subtitle={c.query.data ? `${total} product${total === 1 ? '' : 's'} · ${live} live in the app` : 'Loading your catalogue…'}
        actions={
          <>
            <Button variant="secondary" icon="upload" to="/products/import">Bulk import</Button>
            <Button variant="primary" icon="plus" to="/products/new">Add product</Button>
          </>
        }
      />
      <Tabs label="Product states" items={tabs} value={c.tab} onChange={t => { c.setTab(t); resetView() }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <TextInput
          icon="search"
          type="search"
          aria-label="Search name or SKU"
          placeholder="Search name or SKU"
          value={c.filters.q}
          onChange={e => setFilter({ q: e.target.value })}
          style={{ width: 320, maxWidth: '100%' }}
        />
        <FilterPill label="Category" value={c.filters.category} options={c.categories} onChange={v => setFilter({ category: v })} />
        <FilterPill label="Gender" value={c.filters.gender} options={genderOptions} onChange={v => setFilter({ gender: v })} />
        <FilterPill label="Stock" value={c.filters.stock} options={stockOptions} onChange={v => setFilter({ stock: v as StockKey })} />
        <span style={{ flex: 1 }} />
        <FilterPill bare label="Sort" value={c.filters.sort} options={sortOptions} onChange={v => setFilter({ sort: v as SortKey })} />
      </div>

      {selected.size > 0 && (
        <BulkBar
          count={selected.size}
          busy={a.submitting}
          submitDisabled={submitable.length ? null : 'Only drafts and sent-back products can be submitted. Live and pending products are already reviewed.'}
          onSubmit={() => { if (submitable.length && !a.submitting) void a.submitFor(selectedRows, () => setSelected(new Set())) }}
          onArchive={() => a.setArchiving(selectedRows)}
          onClear={() => setSelected(new Set())}
        />
      )}

      {c.query.isError ? (
        <Card pad={0}>
          <EmptyState icon="alert" title="We couldn’t load your products" action={<Button variant="secondary" icon="refresh" onClick={() => void c.query.refetch()}>Try again</Button>}>
            Check your internet connection, then try again. Your products are safe.
          </EmptyState>
        </Card>
      ) : c.query.data && c.rows.length === 0 ? (
        <Card pad={0}>
          {c.filtered ? (
            <EmptyState icon="search" title="No products match" action={<Button variant="secondary" onClick={() => { c.setFilters(f => ({ ...noFilters, sort: f.sort })); setPage(0) }}>Clear search and filters</Button>}>
              {c.filters.q.trim() ? <>Nothing in {tabLabel[c.tab]} matches “{c.filters.q.trim()}”. Check the spelling or search by SKU.</> : <>No products in {tabLabel[c.tab]} match these filters.</>}
            </EmptyState>
          ) : (
            <EmptyState
              icon={emptyCopy[c.tab].icon}
              title={emptyCopy[c.tab].title}
              action={c.tab === 'all' ? <span style={{ display: 'flex', gap: 8 }}><Button variant="secondary" icon="upload" to="/products/import">Bulk import</Button><Button variant="primary" icon="plus" to="/products/new">Add product</Button></span> : undefined}
            >
              {emptyCopy[c.tab].body}
            </EmptyState>
          )}
        </Card>
      ) : (
        <TableFrame>
          <Table aria-label="Products" aria-busy={c.query.isPending || undefined} style={{ tableLayout: 'fixed', minWidth: 940 }}>
            <colgroup>
              <col style={{ width: 44 }} />
              <col />
              <col style={{ width: 156 }} />
              <col style={{ width: 126 }} />
              <col style={{ width: 106 }} />
              <col style={{ width: 186 }} />
              <col style={{ width: 112 }} />
              <col style={{ width: 44 }} />
            </colgroup>
            <thead>
              <tr>
                <th style={{ paddingTop: 9, paddingBottom: 9, lineHeight: 0 }}>
                  <Checkbox aria-label="Select all on this page" checked={allOnPage} indeterminate={someOnPage && !allOnPage} onChange={togglePage} disabled={!pageRows.length} style={{ verticalAlign: 'middle' }} />
                </th>
                <th scope="col">Product</th>
                <th scope="col">Category</th>
                <th scope="col" className="num">Price</th>
                <th scope="col" className="num">Stock</th>
                <th scope="col">Status</th>
                <th scope="col">Updated</th>
                <th><span className="shz-visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {c.query.isPending ? <LoadingRows /> : pageRows.map(p => {
                const stock = totalStock(p)
                const isSel = selected.has(p.id)
                return (
                  <tr key={p.id} aria-selected={isSel} onClick={() => navigate(`/products/${p.id}`)} style={{ cursor: 'pointer' }}>
                    <td onClick={e => e.stopPropagation()}>
                      <Checkbox aria-label={`Select ${p.title}`} checked={isSel} onChange={() => toggle(p.id)} style={{ verticalAlign: 'middle' }} />
                    </td>
                    <td>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                        <ImagePlaceholder width={36} height={44} src={coverUrl(p)} />
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                          <Link to={`/products/${p.id}`} onClick={e => e.stopPropagation()} className="shz-link" style={{ ...textStyle.label, color: kit.ink, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {p.title}
                          </Link>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                            <Mono>{p.sku}</Mono>
                            {p.pendingEdit && p.status === 'approved' && <Text v="caption" tone="muted" style={{ whiteSpace: 'nowrap' }}>Edit in review</Text>}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td>{p.category}</td>
                    <td className="num"><PriceCell p={p} /></td>
                    <td className="num">{stock === null ? '—' : stock}</td>
                    <td><ProductStatus product={p} /></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{relativeTime(p.updatedAt)}</td>
                    <td onClick={e => e.stopPropagation()}><RowMenu label={`Actions for ${p.title}`} actions={a.menuFor(p)} /></td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        </TableFrame>
      )}

      {c.query.data && c.rows.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <Text v="small" tone="muted" aria-live="polite">Showing {current * PAGE + 1}–{current * PAGE + pageRows.length} of {c.rows.length}</Text>
          <span style={{ display: 'flex', gap: 8 }}>
            <Button size="sm" variant="secondary" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</Button>
            <Button size="sm" variant="secondary" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Next</Button>
          </span>
        </div>
      )}

      <ArchiveDialog
        open={Boolean(a.archiving)}
        products={a.archiving ?? []}
        busy={a.archivingBusy}
        onClose={() => a.setArchiving(null)}
        onConfirm={() => void a.confirmArchive(() => setSelected(new Set()))}
      />
      <style>{`.shz-bulk-btn:hover:not([aria-disabled="true"]){background:rgba(255,252,227,0.08)!important}.shz-bulk-btn:focus-visible{outline:2px solid ${kit.amber};outline-offset:2px}`}</style>
    </Content>
  )
}

/* ---------- mobile (V-06m) ---------- */

// "Sent back" moves next to "All" on phones: it is the state that needs action (V-06m note 1).
const mobileTabs: TabKey[] = ['all', 'sent_back', 'pending', 'live', 'drafts', 'archived']
const mobileLabel: Record<TabKey, string> = { ...tabLabel, pending: 'Pending' }
const MOBILE_PAGE = 20

function firstSentence(s: string) {
  const m = /^.*?[.!?](\s|$)/.exec(s)
  return (m ? m[0] : s).trim()
}

function MobileCard({ p, actions }: { p: Product; actions: MenuAction[] }) {
  const navigate = useNavigate()
  const stock = totalStock(p)
  const stockText = stock === null ? 'no sizes yet' : stock === 0 ? 'sold out' : `${stock} in stock`
  const reason = p.status === 'rejected' ? p.lastDecision?.reason : undefined
  return (
    <div style={{ position: 'relative', background: kit.surface, border: `1px solid ${kit.line}`, borderRadius: 10, display: 'flex', gap: 12, padding: '9px 11px 9px 9px' }}>
      <ImagePlaceholder width={64} height={78} src={coverUrl(p)} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
        <Link to={`/products/${p.id}`} style={{ ...textStyle.label, color: kit.ink, textDecoration: 'none' }} className="shz-card-link">{p.title}</Link>
        <Text v="caption" tone="muted">{p.price == null ? 'No price yet' : rupees(p.price)} · {stockText}</Text>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}><ProductStatus product={p} editLabel="Edit in review" /></span>
        {reason && <Text v="caption" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>“{firstSentence(reason)}”</Text>}
      </div>
      <span style={{ position: 'relative', zIndex: 1, alignSelf: 'flex-start', marginTop: 2 }}>
        <RowMenu label={`Actions for ${p.title}`} actions={actions} size={18} />
      </span>
      {/* The whole card opens the editor; the link above is the accessible name. */}
      <span aria-hidden onClick={() => navigate(`/products/${p.id}`)} style={{ position: 'absolute', inset: 0, cursor: 'pointer' }} />
    </div>
  )
}

function MobileList() {
  const c = useCatalog()
  const a = useProductActions()
  const [searchOpen, setSearchOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [shown, setShown] = useState(MOBILE_PAGE)
  const setFilter = (patch: Partial<Filters>) => { c.setFilters(f => ({ ...f, ...patch })); setShown(MOBILE_PAGE) }
  const filterCount = [c.filters.category !== 'all', c.filters.gender !== 'all', c.filters.stock !== 'any'].filter(Boolean).length
  const total = c.products.length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100dvh - 56px)', background: kit.canvas }}>
      <TopBar crumbs={[{ label: 'Products' }]} />
      <MobilePageBar
        title="Products"
        caption={c.query.data ? `${total} products · ${c.counts.live} live` : 'Loading…'}
        trailing={
          <span style={{ display: 'flex', gap: 10, marginRight: 4 }}>
            <BarIcon label="Search products" icon="search" onClick={() => setSearchOpen(true)} badge={c.filters.q.trim() !== ''} />
            <BarIcon label={`Filter and sort${filterCount ? `, ${filterCount} filter${filterCount === 1 ? '' : 's'} on` : ''}`} icon="filter" onClick={() => setFilterOpen(true)} badge={filterCount > 0} />
          </span>
        }
      />
      <div role="tablist" aria-label="Product states" className="shz-tabs" style={{ background: kit.surface, borderBottom: `1px solid ${kit.line}`, display: 'flex', gap: 8, padding: '10px 16px', overflowX: 'auto', scrollbarWidth: 'none' }}>
        {mobileTabs.map(t => {
          const active = c.tab === t
          return (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => { c.setTab(t); setShown(MOBILE_PAGE) }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', minHeight: 28, boxSizing: 'border-box', borderRadius: 999, flexShrink: 0, cursor: 'pointer',
                background: active ? kit.ink : kit.surface, border: `1px solid ${active ? kit.ink : kit.field}`,
              }}
            >
              <span style={{ ...textStyle.small, color: active ? kit.offWhite : kit.ink, whiteSpace: 'nowrap' }}>{mobileLabel[t]}</span>
              {c.query.data && <span style={{ ...textStyle.caption, color: active ? kit.field : kit.subtle }}>{c.counts[t]}</span>}
            </button>
          )
        })}
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, padding: '16px 16px calc(24px + 140px)' }}>
        {(c.filters.q.trim() || filterCount > 0) && c.query.data && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <Text v="caption" tone="muted">{c.rows.length} match{c.rows.length === 1 ? '' : 'es'}{c.filters.q.trim() ? ` for “${c.filters.q.trim()}”` : ''}</Text>
            <Button size="sm" variant="ghost" onClick={() => { c.setFilters(f => ({ ...noFilters, sort: f.sort })) }}>Clear</Button>
          </div>
        )}
        {c.query.isPending && Array.from({ length: 4 }, (_, i) => (
          <div key={i} aria-hidden style={{ background: kit.surface, border: `1px solid ${kit.line}`, borderRadius: 10, display: 'flex', gap: 12, padding: '9px 11px 9px 9px' }}>
            <Skeleton width={64} height={78} radius={6} />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}><Skeleton width="70%" /><Skeleton width="45%" height={12} /><Skeleton width={70} height={19} radius={999} /></span>
          </div>
        ))}
        {c.query.isError && (
          <Card pad={0}>
            <EmptyState icon="alert" title="We couldn’t load your products" action={<Button variant="secondary" icon="refresh" onClick={() => void c.query.refetch()}>Try again</Button>}>
              Check your internet connection, then try again.
            </EmptyState>
          </Card>
        )}
        {c.query.data && c.rows.length === 0 && (
          <Card pad={0}>
            {c.filtered
              ? <EmptyState icon="search" title="No products match" action={<Button variant="secondary" onClick={() => c.setFilters(f => ({ ...noFilters, sort: f.sort }))}>Clear search and filters</Button>}>Check the spelling, or search by SKU.</EmptyState>
              : <EmptyState icon={emptyCopy[c.tab].icon} title={emptyCopy[c.tab].title}>{emptyCopy[c.tab].body}</EmptyState>}
          </Card>
        )}
        {c.rows.slice(0, shown).map(p => <MobileCard key={p.id} p={p} actions={a.menuFor(p)} />)}
        {c.rows.length > shown && (
          <Button variant="secondary" fullWidth onClick={() => setShown(s => s + MOBILE_PAGE)} style={{ minHeight: 44 }}>
            Show {Math.min(MOBILE_PAGE, c.rows.length - shown)} more of {c.rows.length - shown}
          </Button>
        )}
      </div>

      <Link
        to="/products/new"
        className="shz-fab"
        style={{
          position: 'fixed', right: 16, bottom: 'calc(85px + env(safe-area-inset-bottom))', zIndex: 15, display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '12px 18px 12px 14px', minHeight: 44, background: kit.amber, border: `1px solid ${kit.amberEdge}`, borderRadius: 999,
          boxShadow: '0 4px 12px rgba(17,17,17,0.18)', textDecoration: 'none', color: kit.wine, ...textStyle.button,
        }}
      >
        <Icon name="plus" size={18} />Add product
      </Link>

      <Sheet open={searchOpen} onClose={() => setSearchOpen(false)} title="Search products" footer={<Button variant="primary" fullWidth onClick={() => setSearchOpen(false)} style={{ minHeight: 44 }}>Show {c.rows.length} product{c.rows.length === 1 ? '' : 's'}</Button>}>
        <TextInput
          icon="search"
          type="search"
          label="Name or SKU"
          placeholder="Search name or SKU"
          autoFocus
          value={c.filters.q}
          onChange={e => setFilter({ q: e.target.value })}
          onKeyDown={e => { if (e.key === 'Enter') setSearchOpen(false) }}
        />
        <Text v="caption" tone="subtle">Searching {mobileLabel[c.tab]} · {c.rows.length} match{c.rows.length === 1 ? '' : 'es'}</Text>
      </Sheet>

      <Sheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        title="Filter and sort"
        footer={
          <>
            <Button variant="secondary" onClick={() => setFilter({ category: 'all', gender: 'all', stock: 'any', sort: 'updated' })} style={{ minHeight: 44 }}>Reset</Button>
            <Button variant="primary" fullWidth onClick={() => setFilterOpen(false)} style={{ minHeight: 44, flex: 1 }}>Show {c.rows.length} product{c.rows.length === 1 ? '' : 's'}</Button>
          </>
        }
      >
        <SheetSelect label="Category" value={c.filters.category} options={c.categories} onChange={v => setFilter({ category: v })} />
        <SheetSelect label="Gender" value={c.filters.gender} options={genderOptions} onChange={v => setFilter({ gender: v })} />
        <SheetSelect label="Stock" value={c.filters.stock} options={stockOptions} onChange={v => setFilter({ stock: v as StockKey })} />
        <SheetSelect label="Sort" value={c.filters.sort} options={sortOptions} onChange={v => setFilter({ sort: v as SortKey })} />
      </Sheet>

      <ArchiveDialog open={Boolean(a.archiving)} products={a.archiving ?? []} busy={a.archivingBusy} onClose={() => a.setArchiving(null)} onConfirm={() => void a.confirmArchive()} />
    </div>
  )
}

function SheetSelect({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (v: string) => void }) {
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <legend style={{ ...textStyle.label, color: kit.ink, marginBottom: 8 }}>{label}</legend>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {options.map(o => {
          const on = o.value === value
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(o.value)}
              style={{ ...textStyle.small, minHeight: 36, padding: '6px 14px', borderRadius: 999, cursor: 'pointer', background: on ? kit.ink : kit.surface, color: on ? kit.offWhite : kit.ink, border: `1px solid ${on ? kit.ink : kit.field}` }}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

export function ProductList() {
  const mobile = useIsMobile()
  return mobile ? <MobileList /> : <DesktopList />
}
