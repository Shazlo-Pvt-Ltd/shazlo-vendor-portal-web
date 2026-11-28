import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { useAppContext } from '../api/context'

export function useSession() {
  const { session, identity } = useAppContext()
  const state = useSyncExternalStore(session.subscribe, session.get, session.get)

  // The answers are checked by the session before they are kept (store.ts).
  const signIn = useCallback(
    async (email: string, password: string) => {
      const res = await identity.call((c) => c.POST('/v1/auth/login', { body: { email, password } }))
      session.signIn(res)
      return res
    },
    [identity, session],
  )

  const changePassword = useCallback(
    async (current: string, next: string) => {
      const res = await identity.call((c) => c.POST('/v1/auth/change-password', { body: { current_password: current, new_password: next } }))
      session.signIn(res)
    },
    [identity, session],
  )

  // Ends the session in every tab of this browser.
  const signOut = useCallback(() => session.logout(), [session])
  const retry = useCallback(() => session.retry(), [session])

  const can = useCallback((roles: string[]) => Boolean(state.admin?.roles.some((r) => roles.includes(r) || r === 'super_admin')), [state.admin])

  return useMemo(() => ({ ...state, signIn, signOut, changePassword, can, retry }), [state, signIn, signOut, changePassword, can, retry])
}
