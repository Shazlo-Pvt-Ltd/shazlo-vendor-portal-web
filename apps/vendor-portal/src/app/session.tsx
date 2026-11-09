import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useContext, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { api, type Session } from '../api'
import { keys } from '../api/hooks'

interface SessionState {
  session: Session | null
  loading: boolean
  setSession: (s: Session | null) => void
  signOut: () => Promise<void>
}

const SessionContext = createContext<SessionState | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const { data, isPending } = useQuery({ queryKey: keys.session, queryFn: api.getSession, staleTime: Infinity })
  const value: SessionState = {
    session: data ?? null,
    loading: isPending,
    setSession: s => qc.setQueryData(keys.session, s),
    signOut: async () => {
      await api.signOut()
      qc.clear()
      qc.setQueryData(keys.session, null)
    },
  }
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside SessionProvider')
  return ctx
}

/** Signed-in routes. Unknown sessions go to sign-in and come back afterwards. */
export function RequireSession({ children }: { children: ReactNode }) {
  const { session, loading } = useSession()
  const location = useLocation()
  if (loading) return null
  if (!session) return <Navigate to={`/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  return children
}
