import { List, ListItemButton, ListItemText, ListSubheader } from '@mui/material'
import { NavLink } from 'react-router'
import { useAvailableModules } from '../modules/ModuleRegistryProvider'
import { SUPER_ADMIN } from '../modules/registry'
import { useSession } from '../session/AuthProvider'

function Item({ to, label, end, onNavigate }: { to: string; label: string; end?: boolean; onNavigate?: () => void }) {
  return (
    <li>
      <ListItemButton component={NavLink} to={to} end={end} onClick={onNavigate} sx={{ '&.active': { fontWeight: 700 } }}>
        <ListItemText primary={label} slotProps={{ primary: { sx: { fontWeight: 'inherit' } } }} />
      </ListItemButton>
    </li>
  )
}

/**
 * The links: Home, one per module the admin may open, and "Admins" for a super admin only. A module
 * the admin may not open is not listed at all. The current one is marked `aria-current="page"`.
 */
export function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const modules = useAvailableModules()
  const { roles } = useSession()
  return (
    <List component="ul" disablePadding sx={{ py: 1 }} subheader={<ListSubheader component="li">Shazlo-One</ListSubheader>}>
      <Item to="/" label="Home" end onNavigate={onNavigate} />
      {modules.map((entry) => (
        <Item key={entry.id} to={`/m/${entry.id}`} label={entry.title} onNavigate={onNavigate} />
      ))}
      {roles.includes(SUPER_ADMIN) ? <Item to="/admins" label="Admins" onNavigate={onNavigate} /> : null}
    </List>
  )
}
