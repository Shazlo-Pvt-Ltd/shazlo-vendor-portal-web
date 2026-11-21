import { Avatar, Box, Breadcrumbs, Divider, IconButton, Link, List, ListItemButton, ListItemIcon, ListItemText, Skeleton, Stack, Typography } from '@mui/material'
import { brand, fontFamily, Logo, neutral, radius } from '@shazlo/ui'
import { ChevronLeft, CircleUserRound, ExternalLink, FileSpreadsheet, HelpCircle, History, House, LayoutGrid, LogOut, Package, SlidersHorizontal, Store, Users, type LucideIcon } from 'lucide-react'
import { Suspense, useEffect, useRef, type ReactNode } from 'react'
import { Link as RouterLink, Outlet, useLocation, useMatches, useNavigate, useNavigationType } from 'react-router'
import { useMe, useSummary } from '../api/queries'
import { usePageCrumb, type RouteHandle } from '../app/crumbs'
import { paths } from '../app/paths'
import { useSession } from '../auth/session'
import { shellCopy as copy } from '../copy/shell'
import { srOnly } from '../lib/a11y'
import { GUTTER, PAGE_END, RAIL_WIDTH, SIDEBAR_WIDTH, TAB_BAR_HEIGHT, useNavMode, type NavMode } from './layout'
import { NotificationsMenu } from './NotificationsMenu'
import { PageFallback } from './PageFallback'
import { TaskProvider, useTaskState, type ResolvedBack } from './task'

type NavItem = { to: string; label: string; icon: LucideIcon; match: (path: string) => boolean; count?: number; countLabel?: (n: number) => string }

const under = (path: string, base: string) => path === base || path.startsWith(`${base}/`)
const isHome = (p: string) => p === paths.overview
const isProducts = (p: string) => under(p, paths.products) && p !== paths.bulkImport
const isStoreDetails = (p: string) => under(p, paths.store) || under(p, paths.settings)
const isAccount = (p: string) => under(p, paths.account) || under(p, paths.team) || under(p, paths.help)

// Active state: a navy marker with the label in ink. Never yellow: cream or amber on the off-white
// bars is under 1.5:1, so it would not read as "you are here" (WCAG 1.4.11).
const NAVY_TINT = 'rgba(16, 60, 100, 0.08)'

// ---- desktop (1024 px and wider): the Build 2 sidebar ----------------------------------------

function useSidebarNav() {
  const summary = useSummary().data
  const main: NavItem[] = [
    { to: paths.overview, label: copy.overview, icon: LayoutGrid, match: isHome },
    { to: paths.brand, label: copy.brand, icon: Store, match: (p) => under(p, paths.brand) },
    { to: paths.products, label: copy.products, icon: Package, count: summary?.products.all, match: isProducts },
    { to: paths.bulkImport, label: copy.bulkImport, icon: FileSpreadsheet, match: (p) => p === paths.bulkImport },
    { to: paths.review, label: copy.review, icon: History, count: summary?.reviews_waiting, countLabel: copy.reviewCount, match: (p) => under(p, paths.review) },
  ]
  const more: NavItem[] = [
    { to: paths.storeDetails, label: copy.storeDetails, icon: SlidersHorizontal, match: isStoreDetails },
    { to: paths.team, label: copy.team, icon: Users, match: (p) => under(p, paths.team) },
    { to: paths.help, label: copy.help, icon: HelpCircle, match: (p) => under(p, paths.help) },
  ]
  return { main, more }
}

function initials(name: string) {
  return name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
}

function SideNavItem({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon
  return (
    <li>
      <ListItemButton
        component={RouterLink}
        to={item.to}
        aria-current={active ? 'page' : undefined}
        sx={{
          borderRadius: `${radius.control}px`,
          minHeight: 40,
          px: 1.5,
          mb: 0.25,
          color: neutral.ink,
          bgcolor: active ? NAVY_TINT : 'transparent',
          boxShadow: active ? `inset 3px 0 0 ${brand.navy}` : 'none',
          '@media (hover: hover)': { '&:hover': { bgcolor: active ? NAVY_TINT : 'rgba(16, 60, 100, 0.05)' } },
        }}
      >
        <ListItemIcon sx={{ minWidth: 32, color: active ? brand.navy : 'inherit' }}>
          <Icon size={18} strokeWidth={1.5} aria-hidden="true" />
        </ListItemIcon>
        <ListItemText primary={item.label} slotProps={{ primary: { variant: 'body1', sx: { fontFamily: active ? fontFamily.display : undefined } } }} />
        {item.count != null && (
          <>
            {/* Read as "Review status, 5 in review"; the visible number is the short form. */}
            <Box component="span" sx={srOnly}>
              {`, ${item.countLabel ? item.countLabel(item.count) : item.count}`}
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }} aria-hidden="true">
              {item.count}
            </Typography>
          </>
        )}
      </ListItemButton>
    </li>
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
  const { main, more } = useSidebarNav()
  const { pathname } = useLocation()
  return (
    <Box component="aside" data-nav="sidebar" sx={{ width: SIDEBAR_WIDTH, flexShrink: 0, position: 'sticky', top: 0, height: '100dvh', display: 'flex', flexDirection: 'column', bgcolor: neutral.surface, borderRight: `1px solid ${neutral.line}` }}>
      <Box sx={{ px: 2.5, pt: 2.5, pb: 2 }}>
        <Logo product="Seller" />
      </Box>
      <StoreCard />
      <Box component="nav" aria-label={copy.sectionsLabel} sx={{ flex: 1, overflowY: 'auto', px: 1.5, pt: 2 }}>
        <List disablePadding>
          {main.map((item) => (
            <SideNavItem key={item.to} item={item} active={item.match(pathname)} />
          ))}
        </List>
        <Divider sx={{ my: 1.5 }} />
        <List disablePadding>
          {more.map((item) => (
            <SideNavItem key={item.to} item={item} active={item.match(pathname)} />
          ))}
        </List>
      </Box>
      <UserFooter onSignOut={onSignOut} />
    </Box>
  )
}

// ---- tablet (600–1023 px): a navigation rail ---------------------------------------------------

const RAIL: NavItem[] = [
  { to: paths.overview, label: copy.home, icon: House, match: (p) => isHome(p) },
  { to: paths.products, label: copy.products, icon: Package, match: (p) => under(p, paths.products) },
  { to: paths.review, label: copy.reviewShort, icon: History, match: (p) => under(p, paths.review) },
  { to: paths.brand, label: copy.brand, icon: Store, match: (p) => under(p, paths.brand) },
  { to: paths.storeDetails, label: copy.storeDetails, icon: SlidersHorizontal, match: isStoreDetails },
  { to: paths.account, label: copy.account, icon: CircleUserRound, match: isAccount },
]

// The icon sits in a pill; the current place gets a navy pill with an off-white icon (11:1).
function NavIcon({ icon: Icon, active, width }: { icon: LucideIcon; active: boolean; width: number }) {
  return (
    <Box component="span" sx={{ display: 'grid', placeItems: 'center', width, height: 30, borderRadius: 15, bgcolor: active ? brand.navy : 'transparent', color: active ? brand.offWhite : 'inherit' }}>
      <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
    </Box>
  )
}

const navLinkSx = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 0.5,
  textDecoration: 'none',
  typography: 'caption',
  textAlign: 'center',
  borderRadius: `${radius.control}px`,
} as const

function NavRail() {
  const { pathname } = useLocation()
  return (
    <Box
      component="aside"
      data-nav="rail"
      sx={{ width: `calc(${RAIL_WIDTH}px + env(safe-area-inset-left, 0px))`, pl: 'env(safe-area-inset-left, 0px)', flexShrink: 0, position: 'sticky', top: 0, height: '100dvh', display: 'flex', flexDirection: 'column', bgcolor: neutral.surface, borderRight: `1px solid ${neutral.line}` }}
    >
      <Box sx={{ display: 'grid', placeItems: 'center', height: 56, flexShrink: 0, pt: 'env(safe-area-inset-top, 0px)' }}>
        <Logo height={18} />
      </Box>
      <Box component="nav" aria-label={copy.sectionsLabel} sx={{ flex: 1, overflowY: 'auto', pt: 1 }}>
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          {RAIL.map((item) => {
            const active = item.match(pathname)
            return (
              <li key={item.to}>
                <Box component={RouterLink} to={item.to} aria-current={active ? 'page' : undefined} sx={{ ...navLinkSx, minHeight: 60, mx: 0.5, px: 0.5, py: 0.75, color: active ? neutral.ink : neutral.inkSecondary }}>
                  <NavIcon icon={item.icon} active={active} width={52} />
                  {item.label}
                </Box>
              </li>
            )
          })}
        </Box>
      </Box>
    </Box>
  )
}

// ---- phone (under 600 px): bottom tab bar ------------------------------------------------------

// Places, not actions (Apple HIG): no Add tab, no badges. Review lives under Home on phones.
const TABS: NavItem[] = [
  { to: paths.overview, label: copy.home, icon: House, match: (p) => isHome(p) || under(p, paths.review) },
  { to: paths.products, label: copy.products, icon: Package, match: (p) => under(p, paths.products) },
  { to: paths.store, label: copy.store, icon: Store, match: (p) => isStoreDetails(p) || under(p, paths.brand) },
  { to: paths.account, label: copy.account, icon: CircleUserRound, match: isAccount },
]

function TabBar() {
  const { pathname } = useLocation()
  return (
    <Box
      component="nav"
      aria-label={copy.mobileLabel}
      sx={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 20, bgcolor: neutral.surface, borderTop: `1px solid ${neutral.line}`, pb: 'env(safe-area-inset-bottom, 0px)', px: 'env(safe-area-inset-left, 0px)' }}
    >
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex' }}>
        {TABS.map((item) => {
          const active = item.match(pathname)
          return (
            <Box component="li" key={item.to} sx={{ flex: 1, minWidth: 0 }}>
              <Box component={RouterLink} to={item.to} aria-current={active ? 'page' : undefined} sx={{ ...navLinkSx, height: TAB_BAR_HEIGHT, color: active ? neutral.ink : neutral.inkSecondary }}>
                <NavIcon icon={item.icon} active={active} width={56} />
                {item.label}
              </Box>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

// ---- top bar -------------------------------------------------------------------------------------

function BackLink({ back }: { back: ResolvedBack }) {
  const content = (
    <>
      <ChevronLeft size={20} strokeWidth={1.75} aria-hidden="true" />
      {copy.back}
      {back.label && (
        <Box component="span" sx={srOnly}>
          {copy.backTo(back.label)}
        </Box>
      )}
    </>
  )
  const sx = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 0.25,
    minHeight: 44,
    pl: 0.5,
    pr: 1.5,
    ml: -1,
    color: neutral.ink,
    typography: 'body1',
    textDecoration: 'none',
    border: 0,
    bgcolor: 'transparent',
    cursor: 'pointer',
    borderRadius: `${radius.control}px`,
    '@media (hover: hover)': { '&:hover': { textDecoration: 'underline' } },
  } as const
  return 'to' in back ? (
    <Box component={RouterLink} to={back.to} sx={sx}>
      {content}
    </Box>
  ) : (
    <Box component="button" type="button" onClick={back.onClick} sx={{ ...sx, font: 'inherit' }}>
      {content}
    </Box>
  )
}

function Trail() {
  const matches = useMatches()
  const pageCrumb = usePageCrumb()
  const crumbs = matches.flatMap((m) => (m.handle as RouteHandle | undefined)?.crumbs ?? [])
  const trail = pageCrumb ? [...crumbs, { label: pageCrumb }] : crumbs
  return (
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
  )
}

// Phones: the logo on the four tab pages, Back on inner pages, and only Back in a full-screen task.
// Wider screens: the breadcrumb trail.
function TopBar({ mode, fullScreen, back }: { mode: NavMode; fullScreen: boolean; back: ResolvedBack | null }) {
  const { pathname } = useLocation()
  const phone = mode === 'phone'
  const gutter = GUTTER[mode]
  return (
    <Stack
      component="header"
      direction="row"
      spacing={2}
      sx={{
        alignItems: 'center',
        minHeight: 56,
        pt: 'env(safe-area-inset-top, 0px)',
        pl: `${gutter}px`,
        pr: `max(${gutter}px, env(safe-area-inset-right, 0px))`,
        borderBottom: `1px solid ${neutral.line}`,
        bgcolor: neutral.surface,
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}
    >
      {phone ? (
        <Box sx={{ flex: 1, minWidth: 0 }}>{back ? <BackLink back={back} /> : <Logo product="Seller" height={24} />}</Box>
      ) : (
        <Trail />
      )}
      {mode === 'desktop' && pathname === paths.overview && (
        <Link component={RouterLink} to={paths.brand} underline="hover" variant="body2" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, color: neutral.ink }}>
          <ExternalLink size={14} aria-hidden="true" />
          {copy.viewLivePage}
        </Link>
      )}
      {!(phone && fullScreen) && <NotificationsMenu />}
    </Stack>
  )
}

// ---- the shell -----------------------------------------------------------------------------------

// A page opened from a link or tab starts at the top (the browser keeps the old scroll position
// otherwise). Back/forward and replace navigations (an editor adopting its new address) are left
// alone, and so is Bulk import, which opens as a dialog over Products.
function useScrollToTopOnNewPage() {
  const { pathname, hash } = useLocation()
  const type = useNavigationType()
  const previous = useRef(pathname)
  useEffect(() => {
    const from = previous.current
    previous.current = pathname
    if (from === pathname || type !== 'PUSH' || hash) return
    if (from === paths.bulkImport || pathname === paths.bulkImport) return
    window.scrollTo(0, 0)
  }, [pathname, hash, type])
}

// Links like /store/details#commission: pages load lazily and then fetch, so wait for the target to
// appear (up to 5 s) before scrolling to it. The sticky top bar is cleared by scroll-padding-top.
function useScrollToHash() {
  const { hash, key } = useLocation()
  useEffect(() => {
    if (!hash) return
    const id = decodeURIComponent(hash.slice(1))
    const target = () => document.getElementById(id)
    const found = target()
    if (found) {
      found.scrollIntoView?.({ block: 'start' })
      return
    }
    const observer = new MutationObserver(() => {
      const el = target()
      if (!el) return
      observer.disconnect()
      el.scrollIntoView?.({ block: 'start' })
    })
    observer.observe(document.body, { childList: true, subtree: true })
    const stop = window.setTimeout(() => observer.disconnect(), 5000)
    return () => {
      observer.disconnect()
      window.clearTimeout(stop)
    }
  }, [hash, key])
}

function Layout({ children }: { children?: ReactNode }) {
  const mode = useNavMode()
  const { fullScreen, back } = useTaskState()
  const { signOut } = useSession()
  const navigate = useNavigate()
  const handleSignOut = () => void signOut().then(() => navigate(paths.signIn, { replace: true }))
  const phone = mode === 'phone'
  const tabBar = phone && !fullScreen
  const gutter = GUTTER[mode]
  useScrollToHash()
  useScrollToTopOnNewPage()

  // Full-screen tasks are forms: no accidental pull-to-refresh (see SellerGlobalStyles).
  useEffect(() => {
    if (!fullScreen) return
    const html = document.documentElement
    html.setAttribute('data-task', '')
    return () => html.removeAttribute('data-task')
  }, [fullScreen])

  return (
    <Box data-nav-mode={mode} data-full-screen={fullScreen ? '' : undefined} sx={{ display: 'flex', minHeight: '100dvh', bgcolor: neutral.canvas }}>
      <Link href="#content" sx={{ position: 'absolute', left: 8, top: -48, zIndex: 50, bgcolor: neutral.surface, px: 2, py: 1, '&:focus': { top: 8 } }}>
        {copy.skipToContent}
      </Link>
      {mode === 'desktop' && <Sidebar onSignOut={handleSignOut} />}
      {mode === 'tablet' && <NavRail />}
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <TopBar mode={mode} fullScreen={fullScreen} back={back} />
        <Box
          component="main"
          id="content"
          tabIndex={-1}
          sx={{
            flex: 1,
            outline: 'none',
            pl: `${gutter}px`,
            pr: `max(${gutter}px, env(safe-area-inset-right, 0px))`,
            pt: phone ? 2.5 : 4,
            pb: tabBar ? PAGE_END.phoneTabs : phone ? PAGE_END.phoneTask : PAGE_END.wide,
          }}
        >
          <Box sx={{ maxWidth: 1200, mx: 'auto' }}>
            <Suspense fallback={<PageFallback />}>{children ?? <Outlet />}</Suspense>
          </Box>
        </Box>
      </Box>
      {tabBar && <TabBar />}
    </Box>
  )
}

// Layout for every signed-in page. Navigation follows the window width (./layout.ts): a bottom tab bar
// on phones, a rail on tablets, the sidebar on desktops. Full-screen tasks: ./task.tsx.
export function AppShell({ children }: { children?: ReactNode }) {
  return (
    <TaskProvider>
      <Layout>{children}</Layout>
    </TaskProvider>
  )
}
