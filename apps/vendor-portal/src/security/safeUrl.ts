/**
 * A URL a vendor typed or uploaded (a website, an image) may be shown only if it is plain `https:`.
 * `javascript:`, `data:`, `http:` and addresses with a user name or password are refused.
 * Returns the normalised URL, or undefined.
 */
export function safeHttpsUrl(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (text === '' || text.length > 2048) return undefined
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.hostname === '') {
    return undefined
  }
  return url.href
}

/**
 * An image address: plain `https:` (see {@link safeHttpsUrl}), a path on the app's own origin
 * (`/demo/kurta.jpg`) or a `blob:` the page made, which the Content-Security-Policy allows as
 * `'self'` and `blob:`. `data:`, `javascript:`, `//host`, backslashes and control characters are refused.
 */
export function safeImageUrl(value: string | null | undefined): string | undefined {
  // eslint-disable-next-line no-control-regex
  if (typeof value === 'string' && value.length <= 2048 && /^\/(?![/\\])[^\\\u0000-\u001f\u007f]*$/.test(value)) {
    return value
  }
  // A `blob:` address is one the page itself made (URL.createObjectURL): the preview of a chosen
  // file, a demo photo. Only blob: of an http(s) origin; never data:, javascript: or anything else.
  if (typeof value === 'string' && value.length <= 2048 && value.startsWith('blob:')) {
    try {
      const inner = new URL(value.slice('blob:'.length))
      return (inner.protocol === 'https:' || inner.protocol === 'http:') && !/[\s\\]/.test(value) ? value : undefined
    } catch {
      return undefined
    }
  }
  return safeHttpsUrl(value)
}
