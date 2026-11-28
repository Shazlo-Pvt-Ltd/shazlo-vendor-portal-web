// The shell's security headers, defined once. The Vite dev and preview servers (vite.config.ts), the
// production `vercel.json` (scripts/write-vercel-headers.mjs) and the tests all come from here, so they
// cannot drift apart. This file has no imports, so Node can load it as it is.

export type HeaderMode = 'production' | 'preview' | 'development'

/** The identity-api origin the committed `vercel.json` is written for. The Vercel build writes the real one. */
export const PLACEHOLDER_IDENTITY_ORIGIN = 'https://identity.example.com'

export interface HeaderOptions {
  mode: HeaderMode
  /** identity-api's origin; null when the shell calls its own origin (the dev proxy, or the browser mock). */
  identityOrigin: string | null
  /** The registered modules' origins (registryCsp().frameSrc): the only pages the shell may frame. */
  frameOrigins: readonly string[]
  /** What the shell reads from the modules: their manifests and summaries (registryCsp().connectSrc). */
  moduleConnectOrigins: readonly string[]
  /** The dev server's own origin, for its hot-reload socket. */
  devOrigin?: string
  /** The browser mock (VITE_MOCK_API) is in this build: it runs as a service worker from the shell's origin. */
  mockWorker?: boolean
}

/**
 * The Content-Security-Policy. Scripts only from the app itself, never inline and never `eval`;
 * network calls only to identity-api and to the registered modules' manifests and summaries (a
 * module talks to its own backend from inside its frame, under its own policy); frames only from the
 * registered module origins, and `'none'` when there are none; nothing may frame the shell, embed
 * objects, change `<base>` or post a form elsewhere.
 *
 * Styles allow `'unsafe-inline'` because MUI's runtime (emotion) writes `<style>` tags; that cannot run
 * script. Development relaxes `script-src` for the React refresh preamble, which Vite injects inline,
 * and allows the hot-reload socket. Preview and production use the strict policy.
 */
export function contentSecurityPolicy(options: HeaderOptions): string {
  const dev = options.mode === 'development'
  const devOrigin = options.devOrigin ?? 'http://localhost:5192'
  const own = options.identityOrigin === null ? ["'self'"] : [options.identityOrigin]
  const connect = [...new Set([...own, ...options.moduleConnectOrigins, ...(dev ? [devOrigin.replace(/^http/, 'ws')] : [])])]
  const directives: Array<[string, string[]]> = [
    ['default-src', ["'self'"]],
    ['script-src', dev ? ["'self'", "'unsafe-inline'"] : ["'self'"]],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'"]],
    ['font-src', ["'self'"]],
    ['connect-src', connect],
    // No workers, except the browser mock's (VITE_MOCK_API), a service worker on the shell's own origin.
    ['worker-src', options.mockWorker ? ["'self'"] : ["'none'"]],
    ['frame-src', options.frameOrigins.length > 0 ? [...new Set(options.frameOrigins)] : ["'none'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    // The shell is never framed: a page that frames it could trick an admin into clicking.
    ['frame-ancestors', ["'none'"]],
  ]
  if (options.mode === 'production') directives.push(['upgrade-insecure-requests', []])
  return directives.map(([name, values]) => [name, ...values].join(' ')).join('; ')
}

/** A restrictive Permissions-Policy: the shell needs none of these browser features. */
export const PERMISSIONS_POLICY = ['accelerometer', 'autoplay', 'camera', 'clipboard-read', 'display-capture', 'geolocation', 'gyroscope', 'magnetometer', 'microphone', 'midi', 'payment', 'publickey-credentials-get', 'usb']
  .map((feature) => `${feature}=()`)
  .join(', ')

export const HSTS = 'max-age=63072000; includeSubDomains'

/** Every header, by name. HSTS is for production only: preview and dev run over plain http. */
export function securityHeaders(options: HeaderOptions): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Security-Policy': contentSecurityPolicy(options),
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': PERMISSIONS_POLICY,
  }
  if (options.mode === 'production') headers['Strict-Transport-Security'] = HSTS
  return headers
}

/** The `headers` block of `vercel.json`. */
export function vercelHeaders(options: Omit<HeaderOptions, 'mode' | 'devOrigin' | 'mockWorker'>) {
  return [{ source: '/(.*)', headers: Object.entries(securityHeaders({ ...options, mode: 'production' })).map(([key, value]) => ({ key, value })) }]
}
