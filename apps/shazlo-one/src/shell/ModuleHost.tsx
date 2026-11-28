import { Box, Button, Skeleton, Stack, Typography } from '@mui/material'
import { EmptyIllustration, EmptyState, neutral, useSnackbar } from '@shazlo/ui'
import { createShellChannel, isModulePath, type ReadyInfo, type ShellChannel, type TitlePayload } from '@shazlo/shell-protocol'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Link as RouterLink, useLocation, useNavigate } from 'react-router'
import { useAppContext } from '../api/context'
import { paths } from '../app/paths'
import { moduleTarget, type ResolvedModule } from '../app/registry'
import { useCrumb } from '../app/crumbs'
import { shellCopy } from '../copy/shell'
import { AudienceNotAllowedError, NotSignedInError, UnknownAudienceError, type ModuleToken } from '../session/store'
import { useSession } from '../session/useSession'
import { MODULE_TEXT, moduleText } from './moduleText'
import { backoffDelay, refreshDelay, TOKEN_REQUEST_THROTTLE_MS } from './refreshSchedule'

const copy = shellCopy.module
/** How long a module has to say `ready` after its frame starts loading (ADR 0001 §7). */
export const READY_TIMEOUT_MS = 10_000
/** Loads before the shell stops offering Try again and says the module is unavailable. */
export const MAX_ATTEMPTS = 3

/**
 * The frame's sandbox (ADR 0001 §5): scripts and its own origin (a React app calling its own
 * backend), forms and downloads. No top navigation, popups or modals: a module cannot move the shell,
 * open windows or block with dialogs; it sends a `toast` instead. `allow-scripts` with
 * `allow-same-origin` is only safe because a module is on an origin of its own, so the host never
 * frames a module on the shell's origin (it could lift its own sandbox and reach the shell's memory).
 */
export const IFRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-downloads'

type State =
  | { kind: 'loading' }
  | { kind: 'ready' }
  /** No `ready` in time, or the module said it cannot go on. Try again reloads the frame. */
  | { kind: 'failed'; message?: string }
  | { kind: 'unavailable' }
  | { kind: 'version'; moduleVersion: string }
  /** The token exchange said the admin's roles do not allow this module. */
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string }
  /** The module signed the admin out: its frame is gone at once. */
  | { kind: 'ended' }

/** The address the frame loads: the module path of this URL, kept on the module's own origin. */
export function frameSrc(module: Pick<ResolvedModule, 'url' | 'origin' | 'home'>, target: string): string {
  // The URL is the admin's to type, so it is checked like a path a module sends: anything that could
  // climb out of the module ("//host", "/\host", "/../") loads the module's home page instead.
  const path = isModulePath(target) ? target : isModulePath(module.home.path) ? module.home.path : '/'
  try {
    const url = new URL(path.replace(/^\//, ''), module.url)
    return url.origin === module.origin ? url.toString() : module.url
  } catch {
    return module.url
  }
}

function statusForExchangeError(error: unknown): State {
  if (error instanceof AudienceNotAllowedError) return { kind: 'forbidden' }
  if (error instanceof UnknownAudienceError) return { kind: 'error', message: copy.unknownAudience }
  if (error instanceof NotSignedInError) return { kind: 'error', message: shellCopy.expired }
  return { kind: 'error', message: error instanceof Error && error.message ? error.message : copy.noToken }
}

interface FrameProps {
  module: ResolvedModule
  src: string
  /** The module page this URL shows (with its query). Later changes are sent as `navigate`. */
  target: string
  firstTarget: string
  covered: boolean
  onStatus: (state: State) => void
  onTitle: (title: string) => void
  onLogout: () => void
}

/**
 * One load of the module's frame, created afresh for every attempt (and for another admin), so a retry
 * is a new frame, a new channel and new tokens, never state left over from a failed one.
 */
function HostedFrame({ module, src, target, firstTarget, covered, onStatus, onTitle, onLogout }: FrameProps) {
  const { session } = useAppContext()
  const { admin } = useSession()
  const notify = useSnackbar()
  const navigate = useNavigate()
  const frame = useRef<HTMLIFrameElement>(null)
  const channelRef = useRef<ShellChannel | null>(null)
  // The module path the module last said it shows; null until its first title of this load.
  const modulePath = useRef<string | null>(null)
  const ready = useRef(false)
  const onRolesChanged = useRef<(roles: string) => void>(undefined)

  // The latest props and session, without restarting the handshake when they change.
  const latest = useRef({ admin, target, firstTarget, onStatus, onTitle, onLogout, notify, navigate })
  useLayoutEffect(() => {
    latest.current = { admin, target, firstTarget, onStatus, onTitle, onLogout, notify, navigate }
  })

  useLayoutEffect(() => {
    const iframe = frame.current
    if (!iframe) return
    let disposed = false
    let newest = 0
    // The token the module holds (the last one sent), the roles it was sent with, the timers that keep
    // it fresh, and how many refreshes in a row have failed.
    let held: ModuleToken | undefined
    let heldRoles = ''
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    let expiryTimer: ReturnType<typeof setTimeout> | undefined
    let refreshing = false
    let refreshAgain = false
    let failures = 0
    let lastTokenRequest = Number.NEGATIVE_INFINITY
    // The module said it cannot go on: nothing of this load may bring it back (only Try again does).
    let stopped = false
    const report = (state: State) => {
      if (!disposed && !stopped) latest.current.onStatus(state)
    }
    // A frame the browser refused (CSP, framing rules) is silent to the parent: it looks like no `ready`.
    const readyTimer = setTimeout(() => report({ kind: 'failed' }), READY_TIMEOUT_MS)

    /** Sends `auth` for this token and arms the timers that follow from it. */
    function deliver(token: ModuleToken, replyTo?: string): boolean {
      const who = latest.current.admin
      if (!who) return false
      const sent = channel.sendAuth(
        { accessToken: token.accessToken, expiresAt: Math.floor(token.expiresAt / 1000), user: { id: who.id, email: who.email, roles: [...who.roles] }, locale: 'en-IN' },
        replyTo === undefined ? {} : { replyTo },
      )
      if (!sent) return false
      heldRoles = who.roles.join(' ')
      // The token it already holds (a replayed `ready`): its timers and the backoff carry on as they
      // were, so `ready` cannot cut a backoff short or force an exchange.
      if (token === held) return true
      held = token
      failures = 0
      // Replaced at 80% of its own life or 30 seconds before it ends, whichever is first...
      clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => void refresh(), refreshDelay(token, Date.now()))
      // ...and if it could not be replaced by the time it ends, the session is over.
      clearTimeout(expiryTimer)
      expiryTimer = setTimeout(() => {
        if (!disposed) session.expire()
      }, Math.max(0, token.expiresAt - Date.now()))
      return true
    }

    /** A new token for the module. On failure it keeps the one it has, and the shell tries again soon. */
    async function refresh(): Promise<void> {
      if (disposed || refreshing) return
      refreshing = true
      clearTimeout(refreshTimer)
      try {
        const token = await session.getModuleToken(module.audience, module.id, { fresh: true })
        if (disposed) return
        if (!deliver(token)) throw new NotSignedInError()
      } catch (error) {
        if (disposed) return
        const state = statusForExchangeError(error)
        // The admin lost the role: the module closes, with the 403 page.
        if (state.kind === 'forbidden') return report(state)
        // Anything else (network, a server error): keep what it holds until it ends, and try again at
        // 5, 15 and then every 30 seconds. A session that ended removes this page and its timers.
        refreshTimer = setTimeout(() => void refresh(), backoffDelay(failures))
        failures += 1
      } finally {
        refreshing = false
        if (refreshAgain && !disposed) {
          refreshAgain = false
          void refresh()
        }
      }
    }

    onRolesChanged.current = (roles) => {
      if (disposed || held === undefined || roles === heldRoles) return
      if (refreshing) refreshAgain = true
      else void refresh()
    }

    async function answer(info: ReadyInfo): Promise<void> {
      // The module is alive. A second `ready` (it reloaded) gets the token it was last sent while that
      // is good: no exchange.
      clearTimeout(readyTimer)
      const mine = (newest += 1)
      try {
        // A token for this module's audience, kept for this module only (its id is the scope).
        const token = held !== undefined && held.expiresAt > Date.now() ? held : await session.getModuleToken(module.audience, module.id)
        if (disposed || stopped || mine !== newest) return
        if (!deliver(token, info.id)) return report({ kind: 'error', message: copy.noToken })
        ready.current = true
        report({ kind: 'ready' })
      } catch (error) {
        if (disposed || mine !== newest) return
        report(statusForExchangeError(error))
      }
    }

    function onModuleTitle({ path, title }: TitlePayload): void {
      const { target: wanted, firstTarget: first } = latest.current
      // The first title of a load names the page the module opened on. If the admin picked another
      // page while it loaded (top bar, sidebar, Back), the module is taken there, rather than the shell
      // URL being moved back to the page the module started on.
      if (modulePath.current === null && wanted !== first && path !== wanted) {
        modulePath.current = wanted
        channel.sendNavigate(wanted)
        return
      }
      modulePath.current = path
      const name = moduleText(title, MODULE_TEXT.title)
      latest.current.onTitle(name)
      document.title = `${name} · ${module.title} · Shazlo One`
      // `path` is a module path (the channel refused anything else), so this stays inside the module.
      const shellPath = module.basePath + path
      if (window.location.pathname + window.location.search !== shellPath) latest.current.navigate(shellPath, { replace: true })
    }

    // The listener goes up here, before the frame has an address, so an early `ready` is never missed.
    // The channel accepts a message only from the module's exact origin and this frame's window, and
    // posts only to that origin.
    const channel = createShellChannel({
      iframe,
      origin: module.origin,
      development: import.meta.env.DEV,
      onReady: (info) => void answer(info),
      onVersionUnsupported: (info) => {
        // The channel has already answered `version_unsupported`.
        clearTimeout(readyTimer)
        report({ kind: 'version', moduleVersion: moduleText(info.moduleVersion, { maxLength: 20, maxLines: 1 }) })
      },
      onTitle: onModuleTitle,
      // A module that got a 401 asks for a new token: answered at most once every 30 seconds, and only
      // once it holds one.
      onTokenRequest: () => {
        const now = Date.now()
        if (held === undefined || now - lastTokenRequest < TOKEN_REQUEST_THROTTLE_MS) return
        lastTokenRequest = now
        void refresh()
      },
      onToast: ({ message }) => latest.current.notify(moduleText(message, MODULE_TEXT.toast)),
      onLogout: () => latest.current.onLogout(),
      onModuleError: ({ message, fatal }) => {
        if (!fatal) return
        report({ kind: 'failed', message: moduleText(message, MODULE_TEXT.error) })
        stopped = true
        clearTimeout(readyTimer)
        clearTimeout(refreshTimer)
      },
    })
    channelRef.current = channel
    iframe.src = src

    return () => {
      disposed = true
      clearTimeout(readyTimer)
      clearTimeout(refreshTimer)
      clearTimeout(expiryTimer)
      channel.dispose()
      if (channelRef.current === channel) channelRef.current = null
      // The page is left, or the frame is reloaded: the module's tokens go with it.
      session.dropModuleTokens(module.id)
    }
    // A new load is a new component (the parent keys it), so this runs once per load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A renewal that changes the admin's roles: the token the module holds carries the old ones.
  const roles = admin?.roles.join(' ') ?? ''
  useEffect(() => onRolesChanged.current?.(roles), [roles])

  // A page picked in the shell (sidebar, top bar, Back) moves the module without reloading it. One
  // picked before the module's first title is sent from the title handler.
  useEffect(() => {
    if (!ready.current || modulePath.current === null || target === modulePath.current) return
    modulePath.current = target
    channelRef.current?.sendNavigate(target)
  }, [target])

  return (
    <Box
      component="iframe"
      ref={frame}
      title={module.title}
      sandbox={IFRAME_SANDBOX}
      referrerPolicy="no-referrer"
      allow=""
      sx={{ display: covered ? 'none' : 'block', width: '100%', minWidth: 0, height: 'calc(100dvh - var(--shell-top, 56px))', border: 0, bgcolor: neutral.canvas }}
    />
  )
}

/**
 * A module in its frame (ADR 0001 §3 to §7). The shell's own chrome stays usable throughout. The
 * module gets a token only after it has said `ready` from its exact origin and window; one that does
 * not answer in 10 seconds gets Try again, and after three loads "unavailable". A module that speaks no
 * common version, whose token cannot be had, or that the admin's roles no longer allow gets a page
 * that says why, and no frame.
 */
export function ModuleHost({ module }: { module: ResolvedModule }) {
  const { admin, signOut } = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(1)
  const [title, setTitle] = useState<string | null>(null)
  const loggedOut = useRef(false)
  useCrumb(title)

  // The module page this URL shows; the bare base path opens the module on its home page.
  const target = (moduleTarget(module, location.pathname) ?? module.home.path) + location.search
  // The frame loads its first URL once per load; later URL changes are sent as `navigate`.
  const [load, setLoad] = useState({ attempt, firstTarget: target })
  if (load.attempt !== attempt) setLoad({ attempt, firstTarget: target })
  const src = frameSrc(module, load.firstTarget)

  // Another admin now holds the session (another tab signed out and in): a new frame, so nothing the
  // module was given for the previous admin survives.
  const adminId = admin?.id
  const [frameAdmin, setFrameAdmin] = useState(adminId)
  if (frameAdmin !== adminId) {
    setFrameAdmin(adminId)
    setState({ kind: 'loading' })
    setAttempt((n) => n + 1)
  }

  const onStatus = useCallback(
    (next: State) => {
      // No `ready` in time: Try again until the last load, then "unavailable" (the frame goes).
      if (next.kind === 'failed' && next.message === undefined && attempt >= MAX_ATTEMPTS) setState({ kind: 'unavailable' })
      else setState(next)
    },
    [attempt],
  )

  const onLogout = useCallback(() => {
    // Acted on once: the frame is removed at once, so it cannot send anything else.
    if (loggedOut.current) return
    loggedOut.current = true
    setState({ kind: 'ended' })
    void signOut().then(() => navigate(paths.signIn, { replace: true }))
  }, [navigate, signOut])

  const retry = () => {
    setState({ kind: 'loading' })
    setTitle(null)
    setAttempt((n) => n + 1)
  }

  const panel = (illustration: 'sheet' | 'box', heading: string, body: string, action: ReactNode, note?: string) => (
    <Stack spacing={1.5} role="alert" sx={{ alignItems: 'center', textAlign: 'center', py: 10, px: 3, maxWidth: 560, mx: 'auto' }}>
      <EmptyIllustration name={illustration} />
      <Typography variant="h1" component="h1" sx={{ overflowWrap: 'anywhere' }}>{heading}</Typography>
      <Typography variant="body1" color="textSecondary">{body}</Typography>
      {note && <Typography variant="caption" color="textSecondary" sx={{ overflowWrap: 'anywhere', whiteSpace: 'pre-line' }}>{note}</Typography>}
      <Box sx={{ pt: 1 }}>{action}</Box>
    </Stack>
  )

  // Never framed with this sandbox (see IFRAME_SANDBOX): the registry entry is wrong. No frame, no token.
  if (module.origin === window.location.origin) {
    return panel('sheet', copy.sameOriginTitle(module.title), copy.sameOriginBody, <Button variant="outlined" component={RouterLink} to={paths.home}>{copy.backHome}</Button>)
  }
  // The admin lost the role: the same page as opening a module the roles do not allow.
  if (state.kind === 'forbidden') {
    return <EmptyState illustration="sheet" title={copy.forbiddenTitle(module.title)} body={copy.forbiddenBody} action={<Button variant="outlined" component={RouterLink} to={paths.home}>{copy.backHome}</Button>} />
  }

  const framed = state.kind === 'loading' || state.kind === 'ready' || state.kind === 'failed'
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
      {state.kind === 'failed' &&
        panel('sheet', copy.failedTitle(module.title), state.message === undefined ? copy.failedBody : copy.moduleErrorBody, <Button variant="contained" onClick={retry}>{copy.retry}</Button>, [state.message, copy.attempt(attempt, MAX_ATTEMPTS)].filter(Boolean).join('\n'))}
      {state.kind === 'unavailable' && panel('box', copy.unavailableTitle(module.title), copy.unavailableBody, <Button variant="outlined" onClick={() => navigate(paths.home)}>{copy.backHome}</Button>)}
      {state.kind === 'version' && panel('sheet', copy.versionTitle(module.title, state.moduleVersion), copy.versionBody, <Button variant="contained" onClick={() => window.location.reload()}>{copy.reload}</Button>)}
      {state.kind === 'error' && panel('sheet', copy.noTokenTitle(module.title), state.message, <Button variant="contained" onClick={retry}>{copy.retry}</Button>)}
      {framed && (
        <HostedFrame
          key={`${attempt}:${frameAdmin ?? ''}`}
          module={module}
          src={src}
          target={target}
          firstTarget={load.firstTarget}
          covered={state.kind === 'failed'}
          onStatus={onStatus}
          onTitle={setTitle}
          onLogout={onLogout}
        />
      )}
    </Box>
  )
}
