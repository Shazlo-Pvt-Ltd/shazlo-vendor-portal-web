import { parseRegistry, type ModuleManifest, type RegistryEntry, type RegistryMode } from '@shazlo/shell-protocol'
import type { LucideIcon } from 'lucide-react'
import { iconFor } from './icons'

declare const __SHELL_REGISTRY__: unknown
declare const __SHELL_REGISTRY_MODE__: RegistryMode

// ADR 0011: the shell knows its modules only through two things.
// - The registry (registry/<environment>.json, built in and checked again here): where each module
//   lives, which roles may open it and which backend its token is for. This decides trust.
// - Each module's manifest (served by the module): its title, icon, the page it opens on (`home`)
//   and its pages (`links`, with `also` prefixes such as "/review" for a queue). This decides looks.
// A module whose manifest cannot be read still opens, under its registry title, with no sub-links.
export const registry: readonly RegistryEntry[] = parseRegistry(__SHELL_REGISTRY__, __SHELL_REGISTRY_MODE__)

// One of a module's pages, as a module path ("/queue"). `also` lists more module-path prefixes that
// belong to it, so the link stays current on the pages reached from it ("/review" for the queue).
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
  // The page the module opens on: where its sidebar row and the bare base path go.
  home: ModuleLink
  links: ModuleLink[]
}

const link = (l: { label: string; path: string; icon: Parameters<typeof iconFor>[0]; also?: string[] }): ModuleLink => ({ label: l.label, path: l.path, icon: iconFor(l.icon), also: l.also ?? [] })

export function resolveModule(entry: RegistryEntry, manifest?: ModuleManifest | null): ResolvedModule {
  const base = { entry, id: entry.id, basePath: entry.basePath, url: entry.url, origin: entry.origin, roles: entry.roles, audience: entry.audience }
  if (!manifest) return { ...base, title: entry.fallbackTitle, icon: iconFor('box'), home: { label: entry.fallbackTitle, path: '/', icon: iconFor('box'), also: [] }, links: [] }
  return { ...base, title: manifest.title, icon: iconFor(manifest.icon), home: link(manifest.home), links: manifest.links.map(link) }
}

// `path` is `prefix` or a page under it: "/catalogue/s_1" is under "/catalogue", "/catalogueX" is not.
const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`)
// A manifest path may carry a query ("/publishing?status=failed"); only its path part decides.
const pathOf = (p: string) => p.split(/[?#]/, 1)[0] ?? ''

export const moduleFor = (pathname: string): RegistryEntry | undefined => registry.find((m) => under(pathname, m.basePath))

// The module path of a shell URL ("/catalogue/queue" → "/queue", "/catalogue" → ""), or null outside the module.
export function modulePath(module: Pick<ResolvedModule, 'basePath'>, pathname: string): string | null {
  return under(pathname, module.basePath) ? pathname.slice(module.basePath.length) : null
}

// The module page a shell URL shows: the bare base path ("/catalogue", "/catalogue/") opens the
// module's home, any other URL its own module path. Null outside the module. The module host loads
// this page, and the sidebar and top bar mark it, so they always agree.
export function moduleTarget(module: Pick<ResolvedModule, 'basePath' | 'home'>, pathname: string): string | null {
  const path = modulePath(module, pathname)
  if (path === null) return null
  return path === '' || path === '/' ? module.home.path : path
}

// The module's own first page: its bare base path or its home page.
export function isModuleHome(module: Pick<ResolvedModule, 'basePath' | 'home'>, pathname: string): boolean {
  const target = moduleTarget(module, pathname)
  return target !== null && under(target, pathOf(module.home.path))
}

// Whether a module path ("/review/product/p1") is on one of a link's pages: its own path, or one it
// lists in `also`. A link to the module's root ("/") is only the root, not every page under it.
function onLinkPage(path: string, l: Pick<ModuleLink, 'path' | 'also'>): boolean {
  return [l.path, ...l.also].some((p) => {
    const prefix = pathOf(p)
    return prefix === '/' || prefix === '' ? path === '' || path === '/' : under(path, prefix)
  })
}

// Whether `pathname` (the shell's) is on one of a link's pages.
export function isOnLink(pathname: string, module: Pick<ResolvedModule, 'basePath'>, l: Pick<ModuleLink, 'path' | 'also'>): boolean {
  const path = modulePath(module, pathname)
  return path !== null && onLinkPage(path, l)
}

// Which of the module's pages the URL shows, for the sidebar and the top bar alike. The bare base
// path shows the home page, so it marks the home's link if the module lists its home as a page;
// otherwise nothing is current there and the module's own row is (see isModuleHome).
export function currentLink(module: Pick<ResolvedModule, 'basePath' | 'home' | 'links'>, pathname: string): ModuleLink | undefined {
  const target = moduleTarget(module, pathname)
  if (target === null) return undefined
  return module.links.find((l) => onLinkPage(pathOf(target), l))
}
