import { assertExactOrigin, createModuleClient, PROTOCOL_VERSION, type AuthPayload, type ModuleClient, type ToastLevel } from '@shazlo/shell-protocol'
import { QueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { ApiError, createApi, type Api } from '../api/http'
import type { ApiPaths } from '../api/client'

declare const __SHELL_ORIGIN__: string | undefined
export const MODULE_ID = 'vendor-admin'
export const MODULE_VERSION = '0.1.0'
// How long a 401 waits for the shell's new token before the request fails.
const TOKEN_WAIT_MS = 10_000
// No new token this long after the last one ended means the shell went away (ADR 0001 §7).
const CLOCK_SLACK_S = 30

// Where the module talks to its shell (ADR 0001): the shell's exact origin and the window whose
// `parent` is the shell. In the browser that is this page in the shell's iframe; tests pass a fake
// window so the real protocol client runs against a stand-in shell.
export interface Host {
  framed: boolean
  shellOrigin: string
  window?: Window
}

export function windowHost(shellOrigin: string): Host {
  return { framed: typeof window !== 'undefined' && window.parent !== window, shellOrigin }
}

// The build sets it (vite.config.ts); a production build without it fails there. `npm run dev` uses
// the shell's dev server.
export function shellOrigin(): string {
  return (typeof __SHELL_ORIGIN__ !== 'undefined' && __SHELL_ORIGIN__) || 'http://localhost:5192'
}

// Token state lives outside React, in the protocol client: in memory only (ADR 0001 §3.4), read by
// the API client per request. The client refuses an `auth` older than the token it holds, and asks
// for a new token at most once every 30 seconds.
class ModuleSession {
  private client: ModuleClient | null = null
  private auth: AuthPayload | null = null
  private waiters: ((ok: boolean) => void)[] = []
  readonly api: Api<ApiPaths>
  readonly queryClient: QueryClient

  constructor(apiUrl: string) {
    this.api = createApi<ApiPaths>({ baseUrl: apiUrl, getToken: () => this.client?.getAccessToken() ?? null, renew: () => this.requestToken('unauthorized') })
    this.queryClient = new QueryClient({
      defaultOptions: {
        queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: (n, e) => n < 2 && e instanceof ApiError && (e.status === 0 || e.status >= 500) },
        mutations: { retry: false },
      },
    })
  }

  attach(client: ModuleClient | null) {
    this.client = client
    if (!client) {
      this.auth = null
      this.waiters.splice(0).forEach((w) => w(false))
    }
  }

  accepted(auth: AuthPayload) {
    this.auth = auth
    this.waiters.splice(0).forEach((w) => w(true))
  }

  expired(): boolean {
    return this.auth !== null && this.auth.expiresAt + CLOCK_SLACK_S < Date.now() / 1000
  }

  // Waits up to 10 seconds for the shell's answer. A request inside the client's 30-second window is
  // not sent, and fails at once.
  requestToken(reason: 'expired' | 'unauthorized'): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.client?.requestToken(reason)) return resolve(false)
      this.waiters.push(resolve)
      setTimeout(() => {
        const i = this.waiters.indexOf(resolve)
        if (i >= 0) {
          this.waiters.splice(i, 1)
          resolve(false)
        }
      }, TOKEN_WAIT_MS)
    })
  }

  toast(level: ToastLevel, message: string) {
    this.client?.sendToast({ level, message: message.slice(0, 280) })
  }

  title(path: string, title: string) {
    this.client?.sendTitle(path, title)
  }

  logout() {
    this.client?.sendLogout()
  }
}

function isExactOrigin(origin: string): boolean {
  try {
    assertExactOrigin(origin, { development: import.meta.env.DEV, name: 'The shell origin' })
    return true
  } catch {
    return false
  }
}

type Status = 'standalone' | 'waiting' | 'ready' | 'ended' | 'misconfigured'

interface Runtime {
  status: Status
  user: AuthPayload['user'] | null
  api: Api<ApiPaths>
  queryClient: QueryClient
  toast: (level: ToastLevel, message: string) => void
  setTitle: (path: string, title: string) => void
  logout: () => void
}

const Context = createContext<Runtime | null>(null)

export function useRuntime(): Runtime {
  const value = useContext(Context)
  if (!value) throw new Error('useRuntime needs a ModuleRuntime')
  return value
}

// Speaks ADR 0001 with the shell through @shazlo/shell-protocol: `ready` first, then the token from
// each `auth` (in memory only), a `token:request` on 401, and the shell's navigate messages.
export function ModuleRuntime({ host, apiUrl, children }: { host: Host; apiUrl: string; children: ReactNode }) {
  const navigate = useNavigate()
  // A missing, wildcard or (outside development) non-https shell origin: the module refuses to run
  // rather than talk to the wrong page.
  const [misconfigured] = useState(() => host.framed && !isExactOrigin(host.shellOrigin))
  const [status, setStatus] = useState<Status>(!host.framed ? 'standalone' : misconfigured ? 'misconfigured' : 'waiting')
  const [user, setUser] = useState<AuthPayload['user'] | null>(null)
  const [session] = useState(() => new ModuleSession(apiUrl))

  useEffect(() => {
    if (!host.framed || misconfigured) return
    const client = createModuleClient({
      shellOrigin: host.shellOrigin,
      window: host.window,
      module: MODULE_ID,
      moduleVersion: MODULE_VERSION,
      supportedVersions: [PROTOCOL_VERSION],
      development: import.meta.env.DEV,
      onAuth: (auth) => {
        session.accepted(auth)
        setUser(auth.user)
        setStatus('ready')
      },
      onNavigate: (path) => navigate(path),
      onShellError: () => setStatus('ended'),
    })
    session.attach(client)
    client.sendReady()
    const watch = setInterval(() => {
      if (session.expired()) setStatus('ended')
    }, 15_000)
    return () => {
      clearInterval(watch)
      client.dispose()
      session.attach(null)
    }
  }, [host, misconfigured, navigate, session])

  const { api, queryClient } = session
  const toast = useCallback((level: ToastLevel, message: string) => session.toast(level, message), [session])
  const setTitle = useCallback((path: string, title: string) => session.title(path, title), [session])
  const logout = useCallback(() => session.logout(), [session])

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
