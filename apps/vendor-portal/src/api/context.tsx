import { QueryClient } from '@tanstack/react-query'
import { createContext, useContext, type ReactNode } from 'react'
import { createSessionStore, type SessionStore } from '../auth/tokens'
import { ApiError, createApi, type Api } from './client'

export interface AppContext {
  api: Api
  session: SessionStore
  queryClient: QueryClient
}

export function apiBaseUrl(): string {
  const configured = import.meta.env.VITE_VENDOR_API_URL as string | undefined
  if (configured) return configured.replace(/\/+$/, '')
  return typeof window !== 'undefined' && window.location.origin !== 'null' ? window.location.origin : 'http://localhost'
}

export function createAppContext({ baseUrl = apiBaseUrl(), session = createSessionStore() }: { baseUrl?: string; session?: SessionStore } = {}): AppContext {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Retry network blips, not answers: a 404 or 422 will not change on retry.
        retry: (count, error) => count < 2 && error instanceof ApiError && (error.status === 0 || error.status >= 500),
      },
      mutations: { retry: false },
    },
  })
  const api = createApi({ baseUrl, tokens: session, onSignedOut: () => queryClient.clear() })
  return { api, session, queryClient }
}

const Context = createContext<AppContext | null>(null)

export function AppContextProvider({ value, children }: { value: AppContext; children: ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function useAppContext(): AppContext {
  const value = useContext(Context)
  if (!value) throw new Error('useAppContext needs an AppContextProvider above it')
  return value
}

export const useApi = () => useAppContext().api
