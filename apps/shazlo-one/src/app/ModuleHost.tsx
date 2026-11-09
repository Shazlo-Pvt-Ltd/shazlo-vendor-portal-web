import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import {
  createMessage, isTrustedMessage, MAX_READY_RETRIES, negotiateVersion, parseModuleMessage, READY_TIMEOUT_MS,
  type AuthMessage, type NavigateMessage, type ShellErrorMessage,
} from '@shazlo/shell-protocol'
import { useToast } from '@shazlo/ui/components'
import { shellApi } from '../api/mock'
import { ModuleFailed } from '../screens/ModuleFailed'
import type { ShellModule } from './registry'
import { useSession } from './session'
import { TopBar } from './topbar'

type HostState =
  | { phase: 'loading' }
  | { phase: 'ready'; moduleVersion: string }
  | { phase: 'failed'; reason: 'timeout' | 'version_unsupported' | 'fatal'; message?: string; moduleVersion?: string }

const devLog = (...args: unknown[]) => { if (import.meta.env.DEV) console.warn('[shazlo-one]', ...args) }

/**
 * Hosts one module in a sandboxed iframe and runs the ADR 0001 handshake:
 * listener first, then src; `ready` → `auth`; refresh at 80% of the token lifetime; 10 s timeout
 * with Retry (reloads only the iframe), "unavailable" after 3 failures.
 */
export function ModuleHost({ module }: { module: ShellModule }) {
  const { session, signOut } = useSession()
  const { show } = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const frame = useRef<HTMLIFrameElement>(null)
  const [state, setState] = useState<HostState>({ phase: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [failures, setFailures] = useState(0)
  const [crumbs, setCrumbs] = useState<string[]>([])
  // Support-friendly id shown on the A-03 panel, e.g. 7f3c-91ad-2b04 (new per attempt).
  const requestId = useMemo(() => Array.from(crypto.getRandomValues(new Uint16Array(3)), n => n.toString(16).padStart(4, '0')).join('-'), [attempt])
  const token = useRef<{ accessToken: string; expiresAt: number } | null>(null)
  const lastTokenRequest = useRef(0)
  const readyAt = useRef<number | null>(null)
  const subPath = location.pathname.slice(module.basePath.length) || '/'
  // The iframe src is fixed per attempt; later shell navigation is sent as a `navigate` message.
  const initialPath = useRef(subPath)
  const src = useMemo(() => new URL(initialPath.current.replace(/^\//, ''), module.url).toString(), [module.url, attempt])
  const lastModulePath = useRef(subPath)

  const post = useCallback((msg: AuthMessage | NavigateMessage | ShellErrorMessage) => {
    frame.current?.contentWindow?.postMessage(msg, module.origin)
  }, [module.origin])

  const sendAuth = useCallback(async (replyTo?: string) => {
    if (!session) return
    try {
      const t = await shellApi.moduleToken(module.id)
      token.current = t
      post(createMessage<AuthMessage>('auth', {
        accessToken: t.accessToken,
        expiresAt: t.expiresAt,
        user: { id: session.admin.id, email: session.admin.email, roles: session.admin.roles, name: session.admin.name },
        locale: 'en-IN',
      }, replyTo))
    } catch {
      await signOut()
      navigate('/sign-in')
    }
  }, [module.id, navigate, post, session, signOut])

  // 1. Listener before src (registered in an effect that runs before the iframe loads its document).
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!isTrustedMessage(event, { origin: module.origin, source: frame.current?.contentWindow ?? null })) return
      const msg = parseModuleMessage(event.data)
      if (!msg) { devLog('dropped message', event.data); return }
      switch (msg.type) {
        case 'ready': {
          const v = negotiateVersion(msg.payload.supportedVersions, module.supportedVersions)
          if (v === null) {
            post(createMessage<ShellErrorMessage>('error', { code: 'version_unsupported', message: 'This module speaks a protocol version the shell does not support.' }, msg.id))
            setState({ phase: 'failed', reason: 'version_unsupported', moduleVersion: msg.payload.moduleVersion })
            return
          }
          readyAt.current = Date.now()
          setState({ phase: 'ready', moduleVersion: msg.payload.moduleVersion })
          setFailures(0)
          void sendAuth(msg.id)
          return
        }
        case 'title': {
          lastModulePath.current = msg.payload.path
          setCrumbs(msg.payload.breadcrumb ?? [msg.payload.title])
          document.title = `${msg.payload.title} · ${module.title} · Shazlo One`
          const target = `${module.basePath}${msg.payload.path === '/' ? '' : msg.payload.path}`
          if (target !== window.location.pathname) navigate(target, { replace: true, state: { fromModule: true } })
          return
        }
        case 'token:request':
          if (Date.now() - lastTokenRequest.current < 30_000) return
          lastTokenRequest.current = Date.now()
          void sendAuth()
          return
        case 'toast':
          show(msg.payload.message, msg.payload.level, msg.payload.durationMs)
          return
        case 'logout':
          void signOut().then(() => navigate('/sign-in'))
          return
        case 'error':
          if (msg.payload.fatal) setState({ phase: 'failed', reason: 'fatal', message: msg.payload.message })
          else devLog('module error', msg.payload)
          return
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [module, navigate, post, sendAuth, show, signOut])

  // 2. Ready timeout per attempt.
  useEffect(() => {
    setState({ phase: 'loading' })
    readyAt.current = null
    const t = window.setTimeout(() => {
      if (readyAt.current === null) {
        setState({ phase: 'failed', reason: 'timeout' })
        setFailures(f => f + 1)
      }
    }, READY_TIMEOUT_MS)
    return () => window.clearTimeout(t)
  }, [attempt])

  // 3. Push a fresh token at 80% of its lifetime (and at least 30 s before expiry).
  useEffect(() => {
    if (state.phase !== 'ready') return
    const id = window.setInterval(() => {
      const t = token.current
      if (!t) return
      const msLeft = t.expiresAt * 1000 - Date.now()
      if (msLeft < Math.max(30_000, 0.2 * 15 * 60_000)) void sendAuth()
    }, 15_000)
    return () => window.clearInterval(id)
  }, [sendAuth, state.phase])

  // 4. Shell-side navigation (sidebar, back button) becomes a `navigate` message, not a reload.
  useEffect(() => {
    if (state.phase !== 'ready') return
    if ((location.state as { fromModule?: boolean } | null)?.fromModule) return
    if (subPath !== lastModulePath.current) {
      lastModulePath.current = subPath
      post(createMessage<NavigateMessage>('navigate', { path: subPath }))
    }
  }, [location, post, state.phase, subPath])

  const retry = () => {
    initialPath.current = lastModulePath.current
    setAttempt(a => a + 1)
  }

  const failed = state.phase === 'failed'
  return (
    <>
      <TopBar crumbs={[{ label: module.title, to: module.basePath }, ...crumbs.map(label => ({ label }))].filter((c, i, all) => i === 0 || c.label !== all[0]!.label)} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', background: '#FFF8E1', minHeight: 'calc(100dvh - 57px)', padding: 16 }}>
        {/* A-04 module host: 16 px around the module frame (1176 px wide at 1440). */}
        {!failed && (
          <iframe
            key={attempt}
            ref={frame}
            src={src}
            title={`${module.title} admin`}
            sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"
            referrerPolicy="no-referrer"
            allow=""
            style={{ flex: 1, width: '100%', border: 0, display: 'block', opacity: state.phase === 'ready' ? 1 : 0, transition: 'opacity 150ms ease-out' }}
          />
        )}
        {state.phase === 'loading' && (
          <div role="status" aria-live="polite" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span className="shz-visually-hidden">Loading {module.title}</span>
          </div>
        )}
        {failed && (
          <ModuleFailed
            module={module}
            reason={state.reason}
            message={state.message}
            moduleVersion={state.moduleVersion}
            requestId={requestId}
            attempts={failures}
            unavailable={failures >= MAX_READY_RETRIES}
            onRetry={retry}
          />
        )}
      </div>
    </>
  )
}
