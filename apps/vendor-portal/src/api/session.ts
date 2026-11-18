/**
 * Where the API client gets the access token. The session code registers itself here, so the client
 * never imports the session and the session can use the client to refresh.
 */
type TokenProvider = () => string | null | undefined

let provider: TokenProvider | undefined

export function setAccessTokenProvider(next: TokenProvider | undefined): void {
  provider = next
}

export function currentAccessToken(): string | null | undefined {
  return provider?.()
}
