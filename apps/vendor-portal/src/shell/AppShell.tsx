import { Avatar, Badge, Box, Breadcrumbs, Divider, Drawer, IconButton, Link, List, ListItemButton, ListItemIcon, ListItemText, Skeleton, Stack, Typography, useMediaQuery } from '@mui/material'
import { type Theme } from '@mui/material/styles'
import { brand, fontFamily, Logo, neutral, radius } from '@shazlo/ui'
import { ExternalLink, FileSpreadsheet, HelpCircle, History, LayoutGrid, LogOut, MoreHorizontal, Package, Plus, SlidersHorizontal, Store, Users, type LucideIcon } from 'lucide-react'
import { Suspense, useState, type ReactNode } from 'react'
import { Link as RouterLink, Outlet, useLocation, useMatches, useNavigate } from 'react-router'
import { useMe, useSummary } from '../api/queries'
import { usePageCrumb, type RouteHandle } from '../app/crumbs'
import { paths } from '../app/paths'
import { useSession } from '../auth/session'
import { shellCopy as copy } from '../copy/shell'
import { NotificationsMenu } from './NotificationsMenu'
import { PageFallback } from './PageFallback'
import { SetupBanner } from './SetupBanner'

const SIDEBAR = 248
const TABBAR = 64

type NavItem = { to: string; label: string; icon: LucideIcon; count?: number; countLabel?: (n: number) => string; match?: (path: string) => boolean }

function useNav() {
  const summary = useSummary().data
  const main: NavItem[] = [
    { to: paths.overview, label: copy.overview, icon: LayoutGrid, match: (p) => p === '/' },
    { to: paths.brand, label: copy.brand, icon: Store },
    { to: paths.products, label: copy.products, icon: Package, count: summary?.products.all, match: (p) => p.startsWith('/products') && p !== paths.bulkImport },
    { to: paths.bulkImport, label: copy.bulkImport, icon: FileSpreadsheet, match: (p) => p === paths.bulkImport },
    { to: paths.review, label: copy.review, icon: History, count: summary?.reviews_waiting, countLabel: (n) => `${n} waiting` },
  ]
  const more: NavItem[] = [
    { to: paths.settings, label: copy.settings, icon: SlidersHorizontal },
    { to: paths.team, label: copy.team, icon: Users },
    { to: paths.help, label: copy.help, icon: HelpCircle },
  ]
  return { main, more }
}

const isActive = (item: NavItem, path: string) => (item.match ? item.match(path) : path === item.to || path.startsWith(`${item.to}/`))

function initials(name: string) {
  return name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
}

function SideNavItem({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon
  const name = item.count != null ? `${item.label}, ${item.countLabel ? item.countLabel(item.count) : item.count}` : item.label
  return (
    <ListItemButton
      component={RouterLink}
      to={item.to}
      aria-current={active ? 'page' : undefined}
      aria-label={name}
      sx={{
        borderRadius: `${radius.control}px`,
        minHeight: 40,
        px: 1.5,
        mb: 0.25,
        color: neutral.ink,
        bgcolor: active ? brand.cream : 'transparent',
        '@media (hover: hover)': { '&:hover': { bgcolor: active ? brand.cream : 'rgba(255, 237, 163, 0.45)' } },
      }}
    >
      <ListItemIcon sx={{ minWidth: 32, color: 'inherit' }}>
        <Icon size={18} strokeWidth={1.5} aria-hidden="true" />
      </ListItemIcon>
      <ListItemText primary={item.label} slotProps={{ primary: { variant: 'body1', sx: { fontFamily: active ? fontFamily.display : undefined } } }} />
      {item.count != null && (
        <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }} aria-hidden="true">
          {item.count}
        </Typography>
      )}
    </ListItemButton>
  )
}

function StoreCard() {
  const me = useMe().data
  if (!me) return <Skeleton variant="rounded" height={58} sx={{ mx: 1.5 }} />
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mx: 1.5, p: 1.5, border: `1px solid ${neutral.line}`, borderRadius: `${radius.card}px`, bgcolor: neutral.surface }}>
      <Avatar sx={{ width: 32, height: 32, bgcolor: brand.cream, color: brand.brown, fontSize: 12 }} aria-hidden="true">
        {initials(me.vendor.brand_name)}
      </Avatar>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body1" noWrap sx={{ fontFamily: fontFamily.display }} title={me.vendor.brand_name}>
          {me.vendor.brand_name}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {me.vendor.status === 'approved' ? copy.approvedSeller : copy.suspendedSeller}
        </Typography>
      </Box>
    </Stack>
  )
}

function UserFooter({ onSignOut }: { onSignOut: () => void }) {
  const me = useMe().data
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', px: 2, py: 1.5, borderTop: `1px solid ${neutral.line}` }}>
      <Avatar sx={{ width: 32, height: 32, bgcolor: brand.cream, color: brand.brown, fontSize: 12 }} aria-hidden="true">
        {me ? initials(me.user.name) : ''}
      </Avatar>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body1" noWrap>
          {me?.user.name ?? ' '}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {me?.role === 'vendor_staff' ? copy.staff : copy.owner}
        </Typography>
      </Box>
      <IconButton aria-label={copy.signOut} onClick={onSignOut} sx={{ color: neutral.inkSecondary }}>
        <LogOut size={18} strokeWidth={1.5} aria-hidden="true" />
      </IconButton>
    </Stack>
  )
}

function Sidebar({ onSignOut }: { onSignOut: () => void }) {
  const { main, more } = useNav()
  const { pathname } = useLocation()
  return (
    <Box component="aside" sx={{ width: SIDEBAR, flexShrink: 0, position: 'sticky', top: 0, height: '100dvh', display: 'flex', flexDirection: 'column', bgcolor: neutral.surface, borderRight: `1px solid ${neutral.line}` }}>
      <Box sx={{ px: 2.5, pt: 2.5, pb: 2 }}>
        <Logo product="Seller" />
      </Box>
      <StoreCard />
      <Box component="nav" aria-label={copy.sectionsLabel} sx={{ flex: 1, overflowY: 'auto', px: 1.5, pt: 2 }}>
        <List disablePadding>
          {main.map((item) => (
            <SideNavItem key={item.to} item={item} active={isActive(item, pathname)} />
          ))}
        </List>
        <Divider sx={{ my: 1.5 }} />
        <List disablePadding>
          {more.map((item) => (
            <SideNavItem key={item.to} item={item} active={isActive(item, pathname)} />
          ))}
        </List>
      </Box>
      <UserFooter onSignOut={onSignOut} />
    </Box>
  )
}

function TopBar({ compact }: { compact: boolean }) {
  const matches = useMatches()
  const pageCrumb = usePageCrumb()
  const crumbs = matches.flatMap((m) => (m.handle as RouteHandle | undefined)?.crumbs ?? [])
  const trail = pageCrumb ? [...crumbs, { label: pageCrumb }] : crumbs
  const { pathname } = useLocation()
  return (
    <Stack
      component="header"
      direction="row"
      spacing={2}
      sx={{ alignItems: 'center', height: 56, px: { xs: 2, md: 4 }, borderBottom: `1px solid ${neutral.line}`, bgcolor: neutral.surface, position: 'sticky', top: 0, zIndex: 10 }}
    >
      {compact ? (
        <Box sx={{ flex: 1 }}>
          <Logo product="Seller" height={24} />
        </Box>
      ) : (
        <Breadcrumbs aria-label="Breadcrumb" separator="›" sx={{ flex: 1, minWidth: 0, '& ol': { flexWrap: 'nowrap' } }}>
          {trail.map((c, i) =>
            i < trail.length - 1 && 'to' in c && c.to ? (
              <Link key={c.label} component={RouterLink} to={c.to} underline="hover" color="text.secondary" variant="body2">
                {c.label}
              </Link>
            ) : (
              <Typography key={c.label} variant="body2" noWrap aria-current={i === trail.length - 1 ? 'page' : undefined} sx={{ fontFamily: fontFamily.display }}>
                {c.label}
              </Typography>
            ),
          )}
        </Breadcrumbs>
      )}
      {!compact && pathname === paths.overview && (
        <Link component={RouterLink} to={paths.brand} underline="hover" variant="body2" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, color: neutral.ink }}>
          <ExternalLink size={14} aria-hidden="true" />
          {copy.viewLivePage}
        </Link>
      )}
      <NotificationsMenu />
    </Stack>
  )
}

function MobileTabBar({ onMore }: { onMore: () => void }) {
  const { pathname } = useLocation()
  const waiting = useSummary().data?.reviews_waiting ?? 0
  const tabs = [
    { to: paths.overview, label: copy.overview, icon: LayoutGrid, active: pathname === '/' },
    { to: paths.products, label: copy.products, icon: Package, active: pathname.startsWith('/products') && pathname !== paths.newProduct },
    { to: paths.newProduct, label: copy.add, icon: Plus, active: pathname === paths.newProduct, primary: true },
    { to: paths.review, label: copy.reviewShort, icon: History, active: pathname === paths.review, badge: waiting },
  ]
  const tabSx = { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 0.25, height: TABBAR, color: neutral.inkSecondary, textDecoration: 'none', typography: 'caption', border: 0, bgcolor: 'transparent', cursor: 'pointer', font: 'inherit' } as const
  return (
    <Box
      component="nav"
      aria-label={copy.mobileLabel}
      sx={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 20, display: 'flex', bgcolor: neutral.surface, borderTop: `1px solid ${neutral.line}`, pb: 'env(safe-area-inset-bottom, 0px)', px: 'env(safe-area-inset-left, 0px)' }}
    >
      {tabs.map(({ to, label, icon: Icon, active, primary, badge }) => (
        <Box key={to} component={RouterLink} to={to} aria-current={active ? 'page' : undefined} sx={{ ...tabSx, color: active ? neutral.ink : neutral.inkSecondary }}>
          {primary ? (
            <Box component="span" sx={{ display: 'grid', placeItems: 'center', width: 36, height: 36, borderRadius: '50%', bgcolor: brand.amber, color: brand.wine }}>
              <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
            </Box>
          ) : (
            <Badge badgeContent={badge} color="primary" invisible={!badge} slotProps={{ badge: { 'aria-hidden': true } as object }}>
              <Box component="span" sx={{ display: 'grid', placeItems: 'center', width: 40, height: 28, borderRadius: 14, bgcolor: active ? brand.cream : 'transparent' }}>
                <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
              </Box>
            </Badge>
          )}
          {label}
        </Box>
      ))}
      <Box component="button" type="button" onClick={onMore} sx={tabSx}>
        <Box component="span" sx={{ display: 'grid', placeItems: 'center', width: 40, height: 28 }}>
          <MoreHorizontal size={20} strokeWidth={1.5} aria-hidden="true" />
        </Box>
        {copy.more}
      </Box>
    </Box>
  )
}

function MoreSheet({ open, onClose, onSignOut }: { open: boolean; onClose: () => void; onSignOut: () => void }) {
  const items = [
    { to: paths.brand, label: copy.brand, icon: Store },
    { to: paths.bulkImport, label: copy.bulkImport, icon: FileSpreadsheet },
    { to: paths.settings, label: copy.settings, icon: SlidersHorizontal },
    { to: paths.team, label: copy.team, icon: Users },
    { to: paths.help, label: copy.help, icon: HelpCircle },
  ]
  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      slotProps={{ paper: { 'aria-label': copy.more, role: 'dialog', sx: { borderRadius: `${radius.sheet}px ${radius.sheet}px 0 0`, pb: 'calc(12px + env(safe-area-inset-bottom, 0px))', bgcolor: neutral.surface } } as object }}
    >
      <Box sx={{ width: 36, height: 4, borderRadius: 2, bgcolor: neutral.line, mx: 'auto', mt: 1.5, mb: 1 }} aria-hidden="true" />
      <List>
        {items.map(({ to, label, icon: Icon }) => (
          <ListItemButton key={to} component={RouterLink} to={to} onClick={onClose} sx={{ minHeight: 48 }}>
            <ListItemIcon sx={{ minWidth: 36, color: neutral.ink }}>
              <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
            </ListItemIcon>
            <ListItemText primary={label} />
          </ListItemButton>
        ))}
        <Divider sx={{ my: 1 }} />
        <ListItemButton component="button" onClick={onSignOut} sx={{ minHeight: 48, width: '100%' }}>
          <ListItemIcon sx={{ minWidth: 36, color: neutral.ink }}>
            <LogOut size={20} strokeWidth={1.5} aria-hidden="true" />
          </ListItemIcon>
          <ListItemText primary={copy.signOut} />
        </ListItemButton>
      </List>
    </Drawer>
  )
}

// Layout for every signed-in page: sidebar on desktop, top bar + bottom tabs on phones.
export function AppShell({ children }: { children?: ReactNode }) {
  const desktop = useMediaQuery((t: Theme) => t.breakpoints.up('md'))
  const [moreOpen, setMoreOpen] = useState(false)
  const { signOut } = useSession()
  const navigate = useNavigate()
  const handleSignOut = () => {
    setMoreOpen(false)
    void signOut().then(() => navigate(paths.signIn, { replace: true }))
  }

  return (
    <Box sx={{ display: 'flex', minHeight: '100dvh', bgcolor: neutral.canvas }}>
      <Link href="#content" sx={{ position: 'absolute', left: 8, top: -48, zIndex: 50, bgcolor: neutral.surface, px: 2, py: 1, '&:focus': { top: 8 } }}>
        {copy.skipToContent}
      </Link>
      {desktop && <Sidebar onSignOut={handleSignOut} />}
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <TopBar compact={!desktop} />
        <Box component="main" id="content" tabIndex={-1} sx={{ flex: 1, outline: 'none', px: { xs: 2, sm: 3, md: 5 }, pt: { xs: 2.5, md: 4 }, pb: { xs: `${TABBAR + 32}px`, md: 8 } }}>
          <Box sx={{ maxWidth: 1200, mx: 'auto' }}>
            <SetupBanner />
            <Suspense fallback={<PageFallback />}>{children ?? <Outlet />}</Suspense>
          </Box>
        </Box>
      </Box>
      {!desktop && (
        <>
          <MobileTabBar onMore={() => setMoreOpen(true)} />
          <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} onSignOut={handleSignOut} />
        </>
      )}
    </Box>
  )
}
