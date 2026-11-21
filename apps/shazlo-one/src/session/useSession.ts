import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { useAppContext } from '../api/context'

export function useSession() {
  const { session, identity } = useAppContext()
  const state = useSyncExternalStore(session.subscribe, session.get, session.get)

  const signIn = useCallback(
    async (email: string, password: string) => {
      const res = await identity.call((c) => c.POST('/v1/auth/login', { body: { email, password } }))
      session.adopt(res)
      return res
    },
    [identity, session],
  )

  const changePassword = useCallback(
    async (current: string, next: string) => {
      const res = await identity.call((c) => c.POST('/v1/auth/change-password', { body: { current_password: current, new_password: next } }))
      session.adopt(res)
    },
    [identity, session],
  )

  const signOut = useCallback(async () => {
    await identity.call((c) => c.POST('/v1/auth/logout')).catch(() => undefined)
    session.end('signed_out')
  }, [identity, session])

  const can = useCallback((roles: string[]) => Boolean(state.admin?.roles.some((r) => roles.includes(r) || r === 'super_admin')), [state.admin])

  return useMemo(() => ({ ...state, signIn, signOut, changePassword, can }), [state, signIn, signOut, changePassword, can])
}
