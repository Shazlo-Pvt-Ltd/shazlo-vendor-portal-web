import { AppBar as MuiAppBar, Box, Button, Menu, MenuItem, Toolbar, Typography } from '@mui/material'
import { useId, useRef, useState } from 'react'
import { Outlet, useNavigate } from 'react-router'
import { useSession } from '../session/AuthProvider'

/** The signed-in user's menu: who they are, and sign out. */
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
        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="body2">{user?.email}</Typography>
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
 * The frame of every signed-in screen: a top bar with the brand name, the account menu and a direct
 * Sign out button. The dashboard shell (a later issue) grows this into the full navigation.
 */
export function AuthenticatedLayout() {
  const { vendor, logout } = useSession()
  const navigate = useNavigate()
  return (
    <>
      <MuiAppBar position="static" color="primary" component="header">
        <Toolbar sx={{ gap: 1, flexWrap: 'wrap' }}>
          <Typography component="span" variant="h6" sx={{ flexGrow: 1, minWidth: 0 }}>
            {vendor?.name ?? 'Shazlo Vendor Portal'}
          </Typography>
          <AccountMenu />
          <Button
            color="inherit"
            onClick={async () => {
              await logout()
              void navigate('/login', { replace: true })
            }}
          >
            Sign out
          </Button>
        </Toolbar>
      </MuiAppBar>
      <Outlet />
    </>
  )
}
