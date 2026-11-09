import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router'
import {
  createMessage, isTrustedMessage, parseShellMessage, PROTOCOL_VERSION,
  type LogoutMessage, type ReadyMessage, type TitleMessage, type ToastLevel, type ToastMessage, type TokenRequestMessage, type UserInfo,
} from '@shazlo/shell-protocol'
import { useToast } from '@shazlo/ui/components'

export const MODULE_ID = 'vendor-admin'
export const MODULE_VERSION = '1.4.0'
const SHELL_ORIGIN = __SHELL_ORIGIN__

type Status = 'connecting' | 'authenticated' | 'standalone' | 'ended' | 'unsupported'

interface ShellState {
  status: Status
  user: UserInfo | null
  /** In memory only (ADR 0001 §3); never written to storage or URLs. */
  token: () => string | null
  toast: (level: ToastLevel, message: string) => void
  logout: () => void
  requestToken: (reason: 'expired' | 'unauthorized') => void
  /** Tell the shell which page this is, for its breadcrumb, tab title and URL. */
  setTitle: (title: string, breadcrumb?: string[]) => void
}

const ShellContext = createContext<ShellState | null>(null)
const framed = typeof window !== 'undefined' && window.parent !== window

/** Development-only reviewer so screens can be previewed outside Shazlo-One. */
const devUser: UserInfo = { id: 'a_priya', email: 'priya@shazlo.store', roles: ['vendor_reviewer'], name: 'Priya Mehta' }

export function ShellConnection({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { show } = useToast()
  const [status, setStatus] = useState<Status>(framed ? 'connecting' : import.meta.env.DEV ? 'standalone' : 'ended')
  const [user, setUser] = useState<UserInfo | null>(framed ? null : import.meta.env.DEV ? devUser : null)
  const tokenRef = useRef<{ value: string; expiresAt: number } | null>(null)
  const lastAuthAt = useRef(Date.now())
  const lastRequest = useRef(0)

  const send = (msg: ReadyMessage | TitleMessage | TokenRequestMessage | LogoutMessage | ToastMessage) => {
    if (framed && SHELL_ORIGIN) window.parent.postMessage(msg, SHELL_ORIGIN)
  }

  useEffect(() => {
    if (!framed) return
    const onMessage = (event: MessageEvent) => {
      if (!isTrustedMessage(event, { origin: SHELL_ORIGIN, source: window.parent })) return
      const msg = parseShellMessage(event.data)
      if (!msg) { if (import.meta.env.DEV) console.warn('[vendor-admin] dropped', event.data); return }
      if (msg.type === 'auth') {
        // Ignore an older token than the one we hold (ADR 0001 §3.7).
        if (tokenRef.current && msg.payload.expiresAt < tokenRef.current.expiresAt) return
        tokenRef.current = { value: msg.payload.accessToken, expiresAt: msg.payload.expiresAt }
        lastAuthAt.current = Date.now()
        setUser(msg.payload.user)
        setStatus('authenticated')
      } else if (msg.type === 'navigate') {
        navigate(msg.payload.path)
      } else if (msg.type === 'error') {
        setStatus(msg.payload.code === 'version_unsupported' ? 'unsupported' : 'ended')
      }
    }
    window.addEventListener('message', onMessage)
    send(createMessage<ReadyMessage>('ready', { module: MODULE_ID, supportedVersions: [PROTOCOL_VERSION], moduleVersion: MODULE_VERSION }))
    // No refresh for more than twice the refresh interval (12 min) means the shell is gone.
    const watchdog = window.setInterval(() => {
      const t = tokenRef.current
      if (t && t.expiresAt * 1000 + 30_000 < Date.now()) { tokenRef.current = null; setStatus('ended') }
    }, 30_000)
    return () => { window.removeEventListener('message', onMessage); window.clearInterval(watchdog) }
  }, [])

  const value = useMemo<ShellState>(() => ({
    status,
    user,
    token: () => tokenRef.current?.value ?? (status === 'standalone' ? 'dev-token' : null),
    toast: (level, message) => {
      if (framed) send(createMessage<ToastMessage>('toast', { level, message: message.slice(0, 280) }))
      else show(message, level)
    },
    logout: () => send(createMessage<LogoutMessage>('logout', {})),
    requestToken: reason => {
      if (Date.now() - lastRequest.current < 30_000) return
      lastRequest.current = Date.now()
      send(createMessage<TokenRequestMessage>('token:request', { reason }))
    },
    setTitle: (title, breadcrumb) => {
      document.title = `${title} · Vendor admin`
      send(createMessage<TitleMessage>('title', { path: location.pathname, title, breadcrumb }))
    },
  }), [status, user, location.pathname, show])

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>
}

export function useShell() {
  const ctx = useContext(ShellContext)
  if (!ctx) throw new Error('useShell must be used inside ShellConnection')
  return ctx
}

/** Each screen names itself once: `useModuleTitle('Review queue')` or with a breadcrumb trail. */
export function useModuleTitle(title: string, breadcrumb?: string[]) {
  const { setTitle, status } = useShell()
  const key = JSON.stringify([title, breadcrumb])
  useEffect(() => {
    if (status === 'authenticated' || status === 'standalone') setTitle(title, breadcrumb)
  }, [key, status])
}
