/**
 * The module registry (ADR 0001): which admin modules the shell may open, in each environment.
 * This is the one place a module is added: one entry, and the navigation, the routes and the
 * Content-Security-Policy `frame-src` all follow.
 *
 * This file has no imports and uses only syntax Node can run as it is, so the Vite config and the
 * Vercel prebuild script read it without loading the app.
 */

export type ModuleEnvironment = 'development' | 'preview' | 'production'

export const ENVIRONMENTS: readonly ModuleEnvironment[] = ['development', 'preview', 'production']

/** A module the shell can frame. Origins are exact; nothing is matched with wildcards or patterns. */
export interface ModuleEntry {
  /** Lower-case letters, digits and hyphens. It is the address, `/m/<id>`, so it never changes. */
  id: string
  /** The name in the navigation and on the home page. */
  title: string
  /** One line for the module's card on the home page. */
  description: string
  /** Where the module's page is loaded from. Its origin must be `origin`. */
  url: string
  /** The exact origin (`https://host[:port]`, no path): the only one the shell frames and trusts messages from. */
  origin: string
  /** An admin needs at least one of these roles. `super_admin` opens every module whatever this says. */
  roles: readonly string[]
  /** The audience of the token identity-api issues for this module (`POST /v1/auth/token`). */
  audience: string
  /** The shell-protocol versions the module speaks (ADR 0001). */
  supportedVersions: readonly number[]
}

export type ModuleRegistry = Readonly<Record<ModuleEnvironment, readonly ModuleEntry[]>>

/** The role that sees every module (and the only one that sees the admin management screens). */
export const SUPER_ADMIN = 'super_admin'

/**
 * The registry. The first real module, `vendor-admin`, is added in Phase 7:
 *
 *   {
 *     id: 'vendor-admin',
 *     title: 'Vendor admin',
 *     description: 'Review vendor applications, products and brand pages.',
 *     url: 'https://vendor-admin.shazlo.com/',
 *     origin: 'https://vendor-admin.shazlo.com',
 *     roles: ['vendor_reviewer'],
 *     audience: 'vendor-api',
 *     supportedVersions: [1],
 *   }
 */
export const MODULES: ModuleRegistry = {
  development: [
    // The reference module (apps/shazlo-one/dev-module): a tiny module for development and the shell's
    // tests. It exists only here, so it can never appear in a preview or production build.
    {
      id: 'reference',
      title: 'Reference module',
      description: 'A small module that speaks the shell protocol and calls vendor-api, for development.',
      url: 'http://localhost:5175/',
      origin: 'http://localhost:5175',
      roles: ['super_admin', 'vendor_reviewer'],
      audience: 'vendor-api',
      supportedVersions: [1],
    },
  ],
  preview: [],
  production: [],
}

const ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/
// Anything that only makes sense in a pattern: an origin containing one is not an exact origin.
const PATTERN_CHARACTERS = /[*?^$|()[\]{}\\]/

/** Why an origin is not acceptable, or undefined when it is. */
function originProblem(origin: unknown, environment: ModuleEnvironment): string | undefined {
  if (typeof origin !== 'string' || origin.trim() === '') return 'origin is missing.'
  if (PATTERN_CHARACTERS.test(origin)) return 'origin must be one exact origin, not a wildcard or a pattern.'
  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    return 'origin is not a valid URL.'
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return 'origin must start with https://.'
  if (parsed.protocol === 'http:' && environment !== 'development') {
    return `origin must use https outside development (this is the ${environment} registry).`
  }
  if (parsed.origin !== origin) {
    return 'origin must be only the scheme, host and port, in lower case, with no path, user name or trailing slash (for example https://vendor-admin.shazlo.com).'
  }
  return undefined
}

/**
 * Everything wrong with a registry for one environment, as sentences that say which module and
 * what to change. Empty when it is sound. It refuses a wildcard or pattern origin, a non-https
 * origin outside development, a `url` that is not on its `origin`, duplicate ids or origins, an
 * empty role list, and a few mistakes that would break a module's address or token.
 */
export function registryProblems(entries: readonly ModuleEntry[], environment: ModuleEnvironment): string[] {
  const problems: string[] = []
  const ids = new Set<string>()
  const origins = new Set<string>()
  entries.forEach((entry, index) => {
    const label = typeof entry.id === 'string' && entry.id !== '' ? `Module "${entry.id}"` : `Module number ${index + 1}`
    const problem = (text: string) => problems.push(`${label} (${environment}): ${text}`)

    if (typeof entry.id !== 'string' || !ID_PATTERN.test(entry.id)) {
      problem('id must be lower-case letters, digits and hyphens, starting with a letter, at most 32 characters.')
    } else if (ids.has(entry.id)) {
      problem('id is used by another module.')
    } else {
      ids.add(entry.id)
    }
    if (typeof entry.title !== 'string' || entry.title.trim() === '') problem('title is missing.')

    const bad = originProblem(entry.origin, environment)
    if (bad) {
      problem(bad)
    } else {
      if (origins.has(entry.origin)) problem('origin is used by another module.')
      origins.add(entry.origin)
      try {
        if (new URL(entry.url).origin !== entry.origin) problem('url is not on the module origin.')
      } catch {
        problem('url is not a valid URL.')
      }
    }

    if (!Array.isArray(entry.roles) || entry.roles.length === 0) {
      problem('roles is empty: say which roles may open the module.')
    } else if (entry.roles.some((role) => typeof role !== 'string' || role.trim() === '' || /[*\s]/.test(role))) {
      problem('roles must be role names, with no wildcard or space.')
    }
    if (typeof entry.audience !== 'string' || entry.audience.trim() === '') {
      problem('audience is missing.')
    } else if (entry.audience === 'identity-api') {
      problem('audience must be the module backend, never identity-api (identity-api tokens come from sign-in only).')
    }
    if (
      !Array.isArray(entry.supportedVersions) ||
      entry.supportedVersions.length === 0 ||
      entry.supportedVersions.some((version) => !Number.isInteger(version) || version < 1)
    ) {
      problem('supportedVersions must list at least one protocol version (a whole number, 1 or more).')
    }
  })
  return problems
}

/** A registry that failed {@link registryProblems}; `problems` says what to fix. */
export class RegistryError extends Error {
  readonly problems: string[]

  constructor(problems: string[]) {
    super(`The module registry is not valid:\n- ${problems.join('\n- ')}`)
    this.name = 'RegistryError'
    this.problems = problems
  }
}

/** The modules of one environment, checked. Throws {@link RegistryError} rather than return a bad registry. */
export function modulesFor(environment: ModuleEnvironment, registry: ModuleRegistry = MODULES): readonly ModuleEntry[] {
  const entries = registry[environment]
  const problems = registryProblems(entries, environment)
  if (problems.length > 0) throw new RegistryError(problems)
  return entries
}

/**
 * Which registry a build or a page uses. The dev server uses `development`; a deployed build uses
 * `preview` when `VITE_DEPLOY_ENV` (or Vercel's `VERCEL_ENV`) says so, and `production` otherwise.
 */
export function environmentOf(options: { dev: boolean; target?: string | undefined }): ModuleEnvironment {
  if (options.dev) return 'development'
  return options.target === 'preview' ? 'preview' : 'production'
}

/** The origins the shell may frame: exactly the registry's, once each. The CSP's `frame-src`. */
export function originsOf(entries: readonly ModuleEntry[]): string[] {
  return [...new Set(entries.map((entry) => entry.origin))]
}

/** Whether an admin holding `roles` may open a module: one of its roles, or `super_admin`. */
export function canOpen(entry: ModuleEntry, roles: readonly string[]): boolean {
  return roles.includes(SUPER_ADMIN) || entry.roles.some((role) => roles.includes(role))
}
