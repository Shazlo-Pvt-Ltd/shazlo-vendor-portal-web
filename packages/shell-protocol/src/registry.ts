import { z } from 'zod'

// ADR 0011: the shell's trusted module registry, one file per environment, checked when the shell
// is built and again when it starts. It holds only what decides trust: where a module lives (its
// exact origin), which roles may open it, and which backend its token is for. What a module looks
// like (title, icon, pages) comes from the module's own manifest (manifest.ts).

export type RegistryMode = 'development' | 'preview' | 'production'

// Shell routes a module may not take over.
export const RESERVED_BASE_PATHS = ['/admins', '/sign-in', '/change-password', '/m'] as const

const entry = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/, 'ids are lowercase words joined by "-"'),
    // Shown when the manifest cannot be read.
    fallbackTitle: z.string().trim().min(1).max(40),
    basePath: z.string().regex(/^\/[a-z0-9-]+$/, 'base paths are one segment ("/vendors")'),
    url: z.string().min(1),
    roles: z.array(z.string().regex(/^[a-z][a-z0-9_]{1,63}$/)).min(1),
    // The audience the shell exchanges an identity-api token for (ADR 0009), e.g. "vendor-api".
    audience: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
    // The module backend's summary (summary.ts), read with the module's token. Optional.
    summaryUrl: z.string().min(1).optional(),
  })
  .strict()

export type RegistryInput = z.input<typeof entry>
export type RegistryEntry = z.output<typeof entry> & { origin: string }

// A host name the URL parser accepts can still hold characters such as ";" or ",", and the origin is
// written into the shell's Content-Security-Policy, where ";" starts a new directive. A module's host
// may hold only lower-case letters, digits, dots and hyphens (an IPv6 address is refused too).
export const PLAIN_HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/
// Plain http is for a module on this machine, in development only (the protocol channel refuses
// anything else, ADR 0001).
const LOOPBACK = new Set(['localhost', '127.0.0.1'])

function checkUrl(label: string, raw: string, mode: RegistryMode, problems: string[], { originOnly }: { originOnly: boolean }): URL | null {
  if (/[*?^$|()[\]{}\\]/.test(raw)) {
    problems.push(`${label} must be exact, without wildcards or patterns: ${raw}`)
    return null
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    problems.push(`${label} is not a URL: ${raw}`)
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') problems.push(`${label} must be http(s): ${raw}`)
  else if (url.protocol !== 'https:' && mode !== 'development') problems.push(`${label} must be https outside development: ${raw}`)
  else if (url.protocol !== 'https:' && !LOOPBACK.has(url.hostname)) problems.push(`${label} may use plain http only for localhost: ${raw}`)
  if (!PLAIN_HOST.test(url.hostname)) problems.push(`${label} must have a host of letters, digits, dots and hyphens only: ${raw}`)
  if (url.username || url.password) problems.push(`${label} must not carry credentials`)
  if (url.search || url.hash) problems.push(`${label} must not carry a query or a fragment: ${raw}`)
  // The module is its origin: the shell frames it there and reads its manifest from the root.
  if (originOnly && url.pathname !== '/') problems.push(`${label} must be the module's origin with no path (for example https://vendor-admin.shazlo.store/): ${raw}`)
  return url
}

// Throws one error that lists every problem, so a bad registry fails the build with all of them.
export function parseRegistry(raw: unknown, mode: RegistryMode): RegistryEntry[] {
  const parsed = z.array(entry).safeParse(raw)
  if (!parsed.success) {
    const lines = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'registry'}: ${issue.message}`)
    throw new Error(`The module registry is not valid:\n- ${lines.join('\n- ')}`)
  }
  const problems: string[] = []
  const entries: RegistryEntry[] = []
  const seen = { id: new Set<string>(), origin: new Set<string>(), basePath: new Set<string>() }
  for (const item of parsed.data) {
    const where = `module "${item.id}"`
    const url = checkUrl(`${where} url`, item.url, mode, problems, { originOnly: true })
    if (item.summaryUrl) checkUrl(`${where} summaryUrl`, item.summaryUrl, mode, problems, { originOnly: false })
    if ((RESERVED_BASE_PATHS as readonly string[]).includes(item.basePath)) problems.push(`${where} basePath ${item.basePath} belongs to the shell`)
    // identity-api is never a token-exchange target (ADR 0009).
    if (item.audience === 'identity-api') problems.push(`${where} audience cannot be identity-api`)
    const origin = url?.origin ?? ''
    for (const [key, value] of [['id', item.id], ['origin', origin], ['basePath', item.basePath]] as const) {
      if (!value) continue
      if (seen[key].has(value)) problems.push(`${where}: another module has the same ${key} (${value})`)
      seen[key].add(value)
    }
    entries.push({ ...item, origin })
  }
  if (problems.length) throw new Error(`The module registry is not valid:\n- ${problems.join('\n- ')}`)
  return entries
}

// What the shell's Content-Security-Policy must allow for these modules: the iframes, and the
// requests for their manifests (the module origins) and summaries (their backends).
export function registryCsp(entries: readonly RegistryEntry[]): { frameSrc: string[]; connectSrc: string[] } {
  const frameSrc = [...new Set(entries.map((e) => e.origin))]
  const summaries = entries.flatMap((e) => (e.summaryUrl ? [new URL(e.summaryUrl).origin] : []))
  return { frameSrc, connectSrc: [...new Set([...frameSrc, ...summaries])] }
}
