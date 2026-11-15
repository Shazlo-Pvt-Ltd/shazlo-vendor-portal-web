import { List, ListItemButton, ListItemText } from '@mui/material'
import { NavLink } from 'react-router'
import { useSession } from '../../session/AuthProvider'
import { navFor } from './nav'

/** The section links. The current one is marked with `aria-current="page"` by the router. */
export function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const { role } = useSession()
  return (
    <List component="ul" disablePadding sx={{ py: 1 }}>
      {navFor(role).map((item) => (
        <li key={item.to}>
          <ListItemButton component={NavLink} to={item.to} end={item.end} onClick={onNavigate} sx={{ '&.active': { fontWeight: 700 } }}>
            <ListItemText primary={item.label} slotProps={{ primary: { sx: { fontWeight: 'inherit' } } }} />
          </ListItemButton>
        </li>
      ))}
    </List>
  )
}
