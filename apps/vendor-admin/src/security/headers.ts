// The Vendors module's security headers, defined once. The Vite dev and preview servers
// (vite.config.ts), the production `vercel.json` (scripts/write-vercel-headers.mjs) and the tests all
// come from here. This file has no imports, so Node can load it as it is.

export type HeaderMode = 'production' | 'preview' | 'development'

/** Where product and brand images are served from in production (vendor-api stores them on Cloudinary). */
export const CLOUDINARY_CDN_ORIGIN = 'https://res.cloudinary.com'
/** The origins the committed `vercel.json` is written for. The Vercel build writes the real ones. */
export const PLACEHOLDER_SHELL_ORIGIN = 'https://one.example.com'
export const PLACEHOLDER_API_ORIGIN = 'https://vendor-admin-api.example.com'

export interface HeaderOptions {
  mode: HeaderMode
  /** Shazlo One's exact origin: the only page that may frame the module. */
  shellOrigin: string
  /** vendor-api's admin app. */
  apiOrigin: string
  /** The dev server's own origin, for its hot-reload socket. */
  devOrigin?: string
}

/**
 * The Content-Security-Policy. The module runs only inside Shazlo One (ADR 0001 §5): `frame-ancestors`
 * names the shell's exact origin and nothing else. Scripts only from the module itself, never inline
 * outside development; network calls only to vendor-api's admin app; images from the module and the
 * Cloudinary CDN (and `data:` outside production, where the mock vendor-api draws its swatches); it
 * frames nothing, embeds nothing and posts no form elsewhere.
 */
export function contentSecurityPolicy(options: HeaderOptions): string {
  const dev = options.mode === 'development'
  const devOrigin = options.devOrigin ?? 'http://localhost:5193'
  const directives: Array<[string, string[]]> = [
    ['default-src', ["'self'"]],
    ['script-src', dev ? ["'self'", "'unsafe-inline'"] : ["'self'"]],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", CLOUDINARY_CDN_ORIGIN, ...(options.mode === 'production' ? [] : ['data:'])]],
    ['font-src', ["'self'"]],
    ['connect-src', [options.apiOrigin, ...(dev ? [devOrigin, devOrigin.replace(/^http/, 'ws')] : [])]],
    ['worker-src', ["'none'"]],
    ['frame-src', ["'none'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    ['frame-ancestors', [options.shellOrigin]],
  ]
  if (options.mode === 'production') directives.push(['upgrade-insecure-requests', []])
  return directives.map(([name, values]) => [name, ...values].join(' ')).join('; ')
}

export const PERMISSIONS_POLICY = ['accelerometer', 'autoplay', 'camera', 'clipboard-read', 'display-capture', 'geolocation', 'gyroscope', 'magnetometer', 'microphone', 'midi', 'payment', 'publickey-credentials-get', 'usb']
  .map((feature) => `${feature}=()`)
  .join(', ')

export const HSTS = 'max-age=63072000; includeSubDomains'

/**
 * Every header, by name. No X-Frame-Options: it cannot name one other origin, and the shell must frame
 * the module; `frame-ancestors` does that job. The referrer is never sent (the shell frames the module
 * with `referrerpolicy="no-referrer"` too).
 */
export function securityHeaders(options: HeaderOptions): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Security-Policy': contentSecurityPolicy(options),
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Permissions-Policy': PERMISSIONS_POLICY,
  }
  if (options.mode === 'production') headers['Strict-Transport-Security'] = HSTS
  return headers
}

/**
 * The `headers` block of `vercel.json`: the policy for every page, and CORS for the manifest, which the
 * shell reads from its own origin without credentials (ADR 0011).
 */
export function vercelHeaders(options: Omit<HeaderOptions, 'mode' | 'devOrigin'>) {
  return [
    { source: '/(.*)', headers: Object.entries(securityHeaders({ ...options, mode: 'production' })).map(([key, value]) => ({ key, value })) },
    {
      source: '/shazlo-module.json',
      headers: [
        { key: 'Access-Control-Allow-Origin', value: options.shellOrigin },
        { key: 'Vary', value: 'Origin' },
      ],
    },
  ]
}
