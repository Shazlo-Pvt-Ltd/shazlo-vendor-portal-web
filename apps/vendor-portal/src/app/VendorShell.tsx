import Popover from '@mui/material/Popover'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useState, type ReactNode } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router'
import {
  AppFrame, Avatar, Icon, IconButton, kit, Logo, MainColumn, NavGroup, NavItem, Rule, Sidebar, StatusBadge, Text, textStyle, TopBar as TopBarBox,
  type IconName,
} from '@shazlo/ui/components'
import { useOverview } from '../api/hooks'
import { relativeTime } from '../lib/format'
import { useNavCounts } from './navCounts'
import { useSession } from './session'
import { MobileChromeProvider, useMobileChromeState } from './mobileTask'
import { TopBarMounts, TopBarProvider } from './topbar'

export const MOBILE_QUERY = '(max-width: 899.95px)'

function isActive(pathname: string, to: string) {
  if (to === '/') return pathname === '/'
  if (to === '/products') return pathname === '/products' || (pathname.startsWith('/products/') && !pathname.startsWith('/products/import'))
  return pathname === to || pathname.startsWith(`${to}/`)
}

function NotificationsBell({ size = 18 }: { size?: number }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const { data } = useOverview()
  const navigate = useNavigate()
  const decisions = data?.recentDecisions ?? []
  const unread = decisions.filter(d => d.outcome === 'rejected').length
  return (
    <>
      <IconButton aria-label={`Notifications${unread ? `, ${unread} need action` : ''}`} onClick={e => setAnchor(e.currentTarget)}>
        <Icon name="bell" size={size} />
        {unread > 0 && <span aria-hidden style={{ position: 'absolute', top: 6, right: 6, width: 7, height: 7, borderRadius: 999, background: kit.amber, border: `1.5px solid ${kit.surface}` }} />}
      </IconButton>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { mt: 1, width: 340, maxWidth: 'calc(100vw - 24px)', borderRadius: '8px', border: `1px solid ${kit.line}`, background: kit.surface, boxShadow: '0 12px 32px rgba(23,18,14,0.14)' } } }}
      >
        <div style={{ padding: '14px 16px', borderBottom: `1px solid ${kit.line}` }}><Text v="title">Notifications</Text></div>
        {decisions.length === 0 && <div style={{ padding: 16 }}><Text tone="muted">Nothing new. Review decisions show up here.</Text></div>}
        {decisions.map(d => (
          <button
            key={d.id}
            type="button"
            onClick={() => { setAnchor(null); navigate(d.subject.kind === 'product' ? `/products/${d.subject.productId}` : '/brand') }}
            style={{ display: 'flex', gap: 10, width: '100%', textAlign: 'left', padding: '12px 16px', border: 0, borderBottom: `1px solid ${kit.line}`, background: 'transparent', cursor: 'pointer' }}
          >
            <span style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
              <Text v="label" truncate>{d.subject.title}</Text>
              <Text v="caption" tone="subtle">{d.outcome === 'approved' ? 'Approved by the Shazlo review team' : 'Sent back by the Shazlo review team'} · {relativeTime(d.decidedAt)}</Text>
            </span>
            <StatusBadge tone={d.outcome === 'approved' ? 'approved' : 'sentBack'} />
          </button>
        ))}
        <div style={{ padding: '10px 16px' }}>
          <button type="button" className="shz-link" onClick={() => { setAnchor(null); navigate('/review') }} style={{ ...textStyle.label, color: kit.link, background: 'none', border: 0, padding: 0, cursor: 'pointer' }}>See all review decisions</button>
        </div>
      </Popover>
    </>
  )
}

function StoreSwitcher() {
  const { session } = useSession()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  if (!session) return null
  return (
    <>
      <button
        type="button"
        aria-haspopup="menu"
        onClick={e => setAnchor(e.currentTarget)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, border: `1px solid ${kit.line}`, borderRadius: 8, background: 'transparent', cursor: 'pointer', textAlign: 'left', width: '100%' }}
      >
        <Avatar initials={session.vendor.initials} />
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
          <Text v="label" truncate>{session.vendor.brandName}</Text>
          <Text v="caption" tone="subtle">{session.vendor.status === 'approved' ? 'Approved seller' : 'Seller'}</Text>
        </span>
        <Icon name="chevronDown" size={14} color={kit.muted} />
      </button>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { sx: { mt: 0.5, width: 224, borderRadius: '8px', border: `1px solid ${kit.line}`, background: kit.surface, boxShadow: '0 12px 32px rgba(23,18,14,0.14)', p: 1.5 } } }}
      >
        <Text v="caption" tone="subtle" as="p">You manage one store.</Text>
        <Text v="caption" tone="subtle" as="p" style={{ marginTop: 6 }}>To add another brand, write to partners@shazlo.store.</Text>
      </Popover>
    </>
  )
}

const primaryNav: Array<{ to: string; icon: IconName; label: string; count?: 'products' | 'review' }> = [
  { to: '/', icon: 'grid', label: 'Overview' },
  { to: '/brand', icon: 'store', label: 'Brand page' },
  { to: '/products', icon: 'package', label: 'Products', count: 'products' },
  { to: '/products/import', icon: 'sheet', label: 'Bulk import' },
  { to: '/review', icon: 'clock', label: 'Review status', count: 'review' },
]

const secondaryNav: Array<{ to: string; icon: IconName; label: string }> = [
  { to: '/settings', icon: 'sliders', label: 'Store settings' },
  { to: '/team', icon: 'users', label: 'Team' },
  { to: '/help', icon: 'help', label: 'Help & support' },
]

const mobileTabs: Array<{ to: string; icon: IconName; label: string }> = [
  { to: '/', icon: 'grid', label: 'Overview' },
  { to: '/products', icon: 'package', label: 'Products' },
  { to: '/brand', icon: 'store', label: 'Brand page' },
  { to: '/review', icon: 'clock', label: 'Status' },
  { to: '/more', icon: 'more', label: 'More' },
]

function DesktopSidebar() {
  const { pathname } = useLocation()
  const counts = useNavCounts()
  const { session, signOut } = useSession()
  const navigate = useNavigate()
  return (
    <Sidebar aria-label="Seller portal">
      <div style={{ padding: '0 8px', display: 'flex', alignItems: 'center' }}><Logo tag="SELLER" /></div>
      <StoreSwitcher />
      <NavGroup>
        {primaryNav.map(item => (
          <NavItem key={item.to} to={item.to} icon={item.icon} label={item.label} active={isActive(pathname, item.to)} count={item.count ? counts[item.count] : undefined} />
        ))}
      </NavGroup>
      <Rule />
      <NavGroup>
        {secondaryNav.map(item => <NavItem key={item.to} to={item.to} icon={item.icon} label={item.label} active={isActive(pathname, item.to)} />)}
      </NavGroup>
      <div style={{ flex: 1 }} />
      <Rule />
      {session && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px' }}>
          <Avatar initials={session.user.initials} />
          <span style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
            <Text v="label" truncate>{session.user.name}</Text>
            <Text v="caption" tone="subtle">{session.user.role === 'owner' ? 'Owner' : 'Staff'}</Text>
          </span>
          <IconButton aria-label="Sign out" onClick={async () => { await signOut(); navigate('/sign-in') }}><Icon name="logout" size={16} /></IconButton>
        </div>
      )}
    </Sidebar>
  )
}

function MobileAppBar() {
  const { session } = useSession()
  return (
    <header style={{ position: 'sticky', top: 0, zIndex: 10, height: 56, background: kit.surface, display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', borderBottom: `1px solid ${kit.line}` }}>
      {session && <Avatar initials={session.vendor.initials} />}
      <span style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <Text v="title" truncate>{session?.vendor.brandName}</Text>
        <Text v="caption" tone="subtle">Approved seller</Text>
      </span>
      <NotificationsBell size={22} />
    </header>
  )
}

function MobileTabBar() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  return (
    <nav aria-label="Seller portal" style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 20, background: kit.surface, borderTop: `1px solid ${kit.line}`, display: 'flex', justifyContent: 'space-around', padding: '8px 4px calc(16px + env(safe-area-inset-bottom))' }}>
      {mobileTabs.map(tab => {
        const active = tab.to === '/more' ? ['/more', '/settings', '/team', '/help', '/products/import'].includes(pathname) : isActive(pathname, tab.to)
        return (
          <button
            key={tab.to}
            type="button"
            aria-current={active ? 'page' : undefined}
            onClick={() => navigate(tab.to)}
            style={{ width: 72, minHeight: 44, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, background: 'none', border: 0, cursor: 'pointer', color: active ? kit.ink : kit.subtle, padding: 0 }}
          >
            <Icon name={tab.icon} size={22} />
            <span style={{ ...textStyle.caption, color: 'inherit' }}>{tab.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

function MobileLayout({ pathname, children }: { pathname: string; children: ReactNode }) {
  const chrome = useMobileChromeState()
  return (
    <div style={{ minHeight: '100dvh', background: kit.canvas }}>
      {!chrome.ownAppBar && <MobileAppBar />}
      <div id="main" key={pathname}>{children}</div>
      {!chrome.hideTabBar && <MobileTabBar />}
    </div>
  )
}

export function VendorShell({ children }: { children?: ReactNode }) {
  const mobile = useMediaQuery(MOBILE_QUERY, { noSsr: true })
  const { pathname } = useLocation()
  return (
    <TopBarProvider>
      <a href="#main" className="shz-skip">Skip to content</a>
      {mobile ? (
        <MobileChromeProvider>
          <MobileLayout pathname={pathname}>{children ?? <Outlet />}</MobileLayout>
        </MobileChromeProvider>
      ) : (
        <AppFrame>
          <DesktopSidebar />
          <MainColumn>
            <TopBarBox>
              <TopBarMounts trailing={<NotificationsBell />} />
            </TopBarBox>
            <div id="main" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>{children ?? <Outlet />}</div>
          </MainColumn>
        </AppFrame>
      )}
    </TopBarProvider>
  )
}
