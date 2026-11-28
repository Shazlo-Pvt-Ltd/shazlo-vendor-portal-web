import { Box, Button, Skeleton, Stack, Typography } from '@mui/material'
import { EmptyIllustration, neutral, useSnackbar } from '@shazlo/ui'
import { createShellChannel, type ReadyInfo, type ShellChannel, type TitlePayload } from '@shazlo/shell-protocol'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useAppContext } from '../api/context'
import { paths } from '../app/paths'
import { moduleTarget, type ResolvedModule } from '../app/registry'
import { useCrumb } from '../app/crumbs'
import { shellCopy } from '../copy/shell'
import { useSession } from '../session/useSession'

const copy = shellCopy.module
export const READY_TIMEOUT_MS = 10_000
export const MAX_ATTEMPTS = 3
const TOKEN_REQUEST_GAP_MS = 30_000

type State = { kind: 'loading' } | { kind: 'ready' } | { kind: 'failed' } | { kind: 'unavailable' } | { kind: 'version'; moduleVersion: string }

// Hosts one module in an iframe and speaks ADR 0001 with it through @shazlo/shell-protocol: ready →
// auth, token refresh, title and URL sync, toasts, logout, and the 10-second / three-attempt failure
// handling.
export function ModuleHost({ module }: { module: ResolvedModule }) {
  const { session } = useAppContext()
  const { admin, signOut } = useSession()
  const notify = useSnackbar()
  const navigate = useNavigate()
  const location = useLocation()
  const frame = useRef<HTMLIFrameElement>(null)
  const channel = useRef<ShellChannel | null>(null)
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(1)
  const [title, setTitle] = useState<string | null>(null)
  const modulePath = useRef<string | null>(null)
  const lastTokenRequest = useRef(0)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sendAuthRef = useRef<(replyTo?: string, force?: boolean) => Promise<void>>(async () => {})
  useCrumb(title)

  // The module page this URL shows; the bare base path opens the module on its home page.
  const target = (moduleTarget(module, location.pathname) ?? module.home.path) + location.search
  const targetRef = useRef(target)
  useLayoutEffect(() => {
    targetRef.current = target
  }, [target])
  // The iframe loads its first URL once; later URL changes are sent as `navigate`.
  const [firstTarget] = useState(target)

  // Pushes a fresh token before the current one runs out (80% of its life, ADR 0001 §3.5).
  const sendAuth = useCallback(async (replyTo?: string, force = false) => {
    if (!admin) return
    try {
      const { token, expiresAt } = await session.moduleToken(module.audience, force)
      channel.current?.sendAuth({ accessToken: token, expiresAt, user: { id: admin.id, email: admin.email, roles: admin.roles }, locale: 'en-IN' }, replyTo === undefined ? {} : { replyTo })
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      const lifeMs = (expiresAt - Date.now() / 1000) * 1000
      refreshTimer.current = setTimeout(() => void sendAuthRef.current(undefined, true), Math.max(5_000, lifeMs * 0.8))
    } catch {
      session.end('expired')
    }
  }, [admin, module.audience, session])
  useEffect(() => {
    sendAuthRef.current = sendAuth
  }, [sendAuth])

  // What the module says. The channel has already checked the sender's origin and window, the size,
  // the protocol, the version and the payload.
  const handlers = {
    ready: (info: ReadyInfo) => {
      setState({ kind: 'ready' })
      void sendAuth(info.id)
    },
    // The channel has already answered `version_unsupported`.
    versionUnsupported: (moduleVersion: string) => setState({ kind: 'version', moduleVersion }),
    title: ({ path, title: name }: TitlePayload) => {
      // The first title of a load names the page the module opened on. If the admin picked another
      // page while it loaded (top bar, sidebar, Back), the module is taken there, rather than the
      // shell URL being moved back to the page the module started on.
      const wanted = targetRef.current
      if (modulePath.current === null && wanted !== firstTarget && path !== wanted) {
        modulePath.current = wanted
        channel.current?.sendNavigate(wanted)
        return
      }
      modulePath.current = path
      setTitle(name)
      document.title = `${name} · ${module.title} · Shazlo One`
      const shellPath = module.basePath + path
      if (window.location.pathname + window.location.search !== shellPath) navigate(shellPath, { replace: true })
    },
    tokenRequest: (id: string) => {
      const now = Date.now()
      if (now - lastTokenRequest.current < TOKEN_REQUEST_GAP_MS) return
      lastTokenRequest.current = now
      void sendAuth(id, true)
    },
    toast: (message: string) => notify(message),
    logout: () => void signOut().then(() => navigate(paths.signIn, { replace: true })),
    error: (fatal: boolean) => {
      if (fatal) setState({ kind: 'failed' })
    },
  }
  const handlersRef = useRef(handlers)
  useLayoutEffect(() => {
    handlersRef.current = handlers
  })

  const src = useMemo(() => new URL(firstTarget.replace(/^\//, ''), module.url).toString(), [firstTarget, module.url])

  // One channel per load of the frame (ADR 0001 §3.1). It listens from the moment it is created, and
  // only then does the frame get its address, so an early `ready` is never missed.
  useLayoutEffect(() => {
    const iframe = frame.current
    if (!iframe) return
    const on = () => handlersRef.current
    const created = createShellChannel({
      iframe,
      origin: module.origin,
      development: import.meta.env.DEV,
      onReady: (info) => on().ready(info),
      onVersionUnsupported: (info) => on().versionUnsupported(info.moduleVersion),
      onTitle: (payload) => on().title(payload),
      onTokenRequest: (_payload, message) => on().tokenRequest(message.id),
      onToast: (payload) => on().toast(payload.message),
      onLogout: () => on().logout(),
      onModuleError: (payload) => on().error(payload.fatal),
    })
    channel.current = created
    iframe.src = src
    return () => {
      created.dispose()
      if (channel.current === created) channel.current = null
    }
  }, [attempt, module.origin, src])

  useEffect(() => {
    const timer = setTimeout(() => setState((s) => (s.kind === 'loading' ? { kind: attempt >= MAX_ATTEMPTS ? 'unavailable' : 'failed' } : s)), READY_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [attempt])

  // A deep link picked in the shell (sidebar, top bar, back button) moves the module without
  // reloading it. One picked before the module's first title is sent from the title handler.
  useEffect(() => {
    if (state.kind !== 'ready' || modulePath.current === null || target === modulePath.current) return
    modulePath.current = target
    channel.current?.sendNavigate(target)
  }, [target, state.kind])

  useEffect(() => () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
  }, [])

  const retry = () => {
    // The reloaded module reports its page afresh, so its first title is a first title again.
    modulePath.current = null
    setState({ kind: 'loading' })
    setAttempt((n) => n + 1)
  }
  const panel = (illustration: 'sheet' | 'box', heading: string, body: string, action: React.ReactNode, note?: string) => (
    <Stack spacing={1.5} role="alert" sx={{ alignItems: 'center', textAlign: 'center', py: 10, px: 3, maxWidth: 560, mx: 'auto' }}>
      <EmptyIllustration name={illustration} />
      <Typography variant="h1" component="h1">{heading}</Typography>
      <Typography variant="body1" color="textSecondary">{body}</Typography>
      {note && <Typography variant="caption" color="textSecondary">{note}</Typography>}
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
