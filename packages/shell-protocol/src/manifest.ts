import { z } from 'zod'
import { modulePath } from './paths'

// ADR 0011: what a module says about itself, served by the module at a fixed path of its own
// origin. The shell reads it to draw the module's row and pages in the sidebar and top bar, so a
// module can add or rename a page without a shell release. Nothing here decides trust: the origin,
// the roles and the token audience come from the shell's registry (registry.ts).

export const MANIFEST_PATH = '/shazlo-module.json'

export function manifestUrl(moduleUrl: string): string {
  return new URL(MANIFEST_PATH, moduleUrl).toString()
}

// The icons a module may name (lucide names). The shell maps each to a component; a name it does not
// know (a newer module) falls back to "box" rather than failing the manifest.
export const MODULE_ICONS = [
  'box',
  'store',
  'layout-dashboard',
  'inbox',
  'building-2',
  'send',
  'users',
  'megaphone',
  'chart-bar',
  'file-text',
  'shopping-bag',
  'tag',
  'bell',
  'settings',
  'clipboard-check',
] as const
export type ModuleIcon = (typeof MODULE_ICONS)[number]

// Also used by the summary (summary.ts) for its cards.
export const moduleIcon = z.enum(MODULE_ICONS).catch('box')
const icon = moduleIcon
const label = z.string().trim().min(1).max(40)

const page = z.object({ label, path: modulePath, icon })

export const moduleManifestSchema = z.object({
  v: z.literal(1),
  id: z.string().min(1).max(40),
  title: label,
  icon,
  home: page,
  // Further module paths that belong to a link ("/review" under the queue).
  links: z.array(page.extend({ also: z.array(modulePath).max(8).optional() })).max(8),
})

export type ModuleManifest = z.infer<typeof moduleManifestSchema>

// Null when the manifest is not valid, or is another module's: the shell then shows the module
// under its registry title with no sub-links.
export function parseManifest(raw: unknown, expectedId: string): ModuleManifest | null {
  const parsed = moduleManifestSchema.safeParse(raw)
  if (!parsed.success || parsed.data.id !== expectedId) return null
  return parsed.data
}
