import {
  createShellChannel,
  isModulePath,
  shellSupportedVersions,
  type ModuleErrorPayload,
  type ReadyInfo,
  type TitlePayload,
  type ToastPayload,
} from '@shazlo/shell-protocol'
import { Alert, Box, Breadcrumbs, Button, CircularProgress, Link as MuiLink, Typography } from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { friendlyError } from '../api/friendlyError'
import { usePageTitle } from '../hooks/usePageTitle'
import { reportModuleFailure } from '../modules/moduleFailure'
import { createRateLimiter } from '../modules/rateLimit'
import { TOKEN_REQUEST_THROTTLE_MS, backoffDelay, refreshDelay } from '../modules/refreshSchedule'
import type { ModuleEntry } from '../modules/registry'
import { modulePathFrom, shellUrlFor } from '../modules/shellPath'
import { useSession } from '../session/AuthProvider'
import { AudienceNotAllowedError, NotSignedInError, UnknownAudienceError, type ModuleToken } from '../session/store'
import { NoAccess } from './NoAccess'
import { useToast } from './ToastProvider'

/** How long a module has to say `ready` after its frame starts loading (ADR 0001, section 7). */
export const READY_TIMEOUT_MS = 10_000
/** After this many failed retries the shell stops offering Retry and says the module is unavailable. */
export const MAX_RETRIES = 3
/** A module may ask for this many toasts in any `TOAST_WINDOW_MS`; more are dropped, so it cannot flood the screen. */
export const MAX_TOASTS_PER_WINDOW = 5
/** A module may report this many `title`s in any window; each can change the address bar, which browsers limit. */
export const MAX_TITLES_PER_WINDOW = 20
export const TOAST_WINDOW_MS = 10_000

/**
 * The frame's `sandbox` (ADR 0001, section 5). Scripts and its own origin (it is a React app that
 * calls its own backend), forms and downloads. No top navigation, popups or modals: a module cannot
 * move the shell, open windows or block with dialogs; it sends a `toast` instead.
 */
export const IFRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-downloads'

type Status =
  | { kind: 'loading' }
  | { kind: 'ready' }
  /** No `ready` in time. Retry reloads the frame. */
  | { kind: 'no-ready' }
  /** No `ready` after every retry. */
  | { kind: 'unavailable' }
  | { kind: 'version'; moduleVersion: string; supportedVersions: number[] }
  /** The token exchange said the admin's roles no longer allow this module. */
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string }
  /** The module sent `error` with `fatal: true`: it is replaced by the shell's own panel. */
  | { kind: 'fatal'; code: string; message: string }
  /** The module sent `logout`: its frame is gone at once, while the session ends. */
  | { kind: 'signingOut' }

/** What the admin is told when the token for the module could not be got. */
function statusForExchangeError(error: unknown): Status {
  if (error instanceof AudienceNotAllowedError) return { kind: 'forbidden' }
  if (error instanceof UnknownAudienceError) return { kind: 'error', message: 'This module is not set up on the server yet.' }
  if (error instanceof NotSignedInError) return { kind: 'error', message: 'Your session has ended. Sign in again.' }
  return { kind: 'error', message: friendlyError(error).message }
}

interface FrameProps {
  entry: ModuleEntry
  /** True once the module has its token: only then is the frame shown. */
  visible: boolean
  onStatus: (status: Status) => void
  /** Where the shell's address says the module should be, as a path inside the module (`/` for its root). */
  deepLink: string
  /**
   * The module reported where it is. Returns the path the shell's address now stands for, or undefined when
   * the report was refused (not a path inside the module, or too many).
   */
  onTitle: (payload: TitlePayload) => string | undefined
  onToast: (payload: ToastPayload) => void
  onModuleError: (payload: ModuleErrorPayload) => void
}

/**
 * One load of the module's frame. It is created fresh for each attempt (the parent gives it a new
 * `key`), so a retry is a new frame and a new listener, never state left over from a failed one.
 */
function HostedFrame({ entry, visible, onStatus, deepLink, onTitle, onToast, onModuleError }: FrameProps) {
  const session = useSession()
  const frame = useRef<HTMLIFrameElement>(null)
  // The latest session and callback without restarting the handshake when they change.
  const sessionRef = useRef(session)
  sessionRef.current = session
  const onStatusRef = useRef(onStatus)
  onStatusRef.current = onStatus
  const handlers = useRef({ onTitle, onToast, onModuleError })
  handlers.current = { onTitle, onToast, onModuleError }
  const deepLinkRef = useRef(deepLink)
  deepLinkRef.current = deepLink
  const channelRef = useRef<ReturnType<typeof createShellChannel> | undefined>(undefined)
  // Whether the module has its token (so it is ready to be told where to go), and the last path the module
  // and the shell agreed on, so a path the module itself reported is never sent back to it.
  const authSent = useRef(false)
  const lastSynced = useRef('')

  useEffect(() => {
    const iframe = frame.current
    if (iframe === null) return
    let disposed = false
    let newest = 0
    // The token the module holds now (the last one sent), the timers that keep it fresh, and how many
    // refreshes in a row have failed.
    let held: ModuleToken | undefined
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    let expiryTimer: ReturnType<typeof setTimeout> | undefined
    let refreshing = false
    let failures = 0
    let lastTokenRequest = Number.NEGATIVE_INFINITY
    const report = (status: Status) => {
      if (!disposed) onStatusRef.current(status)
    }
    // A refused or blocked frame (CSP, framing) is invisible to the parent: it looks like "no ready".
    const timer = setTimeout(() => report({ kind: 'no-ready' }), READY_TIMEOUT_MS)

    /** Sends `auth` for this token and arms the two timers that follow from it. Returns whether it was sent. */
    function deliver(token: ModuleToken, replyTo?: string): boolean {
      const { admin, roles } = sessionRef.current
      if (admin === null) return false
      const sent = channel.sendAuth(
        {
          accessToken: token.accessToken,
          expiresAt: Math.floor(token.expiresAt / 1000),
          user: { id: admin.id, email: admin.email, roles: [...roles] },
        },
        replyTo === undefined ? {} : { replyTo },
      )
      if (!sent) return false
      held = token
      failures = 0
      // Replace it at 80% of its own life, or 30 seconds before it ends, whichever is first...
      clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => void refresh(), refreshDelay(token, Date.now()))
      // ...and if it still could not be replaced by the time it ends, the session is over for this module.
      clearTimeout(expiryTimer)
      expiryTimer = setTimeout(onExpired, Math.max(0, token.expiresAt - Date.now()))
      return true
    }

    /** The module's token ran out and none could be had: the module is removed and the admin signs in again. */
    function onExpired(): void {
      if (disposed) return
      // Ends the session as expired; the guards send the admin to login, back to this module's path.
      sessionRef.current.expireSession()
    }

    /** Gets a new token and sends it. On failure the module keeps the one it has, and the shell tries again. */
    async function refresh(): Promise<void> {
      if (disposed || refreshing) return
      refreshing = true
      clearTimeout(refreshTimer)
      try {
        // Asked for while the old one is still good: a new one, not the cached one.
        const token = await sessionRef.current.getModuleToken(entry.audience, entry.id, { fresh: true })
        if (disposed) return
        if (!deliver(token)) throw new NotSignedInError()
      } catch (error) {
        if (disposed) return
        const status = statusForExchangeError(error)
        // The admin lost the role: this module closes, with the 403 page.
        if (status.kind === 'forbidden') return report(status)
        // The session ended meanwhile: the guards are already removing the page.
        if (error instanceof NotSignedInError) return
        // Anything else (network, a server error): keep what we hold until it ends, and try again soon.
        refreshTimer = setTimeout(() => void refresh(), backoffDelay(failures))
        failures += 1
      } finally {
        refreshing = false
      }
    }

    /**
     * Tells a module that just got its token where the shell's address says it should be. A module (re)starts at
     * its root, so a deep link (`/m/<id>/orders/42`) or a reload mid-way sends `navigate` once it is ready.
     */
    function sendDeepLink(): void {
      authSent.current = true
      const path = deepLinkRef.current
      lastSynced.current = path
      if (path !== '/' && isModulePath(path)) channel.sendNavigate(path)
    }

    async function answer(info: ReadyInfo): Promise<void> {
      // The module is alive: stop waiting for it. A second `ready` (the module reloaded) comes here
      // too and gets the current token, from the cache while it is still good.
      clearTimeout(timer)
      const mine = (newest += 1)
      try {
        // A token for this module's own audience, kept for this module only (its id is the scope).
        const token = await sessionRef.current.getModuleToken(entry.audience, entry.id)
        if (disposed || mine !== newest) return
        if (sessionRef.current.admin === null) throw new NotSignedInError()
        const sent = deliver(token, info.id)
        if (sent) sendDeepLink()
        report(sent ? { kind: 'ready' } : { kind: 'error', message: 'The session could not be sent to the module.' })
      } catch (error) {
        if (disposed || mine !== newest) return
        report(statusForExchangeError(error))
      }
    }

    // The listener goes up first (createShellChannel registers it), so an early `ready` is never missed.
    const channel = createShellChannel({
      iframe,
      origin: entry.origin,
      development: import.meta.env.DEV,
      onReady: (info) => void answer(info),
      onVersionUnsupported: (info) => {
        clearTimeout(timer)
        report({ kind: 'version', moduleVersion: info.moduleVersion, supportedVersions: info.supportedVersions })
      },
      // Nothing a module sends counts once it is on its way out (it signed out, or failed for good).
      onTitle: (payload) => {
        if (disposed) return
        const synced = handlers.current.onTitle(payload)
        if (synced !== undefined) lastSynced.current = synced
      },
      onToast: (payload) => {
        if (!disposed) handlers.current.onToast(payload)
      },
      // The admin chose to sign out inside the module: the session ends (the refresh token is revoked) and the
      // guards send the admin to sign in. The frame goes at once, not when the server answers, so the module
      // can do nothing more meanwhile; and only the first `logout` counts.
      onLogout: () => {
        if (disposed) return
        void sessionRef.current.logout()
        clearTimeout(timer)
        report({ kind: 'signingOut' })
        disposed = true
      },
      onModuleError: (payload) => {
        if (disposed) return
        if (payload.fatal) {
          clearTimeout(timer)
          report({ kind: 'fatal', code: payload.code, message: payload.message })
          disposed = true
        } else {
          handlers.current.onModuleError(payload)
        }
      },
      // A module that got a 401 asks for a new token. At most one answer every 30 seconds, whatever it sends.
      onTokenRequest: () => {
        const now = Date.now()
        if (held === undefined || now - lastTokenRequest < TOKEN_REQUEST_THROTTLE_MS) return
        lastTokenRequest = now
        void refresh()
      },
    })
    channelRef.current = channel
    // Only now does the frame get its address: exactly the registry's `url`, never anything token-like.
    iframe.src = entry.url

    return () => {
      disposed = true
      authSent.current = false
      channelRef.current = undefined
      clearTimeout(timer)
      clearTimeout(refreshTimer)
      clearTimeout(expiryTimer)
      channel.dispose()
      // The page is left (or the frame is reloaded): the module's tokens go with it.
      sessionRef.current.dropModuleTokens(entry.id)
    }
  }, [entry])

  // The address changed under a module that is running (the browser's back or forward, or a link into another
  // page of the module): move the module too. Not when the module itself reported that path.
  useEffect(() => {
    if (!authSent.current || deepLink === lastSynced.current) return
    lastSynced.current = deepLink
    if (isModulePath(deepLink)) channelRef.current?.sendNavigate(deepLink)
  }, [deepLink])

  return (
    <iframe
      ref={frame}
      title={entry.title}
      sandbox={IFRAME_SANDBOX}
      referrerPolicy="no-referrer"
      allow=""
      // Hidden, but loading, until the module has its token.
      style={{ width: '100%', border: 0, height: visible ? 'calc(100vh - 160px)' : 0, minHeight: visible ? 480 : 0, visibility: visible ? 'visible' : 'hidden' }}
    />
  )
}

function Panel({ title, children, retry }: { title: string; children: string; retry?: () => void }) {
  return (
    <Alert severity="error" role="alert" sx={{ alignItems: 'flex-start' }} action={retry ? <Button color="inherit" onClick={retry}>Retry</Button> : undefined}>
      <Typography component="h2" variant="h6" gutterBottom>
        {title}
      </Typography>
      {/* What a module said can be one long word: wrap it rather than widen the page. */}
      <Typography sx={{ overflowWrap: 'anywhere' }}>{children}</Typography>
    </Alert>
  )
}

/**
 * A module in its frame (ADR 0001, sections 3 to 7). The frame loads while the shell shows a loading
 * state; the shell's own chrome (navigation, account menu) stays usable throughout. The module gets a
 * token only after it has said `ready`, from its exact origin and window; one that does not answer in
 * 10 seconds gets an error panel with Retry, and after 3 failed retries "unavailable". A module that
 * speaks no common version, or whose token cannot be got, gets a panel that says why.
 */
export function ModuleHost({ entry }: { entry: ModuleEntry }) {
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState<Status>({ kind: 'loading' })
  /** The title of the page the module reported it is on (the breadcrumb and the tab title follow it). */
  const [pageTitle, setPageTitle] = useState<string | undefined>()
  const failures = useRef(0)
  const location = useLocation()
  const navigate = useNavigate()
  const toast = useToast()
  const locationRef = useRef(location)
  locationRef.current = location
  const deepLink = modulePathFrom(entry.id, location)
  // Limits on what a module can make the shell do: a flood of toasts or of address changes is dropped.
  const toastAllowed = useRef(createRateLimiter({ max: MAX_TOASTS_PER_WINDOW, windowMs: TOAST_WINDOW_MS })).current
  const titleAllowed = useRef(createRateLimiter({ max: MAX_TITLES_PER_WINDOW, windowMs: TOAST_WINDOW_MS })).current
  const tabTitle = pageTitle !== undefined && pageTitle !== entry.title ? `${pageTitle} · ${entry.title}` : entry.title
  usePageTitle(status.kind === 'forbidden' ? "You don't have access" : tabTitle)

  /**
   * The module says where it is. The shell shows it in the breadcrumb and the tab title and puts it in its own
   * address (`/m/<id>/<path>`) **replacing** the current entry, so each step does not add a history entry. The
   * path is checked first: it must stay inside this module's address, or it is ignored.
   */
  const handleTitle = useCallback(
    (payload: TitlePayload): string | undefined => {
      if (!titleAllowed()) return undefined
      const url = shellUrlFor(entry.id, payload.path)
      if (url === undefined) return undefined
      setPageTitle(payload.title)
      const here = locationRef.current
      if (url !== `${here.pathname}${here.search}${here.hash}`) void navigate(url, { replace: true })
      const target = new URL(url, 'https://shell.invalid')
      return modulePathFrom(entry.id, { pathname: target.pathname, search: target.search, hash: target.hash })
    },
    [entry.id, navigate, titleAllowed],
  )

  /** A module's toast, shown by the shell's own component, labelled with the module it came from. */
  const handleToast = useCallback(
    (payload: ToastPayload) => {
      if (!toastAllowed()) return
      toast.show({ level: payload.level, message: payload.message, source: entry.title, ...(payload.durationMs === undefined ? {} : { durationMs: payload.durationMs }) })
    },
    [entry.title, toast, toastAllowed],
  )

  /** A non-fatal error: logged in development, and the admin gets a notice (it counts against the toast limit). */
  const handleModuleError = useCallback(
    (payload: ModuleErrorPayload) => {
      if (import.meta.env.DEV) console.error(`[shell] ${entry.id} reported a non-fatal error (${payload.code}): ${payload.message}`)
      if (!toastAllowed()) return
      toast.show({ level: 'warning', message: `Something went wrong: ${payload.message}`.slice(0, 280), source: entry.title })
    },
    [entry.id, entry.title, toast, toastAllowed],
  )

  const handle = useCallback(
    (next: Status) => {
      let resolved = next
      if (next.kind === 'ready') failures.current = 0
      if (next.kind === 'no-ready') {
        failures.current += 1
        if (failures.current > MAX_RETRIES) {
          reportModuleFailure({ moduleId: entry.id, reason: 'no_ready', attempts: failures.current })
          resolved = { kind: 'unavailable' }
        }
      }
      setStatus(resolved)
    },
    [entry.id],
  )

  const retry = () => {
    setStatus({ kind: 'loading' })
    setPageTitle(undefined)
    setAttempt((value) => value + 1)
  }

  // The admin lost the role: the same page as typing a module they may not open. No frame.
  if (status.kind === 'forbidden') return <NoAccess what="module" />

  const framed = status.kind === 'loading' || status.kind === 'ready'
  return (
    <Box>
      <Breadcrumbs aria-label="Breadcrumb" sx={{ mb: 1 }}>
        <MuiLink component={Link} to="/" underline="hover" color="inherit">
          Home
        </MuiLink>
        {pageTitle !== undefined && pageTitle !== entry.title ? (
          <MuiLink component={Link} to={`/m/${entry.id}`} underline="hover" color="inherit">
            {entry.title}
          </MuiLink>
        ) : (
          <Typography aria-current="page">{entry.title}</Typography>
        )}
        {pageTitle !== undefined && pageTitle !== entry.title ? <Typography aria-current="page">{pageTitle}</Typography> : null}
      </Breadcrumbs>

      <Typography component="h1" variant="h4" gutterBottom tabIndex={-1}>
        {entry.title}
      </Typography>

      {status.kind === 'loading' ? (
        <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 2 }}>
          <CircularProgress size={24} />
          <Typography>Loading {entry.title}…</Typography>
        </Box>
      ) : null}

      {status.kind === 'signingOut' ? (
        <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 2 }}>
          <CircularProgress size={24} />
          <Typography>Signing out…</Typography>
        </Box>
      ) : null}

      {status.kind === 'no-ready' ? (
        <Panel title={`${entry.title} did not respond`} retry={retry}>
          It did not answer within 10 seconds. It may still be starting, may be blocked from loading here, or may be down. Nothing from your session was sent to it.
        </Panel>
      ) : null}

      {status.kind === 'unavailable' ? (
        <Box>
          <Panel title={`${entry.title} is unavailable`}>
            It did not respond after several tries. Reload this page to try again, or tell the platform team if it keeps happening.
          </Panel>
          <Button component={Link} to="/" sx={{ mt: 2 }}>
            Go to the home page
          </Button>
        </Box>
      ) : null}

      {status.kind === 'version' ? (
        <Panel title={`${entry.title} cannot talk to this shell`} retry={retry}>
          {`${entry.title} (version ${status.moduleVersion}) speaks protocol version ${status.supportedVersions.join(', ')}; this shell speaks ${shellSupportedVersions().join(', ')}. One of them needs updating.`}
        </Panel>
      ) : null}

      {status.kind === 'error' ? (
        <Panel title={`${entry.title} could not be opened`} retry={retry}>
          {status.message}
        </Panel>
      ) : null}

      {status.kind === 'fatal' ? (
        <Panel title={`${entry.title} stopped working`} retry={retry}>
          {`It reported a problem it could not recover from (${status.code}): ${status.message}`}
        </Panel>
      ) : null}

      {framed ? (
        <HostedFrame
          key={attempt}
          entry={entry}
          visible={status.kind === 'ready'}
          onStatus={handle}
          deepLink={deepLink}
          onTitle={handleTitle}
          onToast={handleToast}
          onModuleError={handleModuleError}
        />
      ) : null}
    </Box>
  )
}
