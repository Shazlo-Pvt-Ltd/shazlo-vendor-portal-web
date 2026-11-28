import { Button } from '@mui/material'
import { EmptyState } from '@shazlo/ui'
import type { ReactNode } from 'react'
import { Link as RouterLink, useRouteError } from 'react-router'
import { paths } from '../app/paths'
import type { RegistryEntry } from '@shazlo/shell-protocol'
import { useModuleManifest } from '../api/modules'
import { resolveModule } from '../app/registry'
import { shellCopy } from '../copy/shell'
import { useSession } from '../session/useSession'
import { ModuleHost } from '../shell/ModuleHost'

export function NotFound() {
  return <EmptyState illustration="box" title="We could not find that page" body="The link may be old. Everything in Shazlo One is in the menu." action={<Button variant="contained" component={RouterLink} to={paths.home}>Back to Home</Button>} />
}

export function RouteError() {
  const error = useRouteError()
  if (import.meta.env.DEV) console.error(error)
  return <EmptyState illustration="sheet" title="This page did not load" body="Something went wrong on our side. Reload the page; nothing you saved is lost." action={<Button variant="contained" onClick={() => window.location.reload()}>Reload page</Button>} />
}

// Opens a module only for the roles its registry entry allows. The module is framed at once; its
// manifest (title, pages) fills in when it arrives, and a missing one leaves the registry title.
export function ModuleRoute({ entry }: { entry: RegistryEntry }) {
  const { can } = useSession()
  const allowed = can(entry.roles)
  const module = resolveModule(entry, useModuleManifest(entry, allowed).data)
  if (!allowed) {
    return <EmptyState illustration="sheet" title={shellCopy.module.forbiddenTitle(module.title)} body={shellCopy.module.forbiddenBody} action={<Button variant="outlined" component={RouterLink} to={paths.home}>Back to Home</Button>} />
  }
  return <ModuleHost module={module} />
}

export function SuperAdminOnly({ children }: { children: ReactNode }) {
  const { admin } = useSession()
  if (!admin?.roles.includes('super_admin')) {
    return <EmptyState illustration="sheet" title="Only super admins can manage admins" body="Ask a super admin if you need someone added or their role changed." action={<Button variant="outlined" component={RouterLink} to={paths.home}>Back to Home</Button>} />
  }
  return <>{children}</>
}
