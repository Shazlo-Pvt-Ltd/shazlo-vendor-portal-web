import { AppBar, Box, Toolbar, Typography } from '@mui/material'
import { Outlet } from 'react-router'
import { AccountMenu } from './AccountMenu'

/**
 * The frame around every signed-in screen: a top bar with the account menu. The module navigation
 * and the iframe host come with the shell-layout issue.
 */
export function ShellLayout() {
  return (
    <>
      <AppBar position="static" color="primary" elevation={0}>
        <Toolbar sx={{ gap: 2 }}>
          <Typography component="span" variant="h6" sx={{ flexGrow: 1 }}>
            Shazlo-One
          </Typography>
          <AccountMenu />
        </Toolbar>
      </AppBar>
      <Box component="div">
        <Outlet />
      </Box>
    </>
  )
}
