import { Box, Button, Divider, ListItemText, Menu, MenuItem, Typography } from '@mui/material'
import { useId, useState } from 'react'
import { Link } from 'react-router'
import { CHANGE_PASSWORD_PATH } from '../app/shellPaths'
import { useSession } from '../session/AuthProvider'

/** Role names read as words: `super_admin` becomes "super admin". */
export function roleLabel(role: string): string {
  return role.replace(/_/g, ' ')
}

/**
 * Who is signed in (name, email, roles), a way to change the password and a way to sign out. An
 * admin who must still choose a password sees only the sign-out: the rest is out of reach until then.
 */
export function AccountMenu() {
  const session = useSession()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  const id = useId()
  const admin = session.admin
  if (admin === null) return null
  const forced = session.status === 'passwordChangeRequired'

  async function signOut() {
    setSigningOut(true)
    setAnchor(null)
    // Ends this tab at once and tells every other tab; the guards then show the login screen.
    await session.logout()
  }

  return (
    <>
      <Button
        color="inherit"
        id={`${id}-button`}
        aria-controls={anchor ? `${id}-menu` : undefined}
        aria-haspopup="menu"
        aria-expanded={anchor ? 'true' : undefined}
        onClick={(event) => setAnchor(event.currentTarget)}
        sx={{ textTransform: 'none', maxWidth: 260 }}
      >
        <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {admin.display_name}
        </Box>
      </Button>
      <Menu
        id={`${id}-menu`}
        anchorEl={anchor}
        open={anchor !== null}
        onClose={() => setAnchor(null)}
        slotProps={{ list: { 'aria-labelledby': `${id}-button` } }}
      >
        <Box sx={{ px: 2, py: 1, maxWidth: 320 }}>
          <Typography component="p" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
            {admin.display_name}
          </Typography>
          <Typography component="p" variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
            {admin.email}
          </Typography>
          {session.roles.length > 0 ? (
            <Typography component="p" variant="body2" color="text.secondary">
              Roles: {session.roles.map(roleLabel).join(', ')}
            </Typography>
          ) : null}
        </Box>
        <Divider />
        {forced
          ? null
          : [
              <MenuItem key="password" component={Link} to={CHANGE_PASSWORD_PATH} onClick={() => setAnchor(null)}>
                <ListItemText>Change password</ListItemText>
              </MenuItem>,
            ]}
        <MenuItem onClick={() => void signOut()} disabled={signingOut}>
          <ListItemText>Sign out</ListItemText>
        </MenuItem>
      </Menu>
    </>
  )
}
