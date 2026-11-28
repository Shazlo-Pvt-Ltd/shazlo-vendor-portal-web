import { Box, Card, CardActionArea, CardContent, Typography } from '@mui/material'
import { Link } from 'react-router'
import { usePageTitle } from '../hooks/usePageTitle'
import { useAvailableModules, useRegisteredModules } from '../modules/ModuleRegistryProvider'
import { useSession } from '../session/AuthProvider'

/** The home page: a card for each module the admin may open, or an explanation when there is none. */
export function HomePage() {
  usePageTitle('Home')
  const { admin } = useSession()
  const available = useAvailableModules()
  const registered = useRegisteredModules()
  return (
    <Box>
      <Typography component="h1" variant="h4" gutterBottom tabIndex={-1}>
        Shazlo-One
      </Typography>
      <Typography sx={{ mb: 3 }}>Welcome{admin ? `, ${admin.display_name}` : ''}. Choose a module to open.</Typography>
      {available.length === 0 ? (
        <Box role="status">
          <Typography component="h2" variant="h6" gutterBottom>
            There is nothing for you to open yet
          </Typography>
          <Typography>
            {registered.length === 0 ? 'No modules are set up yet.' : 'Your roles do not open any module.'} Ask a super admin
            if you think you should have access.
          </Typography>
        </Box>
      ) : (
        <Box
          component="ul"
          aria-label="Modules"
          sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', listStyle: 'none', m: 0, p: 0 }}
        >
          {available.map((entry) => (
            <li key={entry.id}>
              <Card variant="outlined" sx={{ height: '100%' }}>
                <CardActionArea component={Link} to={`/m/${entry.id}`} sx={{ height: '100%' }}>
                  <CardContent>
                    <Typography component="h2" variant="h6" gutterBottom>
                      {entry.title}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {entry.description}
                    </Typography>
                  </CardContent>
                </CardActionArea>
              </Card>
            </li>
          ))}
        </Box>
      )}
    </Box>
  )
}
