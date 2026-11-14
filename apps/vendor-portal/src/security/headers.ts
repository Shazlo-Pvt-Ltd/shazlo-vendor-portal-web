/**
 * The portal's security headers, defined once. `vercel.json` (production), the Vite dev and preview
 * servers and the tests all come from here, so they cannot drift apart.
 */

export type HeaderMode = 'production' | 'preview' | 'development'

/** Where signed image uploads go (connect-src) and where images are served from (img-src). */
export const CLOUDINARY_UPLOAD_ORIGIN = 'https://api.cloudinary.com'
export const CLOUDINARY_CDN_ORIGIN = 'https://res.cloudinary.com'

/** The API origin the committed `vercel.json` is written for. The Vercel build swaps in the real one. */
export const PLACEHOLDER_API_ORIGIN = 'https://api.example.com'

export interface HeaderOptions {
  /** The vendor-api origin (`VITE_VENDOR_API_URL`). */
  apiOrigin: string
  mode: HeaderMode
  /** The dev server's origin, for its hot-reload socket. */
  devOrigin?: string
}

/**
 * The Content-Security-Policy. Scripts only from the app itself, never inline and never `eval`;
 * network calls only to the API and the upload host; images only from the app and the Cloudinary CDN;
 * nothing may frame the portal, embed objects or change `<base>`.
 *
 * Styles allow `'unsafe-inline'` because MUI's runtime (emotion) writes `<style>` tags. That cannot
 * run script. Replace it with a nonce if the host ever supports one.
 *
 * Development relaxes `script-src` for the React refresh preamble, which Vite injects inline, and
 * allows the hot-reload socket. Production and preview use the strict policy.
 */
export function contentSecurityPolicy(options: HeaderOptions): string {
  const dev = options.mode === 'development'
  const devOrigin = options.devOrigin ?? 'http://localhost:5174'
  const directives: Array<[string, string[]]> = [
    ['default-src', ["'self'"]],
    ['script-src', dev ? ["'self'", "'unsafe-inline'"] : ["'self'"]],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", CLOUDINARY_CDN_ORIGIN]],
    ['font-src', ["'self'"]],
    [
      'connect-src',
      [options.apiOrigin, CLOUDINARY_UPLOAD_ORIGIN, ...(dev ? [devOrigin.replace(/^http/, 'ws'), devOrigin] : [])],
    ],
    ['frame-src', ["'none'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
  ]
  if (options.mode === 'production') {
    directives.push(['upgrade-insecure-requests', []])
  }
  return directives.map(([name, values]) => [name, ...values].join(' ')).join('; ')
}

/** A restrictive Permissions-Policy: the portal needs none of these browser features. */
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
export function vercelHeaders(apiOrigin: string) {
  return [
    {
      source: '/(.*)',
      headers: Object.entries(securityHeaders({ apiOrigin, mode: 'production' })).map(([key, value]) => ({ key, value })),
    },
  ]
}
