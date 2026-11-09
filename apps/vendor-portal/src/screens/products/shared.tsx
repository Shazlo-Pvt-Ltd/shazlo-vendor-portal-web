import { useMobileChrome } from '../../app/mobileTask'
// Pieces shared by the catalog screens (V-06 Products, V-07 Product editor, V-08 Bulk import).
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import MuiDialog from '@mui/material/Dialog'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useId, useState, type CSSProperties, type ReactNode } from 'react'
import { Button, Dialog, Icon, IconButton, kit, StatusBadge, Text, textStyle, type IconName } from '@shazlo/ui/components'
import type { Product, ProductImage } from '../../api'
import { MOBILE_QUERY } from '../../app/VendorShell'

export const useIsMobile = () => useMediaQuery(MOBILE_QUERY, { noSsr: true })

/* ---------- product facts ---------- */

/** Total stock over every size, or null when no size has been added yet. */
export function totalStock(p: Pick<Product, 'sizes'>): number | null {
  if (!p.sizes.length) return null
  return p.sizes.reduce((n, s) => n + (Number.isFinite(s.stock) ? s.stock : 0), 0)
}

export const hasPhoto = (img: ProductImage | undefined) => Boolean(img && (img.url || img.name))
export const coverUrl = (p: Pick<Product, 'images'>) => p.images.find(i => i.slot === 'front')?.url

/** Status = pill + icon + word. An approved product with a pending edit stays "Live". */
export function ProductStatus({ product, editLabel = 'Edit' }: { product: Pick<Product, 'status' | 'pendingEdit'>; editLabel?: string }) {
  const badge = (() => {
    switch (product.status) {
      case 'approved': return <StatusBadge tone="live" />
      case 'pending_review': return <StatusBadge tone="pending" />
      case 'rejected': return <StatusBadge tone="sentBack" />
      case 'draft': return <StatusBadge tone="draft" />
      case 'archived': return <StatusBadge tone="draft" icon="ban">Archived</StatusBadge>
    }
  })()
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {badge}
      {product.status === 'approved' && product.pendingEdit && <StatusBadge tone="pending">{editLabel}</StatusBadge>}
    </span>
  )
}

/** The catalogue's product types. Values match the list's Category column; labels are the editor's singular "Product type". */
export const productTypes: Array<{ value: string; label: string }> = [
  { value: 'Kurtas', label: 'Kurta' },
  { value: 'Kurtis', label: 'Kurti' },
  { value: 'Shirts', label: 'Shirt' },
  { value: 'Jackets', label: 'Jacket' },
  { value: 'Co-ords', label: 'Co-ord set' },
  { value: 'Dresses', label: 'Dress' },
  { value: 'Skirts', label: 'Skirt' },
  { value: 'Bottoms', label: 'Bottoms' },
  { value: 'Sarees', label: 'Saree' },
  { value: 'Dupattas', label: 'Dupatta' },
  { value: 'Stoles', label: 'Stole' },
  { value: 'Loungewear', label: 'Loungewear' },
  { value: 'Accessories', label: 'Accessory' },
]

export const fabrics = ['Cotton', 'Cotton (mul)', 'Cotton silk', 'Khadi', 'Linen', 'Silk', 'Mashru silk', 'Chanderi', 'Modal', 'Wool', 'Other']

export const genders: Array<{ value: Product['gender']; label: string }> = [
  { value: 'women', label: 'Women' },
  { value: 'men', label: 'Men' },
  { value: 'unisex', label: 'Unisex' },
]

/* ---------- time ---------- */

const hm = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
const dm = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' })

/** "Today, 11:40", "Yesterday, 09:12", "22 Oct": the review history style. */
export function historyTime(iso: string, now = Date.now()) {
  const t = new Date(iso)
  const today = new Date(now); today.setHours(0, 0, 0, 0)
  if (t.getTime() >= today.getTime()) return `Today, ${hm.format(t)}`
  if (t.getTime() >= today.getTime() - 86_400_000) return `Yesterday, ${hm.format(t)}`
  return dm.format(t)
}

/** "2 minutes ago" (long) or "2 min ago" (short), for "last saved". */
export function savedAgo(iso: string, short = false, now = Date.now()) {
  const min = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000))
  if (min < 1) return 'just now'
  if (min < 60) return short ? `${min} min ago` : `${min} minute${min === 1 ? '' : 's'} ago`
  const h = Math.round(min / 60)
  if (h < 24) return short ? `${h} h ago` : `${h} hour${h === 1 ? '' : 's'} ago`
  return `on ${dm.format(new Date(iso))}`
}

/* ---------- controls ---------- */

/**
 * Toolbar filter pill from V-06: "Category: All" in Ovo 13 ink with a chevron. A native select sits
 * invisibly on top, so keyboard, screen readers and phones get the platform picker.
 */
export function FilterPill({ label, value, options, onChange, bare, style }: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (v: string) => void
  /** Sort control: no box, muted text. */
  bare?: boolean
  style?: CSSProperties
}) {
  const id = useId()
  const current = options.find(o => o.value === value)?.label ?? ''
  return (
    <span
      className="shz-pill"
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: bare ? 0 : '7px 9px 7px 11px', // Penpot strokes sit inside: 8/10/8/12 minus the 1 px border
        minHeight: bare ? 16 : 32,
        background: bare ? 'transparent' : kit.surface,
        border: bare ? 0 : `1px solid ${kit.field}`,
        borderRadius: 6,
        boxSizing: 'border-box',
        flexShrink: 0,
        ...style,
      }}
    >
      <span aria-hidden style={{ ...textStyle.small, color: bare ? kit.muted : kit.ink, whiteSpace: 'nowrap' }}>{label}: {current}</span>
      <Icon name="chevronDown" size={14} color={kit.muted} />
      <select
        id={id}
        aria-label={label}
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', ...textStyle.small, border: 0 }}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </span>
  )
}

export interface MenuAction {
  label: string
  icon: IconName
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}

/** "⋯" row menu. */
export function RowMenu({ label, actions, size = 16 }: { label: string; actions: MenuAction[]; size?: number }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <>
      <IconButton aria-label={label} aria-haspopup="menu" onClick={e => { e.stopPropagation(); setAnchor(e.currentTarget) }}>
        <Icon name="more" size={size} />
      </IconButton>
      <Menu
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        onClick={e => e.stopPropagation()}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { mt: 0.5, minWidth: 200, borderRadius: '8px', border: `1px solid ${kit.line}`, background: kit.surface, boxShadow: '0 12px 32px rgba(23,18,14,0.14)' } } }}
      >
        {actions.map(a => (
          <MenuItem
            key={a.label}
            disabled={a.disabled}
            onClick={() => { setAnchor(null); a.onClick() }}
            sx={{ gap: 1.25, minHeight: 40, ...textStyle.small, color: a.danger ? '#8F3504' : kit.ink }}
          >
            <Icon name={a.icon} size={16} />
            {a.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}

/** Archiving is reversible in review terms (nothing is deleted), but it takes products out of the app, so it confirms first. */
export function ArchiveDialog({ products, open, onClose, onConfirm, busy }: {
  products: Array<Pick<Product, 'id' | 'title' | 'status'>>
  open: boolean
  onClose: () => void
  onConfirm: () => void
  busy?: boolean
}) {
  const n = products.length
  const live = products.filter(p => p.status === 'approved').length
  const one = products[0]
  return (
    <Dialog
      open={open}
      onClose={onClose}
      icon="layers"
      title={n === 1 && one ? `Archive ${one.title}?` : `Archive ${n} products?`}
      description={
        <>
          {live > 0 && <>{live === n ? (n === 1 ? 'It leaves' : 'They leave') : `${live} of them leave`} the Shazlo app straight away. </>}
          Nothing is deleted: archived products stay in the Archived tab with their photos, sizes and history.
        </>
      }
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>Keep {n === 1 ? 'it' : 'them'}</Button>
          <Button variant="danger" icon="layers" onClick={onConfirm} disabled={busy}>{busy ? 'Archiving…' : n === 1 ? 'Archive product' : `Archive ${n} products`}</Button>
        </>
      }
    />
  )
}

/** Full-screen sheet for phones (V-06m search and filters). */
export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <MuiDialog fullScreen open={open} onClose={onClose} aria-labelledby="shz-sheet-title" slotProps={{ paper: { sx: { background: kit.canvas } } }}>
      <header style={{ height: 56, flexShrink: 0, background: kit.surface, borderBottom: `1px solid ${kit.line}`, display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px' }}>
        <IconButton aria-label="Close" onClick={onClose} style={{ margin: 0, width: 44, height: 44 }}><Icon name="x" size={22} /></IconButton>
        <Text v="title" as="h2" id="shz-sheet-title" style={{ flex: 1 }}>{title}</Text>
      </header>
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>{children}</div>
      {footer && <div style={{ background: kit.surface, borderTop: `1px solid ${kit.line}`, padding: '12px 16px calc(16px + env(safe-area-inset-bottom))', display: 'flex', gap: 8 }}>{footer}</div>}
    </MuiDialog>
  )
}

/** Phone screens: the page's own bar under the shell's app bar (title, caption, actions). */
export function MobilePageBar({ title, caption, leading, trailing, hideTabBar = false }: { title: string; caption?: ReactNode; leading?: ReactNode; trailing?: ReactNode; hideTabBar?: boolean }) {
  // Replaces the shell's store app bar (V-06m, V-07m); editors also drop the tab bar.
  useMobileChrome({ ownAppBar: true, hideTabBar })
  return (
    <div style={{ position: 'sticky', top: 0, zIndex: 10, minHeight: 56, background: kit.surface, borderBottom: `1px solid ${kit.line}`, display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px' }}>
      {leading}
      <span style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <Text v="title" as="h1" truncate>{title}</Text>
        {caption && <Text v="caption" tone="subtle" truncate>{caption}</Text>}
      </span>
      {trailing}
    </div>
  )
}

/** 44 px phone icon button (search, filter, back, more). */
export function BarIcon({ label, icon, onClick, badge }: { label: string; icon: IconName; onClick: () => void; badge?: boolean }) {
  return (
    <IconButton aria-label={label} onClick={onClick} style={{ margin: -6, width: 44, height: 44, color: kit.ink }}>
      <Icon name={icon} size={22} />
      {badge && <span aria-hidden style={{ position: 'absolute', top: 9, right: 9, width: 7, height: 7, borderRadius: 999, background: kit.amber, border: `1.5px solid ${kit.surface}` }} />}
    </IconButton>
  )
}

/** Saves a generated file (CSV report, template) through a Blob link. */
export function downloadFile(name: string, content: string, type = 'text/csv;charset=utf-8') {
  const blob = new Blob(['﻿', content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const csvCell = (v: string | number) => {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
