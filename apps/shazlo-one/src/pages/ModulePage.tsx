import { useParams } from 'react-router'
import { ModuleHost } from '../components/ModuleHost'
import { NoAccess } from '../components/NoAccess'
import { NotFound } from '../components/NotFound'
import { useRegisteredModules } from '../modules/ModuleRegistryProvider'
import { canOpen } from '../modules/registry'
import { useSession } from '../session/AuthProvider'

/**
 * `/m/:moduleId/*`: a registered module the admin may open, in its frame. An unknown id is "not
 * found" and a module the roles do not allow is the 403 page; neither renders a frame. The rest of the
 * path belongs to the module.
 */
export function ModulePage() {
  const { moduleId } = useParams()
  const modules = useRegisteredModules()
  const { roles } = useSession()
  const entry = modules.find((candidate) => candidate.id === moduleId)
  if (entry === undefined) return <NotFound embedded />
  if (!canOpen(entry, roles)) return <NoAccess what="module" />
  // Keyed by the module: moving from one module to another is a new host, so the first one's frame,
  // listener and tokens are gone before the second one starts.
  return <ModuleHost key={entry.id} entry={entry} />
}
