import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useSession } from '../session/AuthProvider'
import { canOpen, type ModuleEntry } from './registry'

const RegistryContext = createContext<readonly ModuleEntry[] | undefined>(undefined)

/** Gives the app the (already checked) registry of this build. Tests pass their own. */
export function ModuleRegistryProvider({ entries, children }: { entries: readonly ModuleEntry[]; children: ReactNode }) {
  return <RegistryContext.Provider value={entries}>{children}</RegistryContext.Provider>
}

/** Every registered module, whoever may open it. */
export function useRegisteredModules(): readonly ModuleEntry[] {
  const entries = useContext(RegistryContext)
  if (entries === undefined) {
    throw new Error('useRegisteredModules must be used inside ModuleRegistryProvider.')
  }
  return entries
}

/**
 * The modules the signed-in admin may open, from their current roles. The session reads `GET /v1/me`
 * again on every renewal, so a role added or removed shows up here without a new sign-in.
 */
export function useAvailableModules(): readonly ModuleEntry[] {
  const entries = useRegisteredModules()
  const { roles } = useSession()
  return useMemo(() => entries.filter((entry) => canOpen(entry, roles)), [entries, roles])
}
