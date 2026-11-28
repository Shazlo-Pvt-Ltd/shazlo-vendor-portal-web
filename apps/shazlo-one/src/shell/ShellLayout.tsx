import { Avatar, Box, Breadcrumbs, Divider, Drawer, IconButton, Link, List, ListItemButton, ListItemIcon, ListItemText, Stack, Typography, useMediaQuery, useTheme } from '@mui/material'
import { brand, emphasis, fontFamily, Logo, radius } from '@shazlo/ui'
import { House, LogOut, Menu, Users, X, type LucideIcon } from 'lucide-react'
import { Suspense, useId, useState, type ReactNode } from 'react'
import { Link as RouterLink, Outlet, useLocation, useMatches, useNavigate } from 'react-router'
import { useVendorSummary } from '../api/queries'
import { usePageCrumb, type RouteHandle } from '../app/crumbs'
import { paths } from '../app/paths'
import { currentLink, isModuleHome, moduleFor, modules, type ShellModule } from '../app/registry'
import { shellCopy as copy } from '../copy/shell'
import { srOnly } from '../lib/a11y'
import { useSession } from '../session/useSession'
import { PHONE_CRUMBS, shellTop, TOP } from './metrics'
import { ModuleNav } from './ModuleNav'
import { PageFallback } from './PageFallback'

const SIDEBAR = 256
// Shazlo One's chrome is navy (design language: "Navy: Shazlo-One shell, sign-in and bulk actions").
const NAVY_TEXT = 'rgba(255, 252, 227, 0.78)'
const NAVY_LINE = 'rgba(255, 252, 227, 0.14)'
const NAVY_HOVER = 'rgba(255, 252, 227, 0.12)'
// The guide line that ties a module's pages to it.
const NAVY_GUIDE = 'rgba(255, 252, 227, 0.24)'
const amberRing = { outline: `2px solid ${brand.amber}`, outlineOffset: 2 } as const
const onNavy = {
  color: NAVY_TEXT,
  '&:focus-visible': amberRing,
  '@media (hover: hover)': { '&:hover': { bgcolor: NAVY_HOVER } },
} as const

// Rows: a 12 px gutter, then an 18 px icon in a 32 px column, then the label. A module's pages sit on
// a guide line through the centre of the module's icon, with their icons in line with its label.
const ROW_PL = 12
const ICON = 18
const ICON_COLUMN = 32
const GUIDE_X = ROW_PL + ICON / 2 - 1
const NESTED_PL = ICON_COLUMN - (GUIDE_X + 1)

type NavLinkProps = {
  to: string
  label: string
  icon: LucideIcon
  active: boolean
  // In this module, on one of its pages: the label is set in semibold, but the page itself is current.
  parent?: boolean
  count?: number
  countLabel?: string
  nested?: boolean
  touch: boolean
  onNavigate?: () => void
  children?: ReactNode
}

function NavLink({ to, label, icon: Icon, active, parent = false, count, countLabel, nested = false, touch, onNavigate, children }: NavLinkProps) {
  return (
    <Box component="li" sx={{ listStyle: 'none' }}>
      <ListItemButton
        component={RouterLink}
        to={to}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        sx={{
          borderRadius: `${radius.control}px`,
          // Touch screens get 44 px rows; the desktop sidebar keeps its tighter rhythm.
          minHeight: touch ? (nested ? 44 : 48) : nested ? 36 : 40,
          pl: `${ROW_PL}px`,
          pr: 1.5,
          mb: 0.25,
          color: active ? brand.navy : parent ? brand.offWhite : NAVY_TEXT,
          bgcolor: active ? brand.amber : 'transparent',
          '&.Mui-focusVisible': { bgcolor: active ? brand.amber : NAVY_HOVER },
          '&:focus-visible': amberRing,
          '@media (hover: hover)': { '&:hover': { bgcolor: active ? brand.amber : NAVY_HOVER, color: active ? brand.navy : brand.offWhite } },
        }}
      >
        <ListItemIcon sx={{ minWidth: nested ? ICON_COLUMN - 4 : ICON_COLUMN, color: 'inherit' }}>
          <Icon size={ICON} strokeWidth={1.75} aria-hidden="true" />
        </ListItemIcon>
        <ListItemText primary={label} slotProps={{ primary: { variant: nested ? 'body2' : 'body1', sx: active || parent ? emphasis.semibold : undefined } }} />
        {count != null && count > 0 && (
          <>
            <Box component="span" sx={srOnly}>{`, ${countLabel ?? count}`}</Box>
            <Box component="span" aria-hidden="true" sx={{ minWidth: 22, height: 20, px: 0.75, borderRadius: 10, bgcolor: active ? brand.navy : brand.amber, color: active ? brand.offWhite : brand.wine, typography: 'caption', display: 'grid', placeItems: 'center', fontVariantNumeric: 'tabular-nums' }}>
              {count}
            </Box>
          </>
        )}
      </ListItemButton>
      {children}
    </Box>
  )
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Typography component="p" variant="caption" sx={{ color: 'rgba(255, 252, 227, 0.55)', px: 1.5, pt: 2.5, pb: 0.75 }}>
      {children}
    </Typography>
  )
}

// The sections, then the signed-in person. The desktop sidebar and the phone drawer both use it.
function Navigation({ touch, onNavigate }: { touch: boolean; onNavigate?: () => void }) {
  const { admin, can, signOut } = useSession()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const allowed = modules.filter((m) => can(m.roles))
  const summary = useVendorSummary(allowed.length > 0).data
  const initials = admin?.display_name.split(' ').map((p) => p[0]).join('').slice(0, 2) ?? ''
  const role = admin?.roles.map((r) => copy.roles[r] ?? r).join(', ')
  const link = { touch, onNavigate }
  return (
    <>
      <Box component="nav" aria-label={copy.navLabel} sx={{ flex: 1, overflowY: 'auto', px: 1.5 }}>
        <List disablePadding sx={{ pt: 1.5 }}>
          <NavLink {...link} to={paths.home} label={copy.home} icon={House} active={pathname === paths.home} />
        </List>
        {allowed.length > 0 && <SectionLabel>{copy.modules}</SectionLabel>}
        <List disablePadding>
          {allowed.map((m) => {
            // The module's row opens its dashboard and is the current page there; on one of its
            // other pages it is the parent, and that page is current (the top bar agrees).
            const home = isModuleHome(m, pathname)
            const current = currentLink(m, pathname)
            return (
              <NavLink key={m.id} {...link} to={m.basePath + m.home.path} label={m.title} icon={m.icon} active={home} parent={moduleFor(pathname) === m} count={summary?.queue.all} countLabel={copy.waiting(summary?.queue.all ?? 0)}>
                <Box component="ul" sx={{ listStyle: 'none', m: 0, mb: 0.5, p: 0, ml: `${GUIDE_X}px`, pl: `${NESTED_PL}px`, borderLeft: `1px solid ${NAVY_GUIDE}` }}>
                  {m.links.map((l) => (
                    <NavLink {...link} key={l.path} nested to={m.basePath + l.path} label={l.label} icon={l.icon} active={l === current} />
                  ))}
                </Box>
              </NavLink>
            )
          })}
        </List>
        {can(['super_admin']) && admin?.roles.includes('super_admin') && (
          <>
            <SectionLabel>{copy.administration}</SectionLabel>
            <List disablePadding>
              <NavLink {...link} to={paths.admins} label={copy.admins} icon={Users} active={pathname.startsWith(paths.admins)} />
            </List>
          </>
        )}
      </Box>
      <Divider sx={{ borderColor: NAVY_LINE }} />
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', px: 2, py: 1.75 }}>
        <Avatar sx={{ width: 32, height: 32, bgcolor: brand.amber, color: brand.wine, fontSize: 12 }} aria-hidden="true">{initials}</Avatar>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body1" noWrap sx={{ color: brand.offWhite }}>{admin?.display_name}</Typography>
          <Typography variant="caption" noWrap component="p" sx={{ color: NAVY_TEXT }}>{role}</Typography>
        </Box>
        <Box
          component="button"
          type="button"
          aria-label={copy.signOut}
          onClick={() => {
            onNavigate?.()
            void signOut().then(() => navigate(paths.signIn, { replace: true }))
          }}
          sx={{ all: 'unset', cursor: 'pointer', display: 'grid', placeItems: 'center', flexShrink: 0, width: touch ? 44 : 36, height: touch ? 44 : 36, borderRadius: '50%', ...onNavy }}
        >
          <LogOut size={18} strokeWidth={1.75} aria-hidden="true" />
        </Box>
      </Stack>
    </>
  )
}

function Sidebar() {
  return (
    <Box component="aside" sx={{ width: SIDEBAR, flexShrink: 0, position: 'sticky', top: 0, height: '100dvh', bgcolor: brand.navy, color: brand.offWhite, display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ px: 2.5, pt: 2.5, pb: 1 }}>
        <Logo product={copy.product} tone="amber" />
      </Box>
      <Navigation touch={false} />
    </Box>
  )
}

function useTrail() {
  const matches = useMatches()
  const pageCrumb = usePageCrumb()
  const crumbs = matches.flatMap((m) => (m.handle as RouteHandle | undefined)?.crumbs ?? [])
  return pageCrumb ? [...crumbs, { label: pageCrumb }] : crumbs
}

// Crumbs stay on one line; a long one ends in an ellipsis instead of pushing the page sideways.
function Crumbs({ lastOnly }: { lastOnly: boolean }) {
  const full = useTrail()
  const trail = lastOnly ? full.slice(-1) : full
  return (
    <Breadcrumbs
      aria-label="Breadcrumb"
      separator="›"
      sx={{ minWidth: 0, '& .MuiBreadcrumbs-ol': { flexWrap: 'nowrap' }, '& .MuiBreadcrumbs-li': { minWidth: 0 }, '& .MuiBreadcrumbs-separator': { flexShrink: 0 } }}
    >
      {trail.map((c, i) =>
        i < trail.length - 1 && 'to' in c && c.to ? (
          <Link key={c.label} component={RouterLink} to={c.to} underline="hover" color="text.secondary" variant="body2" noWrap sx={{ display: 'block' }}>{c.label}</Link>
        ) : (
          <Typography key={c.label} variant="body2" noWrap aria-current={i === trail.length - 1 ? 'page' : undefined} sx={{ fontFamily: fontFamily.display }}>{c.label}</Typography>
        ),
      )}
    </Breadcrumbs>
  )
}

// The crumbs and, inside a module, a row with the module's pages under them. The row carries the
// header's bottom rule when it is there.
function TopBar({ module }: { module?: ShellModule }) {
  return (
    <Box component="header" sx={{ position: 'sticky', top: 0, zIndex: 5, bgcolor: 'background.paper' }}>
      <Stack direction="row" sx={{ alignItems: 'center', height: TOP, px: 5, ...(module ? {} : { borderBottom: '1px solid', borderColor: 'divider' }) }}>
        <Crumbs lastOnly={false} />
      </Stack>
      {module && <ModuleNav module={module} phone={false} />}
    </Box>
  )
}

// Below 900 px: a navy bar with the menu button and brand mark, the current crumb under it, inside a
// module a scrolling row with its pages, and the sidebar's navigation in a temporary drawer.
function PhoneBar({ module }: { module?: ShellModule }) {
  const location = useLocation()
  const drawerId = useId()
  // The drawer is open for the location it was opened on, so any navigation (a link, Back, the
  // module moving itself) closes it without an effect. Escape and the backdrop close it via onClose.
  const [openAt, setOpenAt] = useState<string | null>(null)
  const open = openAt === location.key
  const close = () => setOpenAt(null)
  return (
    <>
      <Box component="header" sx={{ position: 'sticky', top: 0, zIndex: 5 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', height: TOP, px: 1, bgcolor: brand.navy, color: brand.offWhite }}>
          <IconButton aria-label={copy.menu} aria-expanded={open} aria-controls={drawerId} onClick={() => setOpenAt(location.key)} sx={{ width: 44, height: 44, ...onNavy, color: brand.offWhite }}>
            <Menu size={22} strokeWidth={1.75} aria-hidden="true" />
          </IconButton>
          <Link component={RouterLink} to={paths.home} aria-label={copy.homeLink} sx={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, px: 0.5, borderRadius: `${radius.control}px`, '&:focus-visible': { outline: `2px solid ${brand.amber}` } }}>
            <Logo product={copy.product} height={26} tone="amber" />
          </Link>
        </Stack>
        <Stack direction="row" sx={{ alignItems: 'center', height: PHONE_CRUMBS, px: { xs: 2, sm: 3 }, bgcolor: 'background.paper', ...(module ? {} : { borderBottom: '1px solid', borderColor: 'divider' }) }}>
          <Crumbs lastOnly />
        </Stack>
        {module && <ModuleNav module={module} phone />}
      </Box>
      <Drawer
        open={open}
        onClose={close}
        slotProps={{
          paper: {
            id: drawerId,
            role: 'dialog',
            'aria-label': copy.menu,
            sx: { width: 'min(304px, 86vw)', bgcolor: brand.navy, color: brand.offWhite, backgroundImage: 'none', display: 'flex', flexDirection: 'column' },
          },
        }}
      >
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', pl: 2.5, pr: 1, height: TOP, flexShrink: 0 }}>
          <Logo product={copy.product} height={26} tone="amber" />
          <IconButton aria-label={copy.closeMenu} onClick={close} sx={{ width: 44, height: 44, ...onNavy }}>
            <X size={20} strokeWidth={1.75} aria-hidden="true" />
          </IconButton>
        </Stack>
        <Navigation touch onNavigate={close} />
      </Drawer>
    </>
  )
}

// Signed-in layout. Module pages fill the content area edge to edge; shell pages get the usual gutter.
export function ShellLayout() {
  const { pathname } = useLocation()
  const { can } = useSession()
  const theme = useTheme()
  // noSsr reads the query on the first render, so a phone never flashes the desktop sidebar.
  const phone = useMediaQuery(theme.breakpoints.down('md'), { noSsr: true })
  const module = moduleFor(pathname)
  const inModule = module !== undefined
  // The top bar lists the module's pages only in a module this admin may open.
  const navModule = module && can(module.roles) ? module : undefined
  return (
    <Box sx={{ display: 'flex', minHeight: '100dvh', bgcolor: 'background.default', '--shell-top': `${shellTop({ phone, moduleNav: navModule !== undefined })}px` }}>
      <Link href="#content" sx={{ position: 'absolute', left: 8, top: -48, zIndex: 50, bgcolor: 'background.paper', px: 2, py: 1, '&:focus': { top: 8 } }}>{copy.skip}</Link>
      {!phone && <Sidebar />}
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {phone ? <PhoneBar module={navModule} /> : <TopBar module={navModule} />}
        <Box component="main" id="content" tabIndex={-1} sx={{ flex: 1, minWidth: 0, outline: 'none', ...(inModule ? {} : { px: { xs: 2, sm: 3, md: 5 }, pt: { xs: 3, md: 4 }, pb: 8 }) }}>
          <Box sx={inModule ? { height: '100%' } : { maxWidth: 1200, mx: 'auto' }}>
            <Suspense fallback={<PageFallback />}>
              <Outlet />
            </Suspense>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
