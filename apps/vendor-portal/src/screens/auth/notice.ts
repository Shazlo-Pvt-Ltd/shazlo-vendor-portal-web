// A one-line notice a signed-out page hands to the next one through the router's state (setting a
// password sends the seller to sign in with "Your password is set"). AuthLayout shows it. Only
// text this app wrote travels this way, never anything from an address or a server.

export interface NoticeState {
  notice: string
}

export const withNotice = (notice: string): NoticeState => ({ notice })

/** The notice in a location's state, or null. */
export function noticeOf(state: unknown): string | null {
  const notice = typeof state === 'object' && state !== null ? (state as Partial<NoticeState>).notice : undefined
  return typeof notice === 'string' && notice.trim() !== '' ? notice : null
}
