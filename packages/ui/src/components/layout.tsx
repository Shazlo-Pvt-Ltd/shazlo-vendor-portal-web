import { styled } from '@mui/material/styles'
import { Fragment, type CSSProperties, type ElementType, type ReactNode } from 'react'
import { kit, textStyle } from '../kit'
import { Icon, type IconName } from './Icon'
import { useUiLink } from './link'
import { Button, focusRing, Text } from './primitives'

/* ---------- App frame: sidebar | (top bar / content), separated by 1 px rules ---------- */

export const AppFrame = styled('div')({
  display: 'flex',
  minHeight: '100dvh',
  background: kit.line,
  gap: 1,
})

export const Sidebar = styled('nav', { shouldForwardProp: p => p !== 'as' && p !== 'tone' && p !== 'width' })<{ tone?: 'light' | 'dark'; width?: number }>(
  ({ tone = 'light', width = 248 }) => ({
    width,
    flexShrink: 0,
    background: tone === 'light' ? kit.surface : kit.navy,
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
    padding: '20px 12px 16px',
    position: 'sticky',
    top: 0,
    height: '100dvh',
    overflowY: 'auto',
    boxSizing: 'border-box',
  }),
)

export const MainColumn = styled('div')({
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  background: kit.line,
})

export const TopBar = styled('header')({
  height: 56,
  flexShrink: 0,
  background: kit.surface,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  padding: '0 32px',
  position: 'sticky',
  top: 0,
  zIndex: 10,
})

export const Content = styled('main', { shouldForwardProp: p => p !== 'as' && p !== 'maxWidth' })<{ maxWidth?: number }>(({ maxWidth }) => ({
  flex: 1,
  background: kit.canvas,
  display: 'flex',
  flexDirection: 'column',
  gap: 24,
  padding: '32px 40px 40px',
  minWidth: 0,
  boxSizing: 'border-box',
  ...(maxWidth && { '& > *': { maxWidth } }),
  '@media (max-width: 900px)': { padding: '20px 16px 96px', gap: 20 },
}))

/* ---------- Navigation ---------- */

const NavLinkStyled = styled('a', { shouldForwardProp: p => p !== 'as' && p !== 'tone' && p !== 'active' })<{ tone: 'light' | 'dark'; active: boolean }>(({ tone, active }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 10px',
  borderRadius: 6,
  textDecoration: 'none',
  minHeight: 34,
  boxSizing: 'border-box',
  background: active ? (tone === 'light' ? kit.cream : kit.amber) : 'transparent',
  color: active ? kit.ink : tone === 'light' ? kit.muted : kit.navText,
  '&:hover': active ? {} : { background: tone === 'light' ? 'rgba(255, 237, 163, 0.45)' : 'rgba(255, 252, 227, 0.07)' },
  ...focusRing,
}))

// Rendered `as` the app's router link, so `to` is passed through.
const NavLinkBase = NavLinkStyled as unknown as ElementType

export interface NavItemProps {
  to: string
  icon: IconName
  label: string
  count?: number | string
  active?: boolean
  tone?: 'light' | 'dark'
  onClick?: () => void
}

export function NavItem({ to, icon, label, count, active = false, tone = 'light', onClick }: NavItemProps) {
  const Link = useUiLink()
  const countColor = active ? (tone === 'light' ? kit.subtle : kit.wine) : tone === 'light' ? kit.subtle : kit.navText
  return (
    <NavLinkBase as={Link} to={to} tone={tone} active={active} aria-current={active ? 'page' : undefined} onClick={onClick}>
      <Icon name={icon} size={18} />
      <span style={{ ...(active ? textStyle.label : textStyle.small), flex: 1, minWidth: 0 }}>{label}</span>
      {count !== undefined && <span style={{ ...textStyle.caption, color: countColor }}>{count}</span>}
    </NavLinkBase>
  )
}

export function NavGroup({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {label && <div style={{ ...textStyle.overline, color: kit.subtle, padding: '0 10px 6px' }}>{label}</div>}
      {children}
    </div>
  )
}

export function Breadcrumb({ items }: { items: Array<{ label: string; to?: string }> }) {
  const Link = useUiLink()
  return (
    <nav aria-label="Breadcrumb" style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      {items.map((item, i) => {
        const last = i === items.length - 1
        return (
          <Fragment key={`${item.label}-${i}`}>
            {i > 0 && <Icon name="chevronRight" size={14} color={kit.subtle} />}
            {last || !item.to ? (
              <span aria-current={last ? 'page' : undefined} style={{ ...(last ? textStyle.label : textStyle.small), color: last ? kit.ink : kit.muted, whiteSpace: 'nowrap' }}>{item.label}</span>
            ) : (
              <Link to={item.to} style={{ ...textStyle.small, color: kit.muted, textDecoration: 'none', whiteSpace: 'nowrap' }}>{item.label}</Link>
            )}
          </Fragment>
        )
      })}
    </nav>
  )
}

/* ---------- Page furniture ---------- */

export function PageHeader({ title, subtitle, actions, badge, back }: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  badge?: ReactNode
  back?: { to: string; label: string }
}) {
  return (
    <div className="shz-page-header" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: '1 1 320px' }}>
        {back && <Button variant="ghost" size="sm" icon="arrowLeft" to={back.to} style={{ alignSelf: 'flex-start', marginLeft: -10 }}>{back.label}</Button>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Text v="display" as="h1">{title}</Text>
          {badge}
        </div>
        {subtitle && <Text v="small" tone="muted" as="p">{subtitle}</Text>}
      </div>
      {actions && <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>{actions}</div>}
    </div>
  )
}

/** Notice card: amber (or other) accent bar, icon, title, body and an optional action. */
export function Banner({ title, children, icon = 'alert', accent = kit.amber, action, style, role = 'status' }: {
  title: ReactNode
  children?: ReactNode
  icon?: IconName
  accent?: string
  action?: ReactNode
  style?: CSSProperties
  role?: 'status' | 'alert'
}) {
  return (
    <div role={role} style={{ display: 'flex', background: kit.surface, outline: `1px solid ${kit.line}`, outlineOffset: -1, borderRadius: 6, overflow: 'hidden', ...style }}>
      <span aria-hidden style={{ width: 3, background: accent, flexShrink: 0 }} />
      <div style={{ display: 'flex', gap: 12, padding: '14px 16px 14px 14px', flex: 1, alignItems: 'flex-start', minWidth: 0, flexWrap: 'wrap' }}>
        <Icon name={icon} size={18} color={kit.ink} style={{ marginTop: 0 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 240px', minWidth: 0 }}>
          <Text v="button" as="p">{title}</Text>
          {children && <Text v="small" tone="muted" as="div">{children}</Text>}
        </div>
        {action}
      </div>
    </div>
  )
}

export function StatCard({ label, value, hint, onClick, to }: { label: string; value: ReactNode; hint?: ReactNode; onClick?: () => void; to?: string }) {
  const Link = useUiLink()
  const body = (
    <>
      <Text v="small" tone="muted">{label}</Text>
      <Text v="stat" tabular>{value}</Text>
      {hint && <Text v="caption" tone="subtle">{hint}</Text>}
    </>
  )
  const style: CSSProperties = {
    background: kit.surface,
    border: `1px solid ${kit.line}`,
    borderRadius: 8,
    padding: '16px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    flex: '1 1 0',
    minWidth: 0,
    textDecoration: 'none',
    textAlign: 'left',
  }
  if (to) return <StatLinkAny as={Link} to={to} style={style}>{body}</StatLinkAny>
  if (onClick) return <StatLinkAny as="button" type="button" onClick={onClick} style={style}>{body}</StatLinkAny>
  return <div style={style}>{body}</div>
}

const StatLink = styled('a')({ cursor: 'pointer', '&:hover': { borderColor: `${kit.field} !important` }, ...focusRing })
const StatLinkAny = StatLink as unknown as ElementType

/* ---------- Tabs ---------- */

export interface TabItem<T extends string> {
  value: T
  label: string
  count?: number
}

export function Tabs<T extends string>({ items, value, onChange, label }: { items: TabItem<T>[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div role="tablist" aria-label={label} className="shz-tabs" style={{ display: 'flex', gap: 24, alignItems: 'flex-end', overflowX: 'auto', scrollbarWidth: 'none' }}>
        {items.map(item => {
          const active = item.value === value
          return (
            <TabButton key={item.value} role="tab" type="button" aria-selected={active} onClick={() => onChange(item.value)}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 2px' }}>
                <span style={{ ...(active ? textStyle.label : textStyle.small), color: active ? kit.ink : kit.muted, whiteSpace: 'nowrap' }}>{item.label}</span>
                {item.count !== undefined && (
                  <span style={{ ...textStyle.caption, color: kit.muted, background: kit.chip, borderRadius: 999, padding: '0 6px' }}>{item.count}</span>
                )}
              </span>
              <span aria-hidden style={{ height: active ? 3 : 2, background: active ? kit.amber : 'transparent', borderRadius: 1 }} />
            </TabButton>
          )
        })}
      </div>
      <span aria-hidden style={{ height: 1, background: kit.line }} />
    </div>
  )
}

const TabButton = styled('button')({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '10px 0 0',
  border: 0,
  background: 'transparent',
  cursor: 'pointer',
  flexShrink: 0,
  ...focusRing,
})

/* ---------- Tables ---------- */

export const TableFrame = styled('div')({
  // Contains visually hidden header labels so they cannot widen the page.
  position: 'relative',
  border: `1px solid ${kit.line}`,
  borderRadius: 8,
  overflow: 'auto',
  background: kit.surface,
  minWidth: 0,
})

export const Table = styled('table')({
  width: '100%',
  borderCollapse: 'collapse',
  '& th': {
    ...textStyle.overline,
    color: kit.subtle,
    textAlign: 'left',
    background: kit.canvas,
    padding: '10px 8px',
    whiteSpace: 'nowrap',
    fontWeight: 700,
  },
  '& td': {
    ...textStyle.small,
    color: kit.ink,
    padding: '12px 8px',
    borderTop: `1px solid ${kit.line}`,
    verticalAlign: 'middle',
    background: kit.surface,
  },
  '& th:first-of-type, & td:first-of-type': { paddingLeft: 16 },
  '& th:last-of-type, & td:last-of-type': { paddingRight: 16 },
  '& tr[aria-selected="true"] td': { background: kit.canvas },
  '& tbody tr:hover td': { background: '#FFFBEC' },
  '& .num': { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
})

/* ---------- Empty and error states ---------- */

export function EmptyState({ title, children, action, icon = 'package', note }: { title: string; children?: ReactNode; action?: ReactNode; icon?: IconName; note?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 10, padding: '48px 24px' }}>
      <span style={{ width: 44, height: 44, borderRadius: 10, background: kit.chip, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: kit.brown }}>
        <Icon name={icon} size={22} />
      </span>
      {note && <Text v="informal" tone="brown">{note}</Text>}
      <Text v="title" as="h2">{title}</Text>
      {children && <Text v="small" tone="muted" as="p" style={{ maxWidth: 420 }}>{children}</Text>}
      {action && <div style={{ marginTop: 6 }}>{action}</div>}
    </div>
  )
}

export function Skeleton({ width = '100%', height = 14, radius = 4, style }: { width?: number | string; height?: number; radius?: number; style?: CSSProperties }) {
  return <span aria-hidden className="shz-skeleton" style={{ display: 'block', width, height, borderRadius: radius, background: kit.line, ...style }} />
}
