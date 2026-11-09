// Small pieces the A-04 to A-10 boards share that the kit does not have in this exact form.
import { styled } from '@mui/material/styles'
import type { CSSProperties, ReactNode } from 'react'
import { Link } from 'react-router'
import { Button, Card, Checkbox, EmptyState, focusRing, Icon, kit, Skeleton, Text, textStyle, type IconName } from '@shazlo/ui/components'

/** One screen's column: the iframe frame is 24/28/28/28 with an 18 px gap (16 on detail boards). */
export function Screen({ gap = 18, children, label }: { gap?: number; children: ReactNode; label?: string }) {
  return <div aria-label={label} style={{ display: 'flex', flexDirection: 'column', gap, minWidth: 0 }}>{children}</div>
}

/* ---------- Filters ---------- */

const FilterBox = styled('span', { shouldForwardProp: p => p !== 'bare' })<{ bare?: boolean }>(({ bare }) => ({
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: bare ? 0 : '7px 9px 7px 11px', // Penpot 8/10/8/12 with the 1 px stroke inside
  background: bare ? 'transparent' : kit.surface,
  border: bare ? 0 : `1px solid ${kit.field}`,
  borderRadius: 6,
  ...textStyle.small,
  color: bare ? kit.muted : kit.ink,
  whiteSpace: 'nowrap',
  flexShrink: 0,
  cursor: 'pointer',
  '&:hover': bare ? { color: kit.ink } : { background: '#FBF4E2' },
  '&:focus-within': { outline: `2px solid ${kit.focus}`, outlineOffset: 2 },
  '& select': { position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', font: 'inherit' },
}))

/**
 * A toolbar dropdown drawn as "Vendor: All ⌄" (Ovo 13 ink, 8/10/8/12, 1 px field border). A native
 * select sits on top, invisible, so keyboard, screen readers and phones get the platform picker.
 * `bare` is the borderless "Sort: Oldest first ⌄" variant.
 */
export function FilterMenu({ label, value, options, onChange, bare }: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
  bare?: boolean
}) {
  const current = options.find(o => o.value === value)?.label ?? ''
  return (
    <FilterBox bare={bare}>
      <span aria-hidden>{label}: {current}</span>
      <Icon name="chevronDown" size={14} color={bare ? kit.muted : kit.ink} />
      <select aria-label={label} value={value} onChange={e => onChange(e.target.value)}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </FilterBox>
  )
}

/** Toolbar: search, filters, a spacer, then sort (gap 10). Wraps on narrow frames. */
export const Toolbar = styled('div')({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flexWrap: 'wrap',
  minWidth: 0,
  '& > .spacer': { flex: 1, minWidth: 0 },
})

/* ---------- Stats ---------- */

export const StatGrid = styled('div')({
  display: 'grid',
  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
  gap: 12,
  '@media (max-width: 760px)': { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
})

/* ---------- Item navigation (A-05, A-07) ---------- */

const Square = styled('button')({
  width: 28,
  height: 28,
  borderRadius: 6,
  border: `1px solid ${kit.field}`,
  background: kit.surface,
  color: kit.ink,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  cursor: 'pointer',
  flexShrink: 0,
  transition: 'background-color 150ms ease-out',
  '&:hover:not(:disabled)': { background: '#FBF4E2' },
  '&:disabled': { opacity: 0.45, cursor: 'not-allowed' },
  ...focusRing,
})

const BackAnchor = styled(Link)({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  ...textStyle.small,
  color: kit.muted,
  textDecoration: 'none',
  borderRadius: 4,
  '&:hover': { color: kit.ink },
  ...focusRing,
})

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <BackAnchor to={to}>
      <Icon name="arrowLeft" size={16} />
      {children}
    </BackAnchor>
  )
}

export function ItemNav({ position, total, onPrev, onNext }: { position: number | null; total: number; onPrev?: () => void; onNext?: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 28 }}>
      <BackLink to="/queue">Review queue</BackLink>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {position !== null && <Text v="small" tone="muted" tabular>{position} of {total}</Text>}
        <Square type="button" aria-label="Previous item in the queue" disabled={!onPrev} onClick={onPrev}><Icon name="chevronLeft" size={16} /></Square>
        <Square type="button" aria-label="Next item in the queue" disabled={!onNext} onClick={onNext}><Icon name="chevronRight" size={16} /></Square>
      </div>
    </div>
  )
}

/* ---------- Decision bar (A-05, A-07) ---------- */

export function DecisionBar({ icon = 'info', children, actions }: { icon?: IconName; children: ReactNode; actions?: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '11px 15px',
        background: kit.surface, border: `1px solid ${kit.line}`, borderRadius: 8,
      }}
    >
      <Icon name={icon} size={16} color={kit.ink} />
      <Text v="small" tone="muted" as="p" style={{ flex: '1 1 260px', minWidth: 0 }}>{children}</Text>
      {actions && <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>{actions}</div>}
    </div>
  )
}

/* ---------- Checklist (A-05, A-07) ---------- */

export function CheckItem({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return <Checkbox label={label} checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} style={disabled ? { cursor: 'default' } : undefined} />
}

/* ---------- States ---------- */

export function LoadingDetail() {
  return (
    <div role="status" aria-label="Loading" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Skeleton width={180} height={16} />
      <Skeleton width={360} height={30} />
      <Skeleton width="60%" />
      <div style={{ display: 'flex', gap: 20 }}>
        <Skeleton width={400} height={470} radius={6} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Skeleton height={240} radius={8} />
          <Skeleton height={88} radius={8} />
          <Skeleton height={114} radius={8} />
        </div>
      </div>
    </div>
  )
}

export function ErrorCard({ title, children, onRetry, back }: { title: string; children: ReactNode; onRetry?: () => void; back?: { to: string; label: string } }) {
  return (
    <Card pad={0}>
      <EmptyState
        icon="alert"
        title={title}
        action={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            {onRetry && <Button size="sm" icon="refresh" onClick={onRetry}>Try again</Button>}
            {back && <Button size="sm" variant="ghost" icon="arrowLeft" to={back.to}>{back.label}</Button>}
          </div>
        }
      >
        {children}
      </EmptyState>
    </Card>
  )
}

/** Card title row: optional icon, Bodoni 16 title, aside caption. */
export function PanelTitle({ icon, children, aside, as = 'h2' }: { icon?: IconName; children: ReactNode; aside?: ReactNode; as?: 'h2' | 'h3' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {icon && <Icon name={icon} size={16} color={kit.ink} />}
      <Text v="title" as={as} style={{ flex: 1, minWidth: 0 }}>{children}</Text>
      {aside}
    </div>
  )
}

export const srOnly: CSSProperties = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }
