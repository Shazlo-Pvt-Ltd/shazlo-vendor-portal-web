/**
 * Where the API client finds the session. The session code registers itself here, so the client
 * never imports the session and the session can use the client to refresh.
 */
import type { ApiError } from './errors'

type TokenProvider = () => string | null | undefined

interface SessionHooks {
  getAccessToken?: TokenProvider
  onUnauthorized?: () => Promise<boolean>
  onApiError?: (error: ApiError) => void
}

let hooks: SessionHooks = {}

/** Registers the session's hooks, or clears them with `undefined`. */
export function registerSessionHooks(next: SessionHooks | undefined): void {
  hooks = next ?? {}
}

export function setAccessTokenProvider(next: TokenProvider | undefined): void {
  hooks = { ...hooks, getAccessToken: next }
}

export function currentAccessToken(): string | null | undefined {
  return hooks.getAccessToken?.()
}

export function handleUnauthorized(): Promise<boolean> {
  return hooks.onUnauthorized?.() ?? Promise.resolve(false)
}

export function handleApiError(error: ApiError): void {
  hooks.onApiError?.(error)
}
