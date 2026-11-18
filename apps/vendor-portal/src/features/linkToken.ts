/**
 * The one-time token of an emailed link. vendor-api puts it in the URL fragment
 * (`/verify-email#token=...`): the browser never sends a fragment to a server, so the token stays
 * out of access logs and `Referer` headers. A `?token=` query is accepted too. Read it once into
 * memory, then replace the address with the bare path so it does not stay in the address bar or
 * the history.
 */
export function linkToken(location: { hash: string; search: string }): string {
  const fromFragment = new URLSearchParams(location.hash.replace(/^#/, '')).get('token')
  const fromQuery = new URLSearchParams(location.search).get('token')
  return (fromFragment ?? fromQuery ?? '').trim()
}
