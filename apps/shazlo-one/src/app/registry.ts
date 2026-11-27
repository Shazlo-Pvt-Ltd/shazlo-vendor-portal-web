import { parseRegistry, type ModuleManifest, type RegistryEntry, type RegistryMode } from '@shazlo/shell-protocol'
import type { LucideIcon } from 'lucide-react'
import { iconFor } from './icons'

declare const __SHELL_REGISTRY__: unknown
declare const __SHELL_REGISTRY_MODE__: RegistryMode

// ADR 0011: the shell knows its modules only through two things.
// - The registry (registry/<environment>.json, built in and checked again here): where each module
//   lives, which roles may open it and which backend its token is for. This decides trust.
// - Each module's manifest (served by the module): its title, icon and pages. This decides looks.
// A module whose manifest cannot be read still opens, under its registry title, with no sub-links.
export const registry: readonly RegistryEntry[] = parseRegistry(__SHELL_REGISTRY__, __SHELL_REGISTRY_MODE__)

export type ModuleLink = { label: string; path: string; icon: LucideIcon; also: string[] }

export interface ResolvedModule {
  entry: RegistryEntry
  id: string
  title: string
  basePath: string
  url: string
  origin: string
  roles: string[]
  audience: string
  icon: LucideIcon
  // Where the module's row in the sidebar goes.
  home: ModuleLink
  links: ModuleLink[]
}

const link = (l: { label: string; path: string; icon: Parameters<typeof iconFor>[0]; also?: string[] }): ModuleLink => ({ label: l.label, path: l.path, icon: iconFor(l.icon), also: l.also ?? [] })

export function resolveModule(entry: RegistryEntry, manifest?: ModuleManifest | null): ResolvedModule {
  const base = { entry, id: entry.id, basePath: entry.basePath, url: entry.url, origin: entry.origin, roles: entry.roles, audience: entry.audience }
  if (!manifest) return { ...base, title: entry.fallbackTitle, icon: iconFor('box'), home: { label: entry.fallbackTitle, path: '/', icon: iconFor('box'), also: [] }, links: [] }
  return { ...base, title: manifest.title, icon: iconFor(manifest.icon), home: link(manifest.home), links: manifest.links.map(link) }
}

export const moduleFor = (pathname: string): RegistryEntry | undefined => registry.find((m) => pathname === m.basePath || pathname.startsWith(`${m.basePath}/`))

// Whether `pathname` (the shell's) is on one of a link's pages: its own path, or one it lists in `also`.
export function isOnLink(pathname: string, module: Pick<ResolvedModule, 'basePath'>, l: Pick<ModuleLink, 'path' | 'also'>): boolean {
  return [l.path, ...l.also].some((p) => {
    const path = p.split('?')[0] ?? ''
    // The module's root is only its own page, not every page under it.
    if (path === '/' || path === '') return pathname === module.basePath || pathname === `${module.basePath}/`
    const target = module.basePath + path
    return pathname === target || pathname.startsWith(`${target}/`)
  })
}
