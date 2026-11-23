import { Alert, Box, Typography } from '@mui/material'
import { useParams } from 'react-router'
import { NoAccess } from '../components/NoAccess'
import { NotFound } from '../components/NotFound'
import { usePageTitle } from '../hooks/usePageTitle'
import { useRegisteredModules } from '../modules/ModuleRegistryProvider'
import { canOpen, type ModuleEntry } from '../modules/registry'
import { useSession } from '../session/AuthProvider'

function OpenModule({ entry }: { entry: ModuleEntry }) {
  usePageTitle(entry.title)
  return (
    <Box>
      <Typography component="h1" variant="h4" gutterBottom tabIndex={-1}>
        {entry.title}
      </Typography>
      {/* The iframe host (handshake, sandbox, tokens) is the next issue; this page is where it mounts. */}
      <Alert severity="info">{entry.title} will open here once the module host is built.</Alert>
    </Box>
  )
}

/**
 * `/m/:moduleId/*`: a registered module the admin may open. An unknown id is "not found" and a
 * module the roles do not allow is the 403 page; neither renders a frame. The rest of the path
 * belongs to the module.
 */
export function ModulePage() {
  const { moduleId } = useParams()
  const modules = useRegisteredModules()
  const { roles } = useSession()
  const entry = modules.find((candidate) => candidate.id === moduleId)
  if (entry === undefined) return <NotFound embedded />
  if (!canOpen(entry, roles)) return <NoAccess what="module" />
  return <OpenModule entry={entry} />
}
