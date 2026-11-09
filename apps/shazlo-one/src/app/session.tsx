import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useContext, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { shellApi, type Role, type ShellSession } from '../api/mock'

interface SessionState {
  session: ShellSession | null
  loading: boolean
  setSession: (s: ShellSession | null) => void
  signOut: () => Promise<void>
  hasRole: (r: Role) => boolean
}

const SessionContext = createContext<SessionState | null>(null)
export const sessionKey = ['shell-session'] as const

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const { data, isPending } = useQuery({ queryKey: sessionKey, queryFn: shellApi.getSession, staleTime: Infinity })
  const session = data ?? null
  const value: SessionState = {
    session,
    loading: isPending,
    setSession: s => qc.setQueryData(sessionKey, s),
    signOut: async () => {
      await shellApi.signOut()
      // Null the session first, then drop every other cached query. `qc.clear()` would also remove the
      // session query and detach SessionProvider's observer, so the UI would never see the sign-out.
      qc.setQueryData(sessionKey, null)
      qc.removeQueries({ predicate: q => q.queryKey[0] !== sessionKey[0] })
    },
    hasRole: r => Boolean(session?.admin.roles.includes(r)),
  }
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside SessionProvider')
  return ctx
}

export function RequireSession({ children, role }: { children: ReactNode; role?: Role }) {
  const { session, loading, hasRole } = useSession()
  const location = useLocation()
  if (loading) return null
  if (!session) return <Navigate to={`/sign-in?next=${encodeURIComponent(location.pathname)}`} replace />
  if (role && !hasRole(role)) return <Navigate to="/" replace />
  return children
}
