import { Avatar, Box, Breadcrumbs, Divider, Drawer, IconButton, Link, List, ListItemButton, ListItemIcon, ListItemText, Stack, Typography, useMediaQuery, useTheme } from '@mui/material'
import { brand, fontFamily, Logo, radius } from '@shazlo/ui'
import { Home, LogOut, Menu, Users, X } from 'lucide-react'
import { Suspense, useId, useState, type ReactNode } from 'react'
import { Link as RouterLink, Outlet, useLocation, useMatches, useNavigate } from 'react-router'
import { useVendorSummary } from '../api/queries'
import { usePageCrumb, type RouteHandle } from '../app/crumbs'
import { paths } from '../app/paths'
import { modules } from '../app/registry'
import { shellCopy as copy } from '../copy/shell'
import { srOnly } from '../lib/a11y'
import { useSession } from '../session/useSession'
import { PageFallback } from './PageFallback'

const SIDEBAR = 256
const TOP = 56
// Phones stack the navy bar and a one-crumb bar; the module iframe fills what is left.
const PHONE_CRUMBS = 44
// Shazlo One's chrome is navy (design language: "Navy: Shazlo-One shell, sign-in and bulk actions").
const NAVY_TEXT = 'rgba(255, 252, 227, 0.78)'
const NAVY_LINE = 'rgba(255, 252, 227, 0.14)'
const NAVY_HOVER = 'rgba(255, 252, 227, 0.08)'
const onNavy = {
  color: NAVY_TEXT,
  '&:focus-visible': { outline: `2px solid ${brand.amber}`, outlineOffset: 2 },
  '@media (hover: hover)': { '&:hover': { bgcolor: NAVY_HOVER } },
} as const
const navyLogo = { '& img': { filter: 'brightness(0) invert(0.97) sepia(0.15)' }, '& span': { color: brand.amber, borderColor: 'rgba(250, 182, 42, 0.6)' } } as const

type NavLinkProps = { to: string; label: string; icon?: ReactNode; active: boolean; count?: number; countLabel?: string; inset?: boolean; touch: boolean; onNavigate?: () => void }

function NavLink({ to, label, icon, active, count, countLabel, inset = false, touch, onNavigate }: NavLinkProps) {
  return (
    <li>
      <ListItemButton
        component={RouterLink}
        to={to}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        sx={{
          borderRadius: `${radius.control}px`,
          // Touch screens get 44 px rows; the desktop sidebar keeps its tighter rhythm.
          minHeight: touch ? (inset ? 44 : 48) : inset ? 34 : 40,
          pl: inset ? 6 : 1.5,
          pr: 1.5,
          mb: 0.25,
          color: active ? brand.navy : NAVY_TEXT,
          bgcolor: active ? brand.amber : 'transparent',
          '@media (hover: hover)': { '&:hover': { bgcolor: active ? brand.amber : NAVY_HOVER } },
        }}
      >
        {icon && <ListItemIcon sx={{ minWidth: 32, color: 'inherit' }}>{icon}</ListItemIcon>}
        <ListItemText primary={label} slotProps={{ primary: { variant: inset ? 'body2' : 'body1', sx: { fontFamily: active && !inset ? fontFamily.display : undefined } } }} />
        {count != null && count > 0 && (
          <>
            <Box component="span" sx={srOnly}>{`, ${countLabel ?? count}`}</Box>
            <Box component="span" aria-hidden="true" sx={{ minWidth: 22, height: 20, px: 0.75, borderRadius: 10, bgcolor: active ? brand.navy : brand.amber, color: active ? brand.offWhite : brand.wine, typography: 'caption', display: 'grid', placeItems: 'center', fontVariantNumeric: 'tabular-nums' }}>
              {count}
            </Box>
          </>
        )}
      </ListItemButton>
    </li>
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
          <NavLink {...link} to={paths.home} label={copy.home} icon={<Home size={18} strokeWidth={1.5} aria-hidden="true" />} active={pathname === paths.home} />
        </List>
        {allowed.length > 0 && <SectionLabel>{copy.modules}</SectionLabel>}
        <List disablePadding>
          {allowed.map((m) => {
            const Icon = m.icon
            const inModule = pathname.startsWith(m.basePath)
            return (
              <Box component="li" key={m.id} sx={{ listStyle: 'none' }}>
                <List disablePadding>
                  <NavLink {...link} to={m.basePath + m.links[0]!.path} label={m.title} icon={<Icon size={18} strokeWidth={1.5} aria-hidden="true" />} active={false} count={summary?.queue.all} countLabel={copy.waiting(summary?.queue.all ?? 0)} />
                  {m.links.map((l) => (
                    <NavLink {...link} key={l.path} inset to={m.basePath + l.path} label={l.label} active={inModule && pathname.startsWith(m.basePath + l.path)} />
                  ))}
                </List>
              </Box>
            )
          })}
        </List>
        {can(['super_admin']) && admin?.roles.includes('super_admin') && (
          <>
            <SectionLabel>{copy.administration}</SectionLabel>
            <List disablePadding>
              <NavLink {...link} to={paths.admins} label={copy.admins} icon={<Users size={18} strokeWidth={1.5} aria-hidden="true" />} active={pathname.startsWith(paths.admins)} />
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
          <LogOut size={18} strokeWidth={1.5} aria-hidden="true" />
        </Box>
      </Stack>
    </>
  )
}

function Sidebar() {
  return (
    <Box component="aside" sx={{ width: SIDEBAR, flexShrink: 0, position: 'sticky', top: 0, height: '100dvh', bgcolor: brand.navy, color: brand.offWhite, display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ px: 2.5, pt: 2.5, pb: 1, ...navyLogo }}>
        <Logo product={copy.product} />
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

function TopBar() {
  return (
    <Stack component="header" direction="row" sx={{ alignItems: 'center', height: TOP, px: 5, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', position: 'sticky', top: 0, zIndex: 5 }}>
      <Crumbs lastOnly={false} />
    </Stack>
  )
}

// Below 900 px: a navy bar with the menu button and brand mark, the current crumb under it, and the
// sidebar's navigation in a temporary drawer.
function PhoneBar() {
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
            <Menu size={22} strokeWidth={1.5} aria-hidden="true" />
          </IconButton>
          <Link component={RouterLink} to={paths.home} aria-label={copy.homeLink} sx={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, px: 0.5, borderRadius: `${radius.control}px`, ...navyLogo, '&:focus-visible': { outline: `2px solid ${brand.amber}` } }}>
            <Logo product={copy.product} height={26} />
          </Link>
        </Stack>
        <Stack direction="row" sx={{ alignItems: 'center', height: PHONE_CRUMBS, px: { xs: 2, sm: 3 }, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
          <Crumbs lastOnly />
        </Stack>
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
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', pl: 2.5, pr: 1, height: TOP, flexShrink: 0, ...navyLogo }}>
          <Logo product={copy.product} height={26} />
          <IconButton aria-label={copy.closeMenu} onClick={close} sx={{ width: 44, height: 44, ...onNavy }}>
            <X size={20} strokeWidth={1.5} aria-hidden="true" />
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
  const theme = useTheme()
  // noSsr reads the query on the first render, so a phone never flashes the desktop sidebar.
  const phone = useMediaQuery(theme.breakpoints.down('md'), { noSsr: true })
  const inModule = modules.some((m) => pathname.startsWith(m.basePath))
  return (
    <Box sx={{ display: 'flex', minHeight: '100dvh', bgcolor: 'background.default', '--shell-top': `${phone ? TOP + PHONE_CRUMBS : TOP}px` }}>
      <Link href="#content" sx={{ position: 'absolute', left: 8, top: -48, zIndex: 50, bgcolor: 'background.paper', px: 2, py: 1, '&:focus': { top: 8 } }}>{copy.skip}</Link>
      {!phone && <Sidebar />}
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {phone ? <PhoneBar /> : <TopBar />}
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
