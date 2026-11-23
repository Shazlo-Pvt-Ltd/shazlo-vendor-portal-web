import { RegistryError, environmentOf, modulesFor, type ModuleEntry } from './registry'

export type RegistryResult = { ok: true; entries: readonly ModuleEntry[] } | { ok: false; problems: string[] }

/**
 * The registry of this build, checked when the shell starts (the build checked it too). A bad one
 * gives the problems for the misconfiguration screen, never a half-working shell.
 */
export function loadRegistry(): RegistryResult {
  try {
    const environment = environmentOf({ dev: import.meta.env.DEV, target: import.meta.env.VITE_DEPLOY_ENV })
    return { ok: true, entries: modulesFor(environment) }
  } catch (error) {
    if (error instanceof RegistryError) return { ok: false, problems: error.problems }
    throw error
  }
}
