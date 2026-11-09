import { Avatar, Box, Breadcrumbs, Divider, Link, List, ListItemButton, ListItemIcon, ListItemText, Stack, Typography } from '@mui/material'
import { brand, fontFamily, Logo, radius } from '@shazlo/ui'
import { Home, LogOut, Users } from 'lucide-react'
import { Suspense, type ReactNode } from 'react'
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
// Shazlo One's chrome is navy (design language: "Navy: Shazlo-One shell, sign-in and bulk actions").
const NAVY_TEXT = 'rgba(255, 252, 227, 0.78)'
const NAVY_LINE = 'rgba(255, 252, 227, 0.14)'

function NavLink({ to, label, icon, active, count, countLabel, inset = false }: { to: string; label: string; icon?: ReactNode; active: boolean; count?: number; countLabel?: string; inset?: boolean }) {
  return (
    <li>
      <ListItemButton
        component={RouterLink}
        to={to}
        aria-current={active ? 'page' : undefined}
        sx={{
          borderRadius: `${radius.control}px`,
          minHeight: inset ? 34 : 40,
          pl: inset ? 6 : 1.5,
          pr: 1.5,
          mb: 0.25,
          color: active ? brand.navy : NAVY_TEXT,
          bgcolor: active ? brand.amber : 'transparent',
          '@media (hover: hover)': { '&:hover': { bgcolor: active ? brand.amber : 'rgba(255, 252, 227, 0.08)' } },
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

function Sidebar() {
  const { admin, can, signOut } = useSession()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const allowed = modules.filter((m) => can(m.roles))
  const summary = useVendorSummary(allowed.length > 0).data
  const initials = admin?.display_name.split(' ').map((p) => p[0]).join('').slice(0, 2) ?? ''
  const role = admin?.roles.map((r) => copy.roles[r] ?? r).join(', ')
  return (
    <Box component="aside" sx={{ width: SIDEBAR, flexShrink: 0, position: 'sticky', top: 0, height: '100dvh', bgcolor: brand.navy, color: brand.offWhite, display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ px: 2.5, pt: 2.5, pb: 1, '& img': { filter: 'brightness(0) invert(0.97) sepia(0.15)' }, '& span': { color: brand.amber, borderColor: 'rgba(250, 182, 42, 0.6)' } }}>
        <Logo product={copy.product} />
      </Box>
      <Box component="nav" aria-label={copy.navLabel} sx={{ flex: 1, overflowY: 'auto', px: 1.5 }}>
        <List disablePadding sx={{ pt: 1.5 }}>
          <NavLink to={paths.home} label={copy.home} icon={<Home size={18} strokeWidth={1.5} aria-hidden="true" />} active={pathname === paths.home} />
        </List>
        {allowed.length > 0 && <SectionLabel>{copy.modules}</SectionLabel>}
        <List disablePadding>
          {allowed.map((m) => {
            const Icon = m.icon
            const inModule = pathname.startsWith(m.basePath)
            return (
              <Box component="li" key={m.id} sx={{ listStyle: 'none' }}>
                <List disablePadding>
                  <NavLink to={m.basePath + m.links[0]!.path} label={m.title} icon={<Icon size={18} strokeWidth={1.5} aria-hidden="true" />} active={false} count={summary?.queue.all} countLabel={copy.waiting(summary?.queue.all ?? 0)} />
                  {m.links.map((l) => (
                    <NavLink key={l.path} inset to={m.basePath + l.path} label={l.label} active={inModule && pathname.startsWith(m.basePath + l.path)} />
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
              <NavLink to={paths.admins} label={copy.admins} icon={<Users size={18} strokeWidth={1.5} aria-hidden="true" />} active={pathname.startsWith(paths.admins)} />
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
        <Box component="button" type="button" aria-label={copy.signOut} onClick={() => void signOut().then(() => navigate(paths.signIn, { replace: true }))} sx={{ all: 'unset', cursor: 'pointer', display: 'grid', placeItems: 'center', width: 36, height: 36, borderRadius: '50%', color: NAVY_TEXT, '&:focus-visible': { outline: `2px solid ${brand.amber}` }, '@media (hover: hover)': { '&:hover': { bgcolor: 'rgba(255, 252, 227, 0.08)' } } }}>
          <LogOut size={18} strokeWidth={1.5} aria-hidden="true" />
        </Box>
      </Stack>
    </Box>
  )
}

function TopBar() {
  const matches = useMatches()
  const pageCrumb = usePageCrumb()
  const crumbs = matches.flatMap((m) => (m.handle as RouteHandle | undefined)?.crumbs ?? [])
  const trail = pageCrumb ? [...crumbs, { label: pageCrumb }] : crumbs
  return (
    <Stack component="header" direction="row" sx={{ alignItems: 'center', height: 56, px: { xs: 2, md: 5 }, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', position: 'sticky', top: 0, zIndex: 5 }}>
      <Breadcrumbs aria-label="Breadcrumb" separator="›" sx={{ minWidth: 0 }}>
        {trail.map((c, i) =>
          i < trail.length - 1 && 'to' in c && c.to ? (
            <Link key={c.label} component={RouterLink} to={c.to} underline="hover" color="text.secondary" variant="body2">{c.label}</Link>
          ) : (
            <Typography key={c.label} variant="body2" noWrap aria-current={i === trail.length - 1 ? 'page' : undefined} sx={{ fontFamily: fontFamily.display }}>{c.label}</Typography>
          ),
        )}
      </Breadcrumbs>
    </Stack>
  )
}

// Signed-in layout. Module pages fill the content area edge to edge; shell pages get the usual gutter.
export function ShellLayout() {
  const { pathname } = useLocation()
  const inModule = modules.some((m) => pathname.startsWith(m.basePath))
  return (
    <Box sx={{ display: 'flex', minHeight: '100dvh', bgcolor: 'background.default' }}>
      <Link href="#content" sx={{ position: 'absolute', left: 8, top: -48, zIndex: 50, bgcolor: 'background.paper', px: 2, py: 1, '&:focus': { top: 8 } }}>{copy.skip}</Link>
      <Sidebar />
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <TopBar />
        <Box component="main" id="content" tabIndex={-1} sx={{ flex: 1, outline: 'none', ...(inModule ? {} : { px: { xs: 2, md: 5 }, pt: 4, pb: 8 }) }}>
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
