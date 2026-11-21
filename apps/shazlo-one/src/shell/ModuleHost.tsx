import { Box, Button, Skeleton, Stack, Typography } from '@mui/material'
import { EmptyIllustration, neutral, useSnackbar } from '@shazlo/ui'
import { createMessage, listenAsShell, pickVersion, sendTo, type Message, type ModuleMessage } from '@shazlo/shell-protocol'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useAppContext } from '../api/context'
import { paths } from '../app/paths'
import type { ShellModule } from '../app/registry'
import { useCrumb } from '../app/crumbs'
import { shellCopy } from '../copy/shell'
import { useSession } from '../session/useSession'

const copy = shellCopy.module
export const READY_TIMEOUT_MS = 10_000
export const MAX_ATTEMPTS = 3
const TOKEN_REQUEST_GAP_MS = 30_000

type State = { kind: 'loading' } | { kind: 'ready' } | { kind: 'failed' } | { kind: 'unavailable' } | { kind: 'version'; moduleVersion: string }

// Hosts one module in an iframe and speaks ADR 0001 with it: ready → auth, token refresh, title and
// URL sync, toasts, logout, and the 10-second / three-attempt failure handling.
export function ModuleHost({ module }: { module: ShellModule }) {
  const { session } = useAppContext()
  const { admin, signOut } = useSession()
  const notify = useSnackbar()
  const navigate = useNavigate()
  const location = useLocation()
  const frame = useRef<HTMLIFrameElement>(null)
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(1)
  const [title, setTitle] = useState<string | null>(null)
  const modulePath = useRef<string | null>(null)
  const lastTokenRequest = useRef(0)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sendAuthRef = useRef<(replyTo?: string, force?: boolean) => Promise<void>>(async () => {})
  useCrumb(title)

  const pathInModule = location.pathname.slice(module.basePath.length) || module.links[0]!.path
  const target = pathInModule + location.search

  const send = useCallback((message: Message) => {
    const win = frame.current?.contentWindow
    if (win) sendTo(win, module.origin, message)
  }, [module.origin])

  // Pushes a fresh token before the current one runs out (80% of its life, ADR 0001 §3.5).
  const sendAuth = useCallback(async (replyTo?: string, force = false) => {
    if (!admin) return
    try {
      const { token, expiresAt } = await session.moduleToken(module.audience, force)
      send(createMessage('auth', { accessToken: token, expiresAt, user: { id: admin.id, email: admin.email, roles: admin.roles, name: admin.display_name }, locale: 'en-IN' }, replyTo))
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      const lifeMs = (expiresAt - Date.now() / 1000) * 1000
      refreshTimer.current = setTimeout(() => void sendAuthRef.current(undefined, true), Math.max(5_000, lifeMs * 0.8))
    } catch {
      session.end('expired')
    }
  }, [admin, module.audience, send, session])
  useEffect(() => {
    sendAuthRef.current = sendAuth
  }, [sendAuth])

  const onMessage = useCallback((message: ModuleMessage) => {
    switch (message.type) {
      case 'ready': {
        const version = pickVersion(message.payload.supportedVersions)
        if (version === null) {
          send(createMessage('error', { code: 'version_unsupported', message: 'Shazlo One does not support this module version.' }, message.id))
          setState({ kind: 'version', moduleVersion: message.payload.moduleVersion })
          return
        }
        setState({ kind: 'ready' })
        void sendAuth(message.id)
        return
      }
      case 'title': {
        modulePath.current = message.payload.path
        setTitle(message.payload.title)
        document.title = `${message.payload.title} · ${module.title} · Shazlo One`
        const shellPath = module.basePath + message.payload.path
        if (window.location.pathname + window.location.search !== shellPath) navigate(shellPath, { replace: true })
        return
      }
      case 'token:request': {
        const now = Date.now()
        if (now - lastTokenRequest.current < TOKEN_REQUEST_GAP_MS) return
        lastTokenRequest.current = now
        void sendAuth(message.id, true)
        return
      }
      case 'toast':
        notify(message.payload.message)
        return
      case 'logout':
        void signOut().then(() => navigate(paths.signIn, { replace: true }))
        return
      case 'error':
        if (message.payload.fatal) setState({ kind: 'failed' })
        return
    }
  }, [module.basePath, module.title, navigate, notify, send, sendAuth, signOut])

  // The listener is attached in a layout effect, before the iframe can run any script, so an early
  // `ready` is never missed (ADR 0001 §3.1).
  useLayoutEffect(() => listenAsShell({ origin: module.origin, source: () => frame.current?.contentWindow, onMessage }), [module.origin, onMessage])

  // The iframe loads its first URL once per attempt; later URL changes are sent as `navigate`.
  const [firstTarget] = useState(target)
  const src = useMemo(() => new URL(firstTarget.replace(/^\//, ''), module.url).toString(), [firstTarget, module.url])

  useEffect(() => {
    const timer = setTimeout(() => setState((s) => (s.kind === 'loading' ? { kind: attempt >= MAX_ATTEMPTS ? 'unavailable' : 'failed' } : s)), READY_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [attempt])

  // A deep link picked in the shell (sidebar, back button) moves the module without reloading it.
  useEffect(() => {
    if (state.kind !== 'ready' || modulePath.current === null || target === modulePath.current) return
    modulePath.current = target
    send(createMessage('navigate', { path: target }))
  }, [target, state.kind, send])

  useEffect(() => () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
  }, [])

  const retry = () => {
    setState({ kind: 'loading' })
    setAttempt((n) => n + 1)
  }
  const panel = (illustration: 'sheet' | 'box', heading: string, body: string, action: React.ReactNode, note?: string) => (
    <Stack spacing={1.5} role="alert" sx={{ alignItems: 'center', textAlign: 'center', py: 10, px: 3, maxWidth: 560, mx: 'auto' }}>
      <EmptyIllustration name={illustration} />
      <Typography variant="h1" component="h1">{heading}</Typography>
      <Typography variant="body1" color="text.secondary">{body}</Typography>
      {note && <Typography variant="caption" color="text.secondary">{note}</Typography>}
      <Box sx={{ pt: 1 }}>{action}</Box>
    </Stack>
  )

  return (
    <Box sx={{ position: 'relative', height: '100%', minHeight: 'calc(100dvh - var(--shell-top, 56px))' }}>
      {state.kind === 'loading' && (
        <Box role="status" aria-label={copy.loading(module.title)} aria-busy="true" sx={{ position: 'absolute', inset: 0, px: { xs: 2, md: 5 }, pt: { xs: 3, md: 4 }, bgcolor: neutral.canvas, zIndex: 1 }}>
          <Skeleton variant="text" sx={{ width: 320, maxWidth: '100%' }} height={60} />
          <Box sx={{ mt: 3, display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' }, gap: 2 }}>
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} variant="rounded" height={104} />)}
          </Box>
          <Skeleton variant="rounded" height={420} sx={{ mt: 3 }} />
        </Box>
      )}
      {state.kind === 'failed' && panel('sheet', copy.failedTitle(module.title), copy.failedBody, <Button variant="contained" onClick={retry}>{copy.retry}</Button>, copy.attempt(attempt, MAX_ATTEMPTS))}
      {state.kind === 'unavailable' && panel('box', copy.unavailableTitle(module.title), copy.unavailableBody, <Button variant="outlined" onClick={() => navigate(paths.home)}>{copy.backHome}</Button>)}
      {state.kind === 'version' && panel('sheet', copy.versionTitle(module.title, state.moduleVersion), copy.versionBody, <Button variant="contained" onClick={() => window.location.reload()}>{copy.reload}</Button>)}
      {state.kind !== 'unavailable' && state.kind !== 'version' && (
        <Box
          component="iframe"
          key={attempt}
          ref={frame}
          src={src}
          title={module.title}
          sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"
          referrerPolicy="no-referrer"
          allow=""
          sx={{ display: state.kind === 'failed' ? 'none' : 'block', width: '100%', minWidth: 0, height: 'calc(100dvh - var(--shell-top, 56px))', border: 0, bgcolor: neutral.canvas }}
        />
      )}
    </Box>
  )
}
