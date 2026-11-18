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
