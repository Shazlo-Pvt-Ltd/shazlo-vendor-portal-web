import { createMessage, CURRENT_VERSION, listenAsModule, sendTo, type AuthPayload, type Message, type ShellMessage } from '@shazlo/shell-protocol'
import { QueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { ApiError, createApi, type Api } from '../api/http'
import type { paths } from '../api/schema'

declare const __SHELL_ORIGIN__: string | undefined
export const MODULE_ID = 'vendor-admin'
export const MODULE_VERSION = '0.1.0'
const TOKEN_REQUEST_GAP_MS = 30_000
const CLOCK_SLACK_S = 30

// How the module talks to its shell. In the browser that is window.parent at the exact shell origin;
// tests pass a fake host.
export interface Host {
  framed: boolean
  send(message: Message): void
  listen(onMessage: (message: ShellMessage) => void): () => void
}

export function windowHost(shellOrigin: string): Host {
  return {
    framed: typeof window !== 'undefined' && window.parent !== window,
    send: (message) => sendTo(window.parent, shellOrigin, message),
    listen: (onMessage) => listenAsModule({ shellOrigin, onMessage }),
  }
}

export function shellOrigin(): string {
  return (typeof __SHELL_ORIGIN__ !== 'undefined' && __SHELL_ORIGIN__) || 'http://localhost:5192'
}


// Token state lives outside React: in memory only (ADR 0001 §3.4), read by the API client per request.
class ModuleSession {
  private auth: AuthPayload | null = null
  private waiters: ((ok: boolean) => void)[] = []
  private lastRequest = 0
  readonly api: Api<paths>
  readonly queryClient: QueryClient

  constructor(private host: Host, apiUrl: string) {
    this.api = createApi<paths>({ baseUrl: apiUrl, getToken: () => this.auth?.accessToken ?? null, renew: () => this.requestToken('unauthorized') })
    this.queryClient = new QueryClient({
      defaultOptions: {
        queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: (n, e) => n < 2 && e instanceof ApiError && (e.status === 0 || e.status >= 500) },
        mutations: { retry: false },
      },
    })
  }

  // Ignores an auth older than the token already held (ADR 0001 §3.7).
  accept(auth: AuthPayload): boolean {
    if (this.auth && auth.expiresAt < this.auth.expiresAt) return false
    this.auth = auth
    this.waiters.splice(0).forEach((w) => w(true))
    return true
  }

  expired(): boolean {
    return this.auth !== null && this.auth.expiresAt + CLOCK_SLACK_S < Date.now() / 1000
  }

  // At most one token:request every 30 seconds; waits up to 10 seconds for the shell's answer.
  requestToken(reason: 'expired' | 'unauthorized'): Promise<boolean> {
    return new Promise((resolve) => {
      const now = Date.now()
      if (now - this.lastRequest < TOKEN_REQUEST_GAP_MS) return resolve(false)
      this.lastRequest = now
      this.waiters.push(resolve)
      this.host.send(createMessage('token:request', { reason }))
      setTimeout(() => {
        const i = this.waiters.indexOf(resolve)
        if (i >= 0) {
          this.waiters.splice(i, 1)
          resolve(false)
        }
      }, 10_000)
    })
  }
}

type Status = 'standalone' | 'waiting' | 'ready' | 'ended'

interface Runtime {
  status: Status
  user: AuthPayload['user'] | null
  api: Api<paths>
  queryClient: QueryClient
  toast: (level: 'info' | 'success' | 'warning' | 'error', message: string) => void
  setTitle: (path: string, title: string) => void
  logout: () => void
}

const Context = createContext<Runtime | null>(null)

export function useRuntime(): Runtime {
  const value = useContext(Context)
  if (!value) throw new Error('useRuntime needs a ModuleRuntime')
  return value
}

// Holds the token in memory only (ADR 0001 §3.4), asks the shell for a new one on 401, and follows
// the shell's navigate messages.
export function ModuleRuntime({ host, apiUrl, children }: { host: Host; apiUrl: string; children: ReactNode }) {
  const navigate = useNavigate()
  const [status, setStatus] = useState<Status>(host.framed ? 'waiting' : 'standalone')
  const [user, setUser] = useState<AuthPayload['user'] | null>(null)
  const [session] = useState(() => new ModuleSession(host, apiUrl))

  useEffect(() => {
    if (!host.framed) return
    const stop = host.listen((message) => {
      if (message.type === 'auth') {
        if (!session.accept(message.payload)) return
        setUser(message.payload.user)
        setStatus('ready')
      } else if (message.type === 'navigate') {
        navigate(message.payload.path)
      } else if (message.type === 'error') {
        setStatus('ended')
      }
    })
    host.send(createMessage('ready', { module: MODULE_ID, supportedVersions: [CURRENT_VERSION], moduleVersion: MODULE_VERSION }))
    // No new token well past expiry means the shell went away (ADR 0001 §7).
    const watch = setInterval(() => {
      if (session.expired()) setStatus('ended')
    }, 15_000)
    return () => {
      stop()
      clearInterval(watch)
    }
  }, [host, navigate, session])

  const { api, queryClient } = session
  const toast = useCallback((level: 'info' | 'success' | 'warning' | 'error', message: string) => host.send(createMessage('toast', { level, message: message.slice(0, 280) })), [host])
  const setTitle = useCallback((path: string, title: string) => {
    if (host.framed) host.send(createMessage('title', { path, title }))
  }, [host])
  const logout = useCallback(() => host.send(createMessage('logout', {})), [host])

  const value = useMemo(() => ({ status, user, api, queryClient, toast, setTitle, logout }), [status, user, api, queryClient, toast, setTitle, logout])
  return <Context.Provider value={value}>{children}</Context.Provider>
}

// Each screen names itself; the shell shows it in its breadcrumb, tab title and URL.
export function useModuleTitle(title: string | null | undefined) {
  const { setTitle, status } = useRuntime()
  const location = useLocation()
  const path = location.pathname + location.search
  useEffect(() => {
    if (title && status === 'ready') setTitle(path, title)
  }, [title, path, status, setTitle])
}
