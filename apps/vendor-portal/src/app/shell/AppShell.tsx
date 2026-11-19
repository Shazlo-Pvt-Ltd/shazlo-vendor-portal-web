import { AppBar, Box, Button, Drawer, IconButton, Menu, MenuItem, Toolbar, Typography, useMediaQuery, useTheme } from '@mui/material'
import { Suspense, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router'
import { useSession } from '../../session/AuthProvider'
import { FocusRequestContext } from '../../ui/PageHeader'
import { PageSkeleton } from '../../ui/LoadingState'
import { NavList } from './NavList'
import { SectionBoundary } from './SectionBoundary'
import { StatusBanner } from './StatusBanner'

export const DRAWER_WIDTH = 240
export const MAIN_ID = 'main-content'

/** The signed-in user's menu: who they are, and Sign out. */
export function AccountMenu() {
  const { user, vendor, role, logout } = useSession()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  async function signOut() {
    setOpen(false)
    await logout()
    void navigate('/login', { replace: true })
  }

  return (
    <>
      <Button
        ref={anchor}
        color="inherit"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(true)}
      >
        Account
      </Button>
      <Menu id={menuId} open={open} anchorEl={anchor.current} onClose={() => setOpen(false)}>
        <Box sx={{ px: 2, py: 1, maxWidth: 280 }}>
          <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
            {user?.email}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {vendor?.name} · {role === 'owner' ? 'Owner' : 'Staff'}
          </Typography>
        </Box>
        <MenuItem onClick={() => void signOut()}>Sign out</MenuItem>
      </Menu>
    </>
  )
}

/**
 * The frame of every signed-in screen. A skip link first; an app bar with the vendor's name and the
 * account menu; the section navigation (always visible from `md` up, in a drawer behind a menu button
 * on a phone); the vendor-status banner; and the page itself in `<main>`, loaded lazily and guarded by
 * a boundary so one failing page leaves the frame standing.
 */
export function AppShell() {
  const theme = useTheme()
  const wide = useMediaQuery(theme.breakpoints.up('md'))
  const { vendor } = useSession()
  const location = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const navId = useId()

  // After the first page, each navigation lets one page heading take focus. The latest location is
  // written during render, not in an effect: a page that is already loaded mounts (and runs its
  // effects) in the same commit as the navigation, before this component's own effects would.
  const currentKey = useRef(location.pathname)
  currentKey.current = location.pathname
  const focusedKey = useRef(location.pathname)
  const focusRequest = useMemo(
    () => () => {
      if (currentKey.current === focusedKey.current) return false
      focusedKey.current = currentKey.current
      return true
    },
    [],
  )

  // The drawer is only for phones: close it when the screen grows past that.
  useEffect(() => {
    if (wide) setDrawerOpen(false)
  }, [wide])

  return (
    <FocusRequestContext.Provider value={focusRequest}>
      <Box
        component="a"
        href={`#${MAIN_ID}`}
        sx={{
          position: 'absolute',
          left: 8,
          top: -64,
          zIndex: (t) => t.zIndex.tooltip + 1,
          bgcolor: 'background.paper',
          color: 'text.primary',
          px: 2,
          py: 1,
          borderRadius: 1,
          '&:focus': { top: 8 },
        }}
      >
        Skip to main content
      </Box>

      <AppBar position="sticky" color="primary" component="header">
        <Toolbar sx={{ gap: 1 }}>
          {wide ? null : (
            <IconButton
              color="inherit"
              edge="start"
              aria-label="Open the menu"
              aria-expanded={drawerOpen}
              aria-controls={navId}
              onClick={() => setDrawerOpen(true)}
            >
              <span aria-hidden="true">☰</span>
            </IconButton>
          )}
          <Typography component="span" variant="h6" noWrap sx={{ flexGrow: 1, minWidth: 0 }}>
            {vendor?.name ?? 'Shazlo Vendor Portal'}
          </Typography>
          <AccountMenu />
        </Toolbar>
      </AppBar>
      <StatusBanner />

      <Box sx={{ display: 'flex', alignItems: 'flex-start' }}>
        {wide ? (
          <Box component="nav" aria-label="Sections" sx={{ width: DRAWER_WIDTH, flexShrink: 0, borderRight: 1, borderColor: 'divider', minHeight: '100vh' }}>
            <NavList />
          </Box>
        ) : (
          <Drawer
            id={navId}
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            slotProps={{ paper: { sx: { width: DRAWER_WIDTH, maxWidth: '85vw' } } }}
          >
            <Box component="nav" aria-label="Sections">
              <NavList onNavigate={() => setDrawerOpen(false)} />
            </Box>
          </Drawer>
        )}

        <Box component="main" id={MAIN_ID} tabIndex={-1} sx={{ flexGrow: 1, minWidth: 0, p: { xs: 2, md: 3 }, outline: 'none' }}>
          <SectionBoundary resetKey={location.pathname}>
            <Suspense fallback={<PageSkeleton />}>
              <Outlet />
            </Suspense>
          </SectionBoundary>
        </Box>
      </Box>
    </FocusRequestContext.Provider>
  )
}
