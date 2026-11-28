import { AppBar, Box, Drawer, IconButton, Toolbar, Typography, useMediaQuery, useTheme } from '@mui/material'
import { useEffect, useId, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router'
import { AccountMenu } from './AccountMenu'
import { NavList } from './NavList'

export const DRAWER_WIDTH = 240
export const MAIN_ID = 'main-content'

/**
 * Which page an address is, for moving focus: every path of one module (`/m/<id>/...`) is that
 * module's one page, so navigation inside a module never pulls focus out of its frame.
 */
export function pageOf(pathname: string): string {
  const module = /^\/m\/([^/]+)/.exec(pathname)
  return module ? `/m/${module[1]}` : pathname
}

/**
 * The frame of every signed-in screen. A skip link first; an app bar with Shazlo-One and the
 * account menu; the navigation (always visible from `md` up, in a drawer behind a menu button on a
 * phone); and the page in the one `<main>`. After each move to another page (another module counts,
 * a path inside the same module does not) the page heading takes focus, so a screen reader
 * announces where the admin went.
 */
export function ShellLayout() {
  const theme = useTheme()
  const wide = useMediaQuery(theme.breakpoints.up('md'))
  const location = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const navId = useId()
  const main = useRef<HTMLElement>(null)
  const lastPage = useRef(pageOf(location.pathname))

  // The drawer is only for phones: close it when the screen grows past that.
  useEffect(() => {
    if (wide) setDrawerOpen(false)
  }, [wide])

  // Not on the first page (that would hide the skip link behind a focused heading), only after
  // the admin moves to another one. A move inside one module is not a new page.
  useEffect(() => {
    const page = pageOf(location.pathname)
    if (lastPage.current === page) return
    lastPage.current = page
    main.current?.querySelector<HTMLElement>('h1')?.focus()
  }, [location.pathname])

  return (
    <>
      <Box
        component="a"
        href={`#${MAIN_ID}`}
        onClick={(event) => {
          // A hash link would change the address the router owns; move focus instead.
          event.preventDefault()
          main.current?.focus()
        }}
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

      <AppBar position="sticky" color="primary" component="header" elevation={0}>
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
            Shazlo-One
          </Typography>
          <AccountMenu />
        </Toolbar>
      </AppBar>

      <Box sx={{ display: 'flex', alignItems: 'flex-start' }}>
        {wide ? (
          <Box
            component="nav"
            aria-label="Modules"
            sx={{ width: DRAWER_WIDTH, flexShrink: 0, borderRight: 1, borderColor: 'divider', minHeight: '100vh' }}
          >
            <NavList />
          </Box>
        ) : (
          <Drawer
            id={navId}
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            slotProps={{ paper: { sx: { width: DRAWER_WIDTH, maxWidth: '85vw' } } }}
          >
            <Box component="nav" aria-label="Modules">
              <NavList onNavigate={() => setDrawerOpen(false)} />
            </Box>
          </Drawer>
        )}

        <Box
          component="main"
          id={MAIN_ID}
          ref={main}
          tabIndex={-1}
          sx={{ flexGrow: 1, minWidth: 0, p: { xs: 2, md: 3 }, outline: 'none' }}
        >
          <Outlet />
        </Box>
      </Box>
    </>
  )
}
