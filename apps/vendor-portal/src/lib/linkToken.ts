/** The longest token vendor-api accepts (`SetPasswordRequest.token`); anything longer is not one of its links. */
export const TOKEN_MAX = 200

/**
 * The one-time token of an emailed link (main's features/linkToken.ts). vendor-api puts it in the
 * URL fragment (`/verify-email#token=...`): the browser never sends a fragment to a server, so the
 * token stays out of access logs and `Referer` headers. A `?token=` query is accepted too. Screens
 * read it once into memory, then replace the address with the bare path so it does not stay in
 * the address bar or the history. Empty when there is no usable token.
 */
export function linkToken(location: { hash: string; search: string }): string {
  const fromFragment = new URLSearchParams(location.hash.replace(/^#/, '')).get('token')
  const fromQuery = new URLSearchParams(location.search).get('token')
  const token = (fromFragment ?? fromQuery ?? '').trim()
  return token.length > TOKEN_MAX ? '' : token
}
