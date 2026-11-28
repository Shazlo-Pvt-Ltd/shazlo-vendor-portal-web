/**
 * Build 2's screens keep an image as its URL; vendor-api's bodies want the asset id. Every image
 * the portal uploads or reads with its id is remembered here (in memory, for this tab), so a body
 * can name the asset of a URL the screen hands back.
 */
const ids = new Map<string, string>()

export function rememberAsset(url: string | null | undefined, assetId: string | null | undefined): void {
  if (url && assetId) ids.set(url, assetId)
}

export function assetIdForUrl(url: string): string | null {
  return ids.get(url) ?? null
}

/** Forgets every image; on sign-out, and between tests. */
export function forgetAssets(): void {
  ids.clear()
}
