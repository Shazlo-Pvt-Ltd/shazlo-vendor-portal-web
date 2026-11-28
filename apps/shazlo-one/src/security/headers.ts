/**
 * The shell's security headers, defined once. `vercel.json` (production), the Vite dev and preview
 * servers and the tests all come from here, so they cannot drift apart.
 */

export type HeaderMode = 'production' | 'preview' | 'development'

/** The API origin the committed `vercel.json` is written for. The Vercel build swaps in the real one. */
export const PLACEHOLDER_API_ORIGIN = 'https://identity.example.com'

export interface HeaderOptions {
  /** The identity-api origin (`VITE_IDENTITY_API_URL`). */
  apiOrigin: string
  mode: HeaderMode
  /** The origins of the registered modules: the only ones the shell may frame. */
  moduleOrigins?: readonly string[]
  /** The dev server's origin, for its hot-reload socket. */
  devOrigin?: string
}

/**
 * The Content-Security-Policy. Scripts only from the app itself, never inline and never `eval`;
 * network calls only to identity-api (modules talk to their own backends from inside their frames,
 * under their own policy); frames only from the registered module origins, and `'none'` while there
 * are none; nothing may frame the shell, embed objects or change `<base>`.
 *
 * Styles allow `'unsafe-inline'` because MUI's runtime (emotion) writes `<style>` tags. That cannot
 * run script. Replace it with a nonce if the host ever supports one.
 *
 * Development relaxes `script-src` for the React refresh preamble, which Vite injects inline, and
 * allows the hot-reload socket. Production and preview use the strict policy.
 */
export function contentSecurityPolicy(options: HeaderOptions): string {
  const dev = options.mode === 'development'
  const devOrigin = options.devOrigin ?? 'http://localhost:5173'
  const frames = options.moduleOrigins ?? []
  const directives: Array<[string, string[]]> = [
    ['default-src', ["'self'"]],
    ['script-src', dev ? ["'self'", "'unsafe-inline'"] : ["'self'"]],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'"]],
    ['font-src', ["'self'"]],
    ['connect-src', [options.apiOrigin, ...(dev ? [devOrigin.replace(/^http/, 'ws'), devOrigin] : [])]],
    ['frame-src', frames.length > 0 ? [...frames] : ["'none'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    // The shell is never framed: a page that frames it could trick an admin into clicking.
    ['frame-ancestors', ["'none'"]],
  ]
  if (options.mode === 'production') {
    directives.push(['upgrade-insecure-requests', []])
  }
  return directives.map(([name, values]) => [name, ...values].join(' ')).join('; ')
}

/** A restrictive Permissions-Policy: the shell needs none of these browser features. */
export const PERMISSIONS_POLICY = [
  'accelerometer',
  'autoplay',
  'camera',
  'clipboard-read',
  'display-capture',
  'geolocation',
  'gyroscope',
  'magnetometer',
  'microphone',
  'midi',
  'payment',
  'publickey-credentials-get',
  'usb',
]
  .map((feature) => `${feature}=()`)
  .join(', ')

export const HSTS = 'max-age=63072000; includeSubDomains'

/** Every header, by name. HSTS is for production only: preview and dev run over plain http. */
export function securityHeaders(options: HeaderOptions): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Security-Policy': contentSecurityPolicy(options),
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'Permissions-Policy': PERMISSIONS_POLICY,
  }
  if (options.mode === 'production') {
    headers['Strict-Transport-Security'] = HSTS
  }
  return headers
}

/** The `headers` block of `vercel.json`. */
export function vercelHeaders(apiOrigin: string, moduleOrigins: readonly string[] = []) {
  return [
    {
      source: '/(.*)',
      headers: Object.entries(securityHeaders({ apiOrigin, moduleOrigins, mode: 'production' })).map(
        ([key, value]) => ({ key, value }),
      ),
    },
  ]
}
