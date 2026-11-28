import { shellSupportedVersions, createShellChannel, type ReadyInfo } from '@shazlo/shell-protocol'
import { Alert, Box, Button, CircularProgress, Typography } from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { friendlyError } from '../api/friendlyError'
import { usePageTitle } from '../hooks/usePageTitle'
import { reportModuleFailure } from '../modules/moduleFailure'
import type { ModuleEntry } from '../modules/registry'
import { useSession } from '../session/AuthProvider'
import { AudienceNotAllowedError, NotSignedInError, UnknownAudienceError } from '../session/store'
import { NoAccess } from './NoAccess'

/** How long a module has to say `ready` after its frame starts loading (ADR 0001, section 7). */
export const READY_TIMEOUT_MS = 10_000
/** After this many failed retries the shell stops offering Retry and says the module is unavailable. */
export const MAX_RETRIES = 3

/**
 * The frame's `sandbox` (ADR 0001, section 5). Scripts and its own origin (it is a React app that
 * calls its own backend), forms and downloads. No top navigation, popups or modals: a module cannot
 * move the shell, open windows or block with dialogs; it sends a `toast` instead.
 *
 * `allow-scripts` with `allow-same-origin` is only safe because a module is on an origin of its own: a
 * page on the shell's origin could remove its own sandbox and reach the shell's memory, token included.
 * So the host never frames a module whose origin is the shell's.
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
}

/**
 * One load of the module's frame. It is created fresh for each attempt (the parent gives it a new
 * `key`), so a retry is a new frame and a new listener, never state left over from a failed one.
 */
function HostedFrame({ entry, visible, onStatus }: FrameProps) {
  const session = useSession()
  const frame = useRef<HTMLIFrameElement>(null)
  // The latest session and callback without restarting the handshake when they change.
  const sessionRef = useRef(session)
  sessionRef.current = session
  const onStatusRef = useRef(onStatus)
  onStatusRef.current = onStatus

  useEffect(() => {
    const iframe = frame.current
    if (iframe === null) return
    let disposed = false
    let newest = 0
    const report = (status: Status) => {
      if (!disposed) onStatusRef.current(status)
    }
    // A refused or blocked frame (CSP, framing) is invisible to the parent: it looks like "no ready".
    const timer = setTimeout(() => report({ kind: 'no-ready' }), READY_TIMEOUT_MS)

    async function answer(info: ReadyInfo): Promise<void> {
      // The module is alive: stop waiting for it. A second `ready` (the module reloaded) comes here
      // too and gets the current token, from the cache while it is still good.
      clearTimeout(timer)
      const mine = (newest += 1)
      try {
        // A token for this module's own audience, kept for this module only (its id is the scope).
        const token = await sessionRef.current.getModuleToken(entry.audience, entry.id)
        if (disposed || mine !== newest) return
        const { admin, roles } = sessionRef.current
        if (admin === null) throw new NotSignedInError()
        const sent = channel.sendAuth(
          {
            accessToken: token.accessToken,
            expiresAt: Math.floor(token.expiresAt / 1000),
            user: { id: admin.id, email: admin.email, roles: [...roles] },
          },
          { replyTo: info.id },
        )
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
    })
    // Only now does the frame get its address: exactly the registry's `url`, never anything token-like.
    iframe.src = entry.url

    return () => {
      disposed = true
      clearTimeout(timer)
      channel.dispose()
      // The page is left (or the frame is reloaded): the module's tokens go with it.
      sessionRef.current.dropModuleTokens(entry.id)
    }
  }, [entry])

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
      <Typography>{children}</Typography>
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
  const failures = useRef(0)
  usePageTitle(status.kind === 'forbidden' ? "You don't have access" : entry.title)

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
    setAttempt((value) => value + 1)
  }

  // The admin lost the role: the same page as typing a module they may not open. No frame.
  if (status.kind === 'forbidden') return <NoAccess what="module" />

  // Never framed with this sandbox (see IFRAME_SANDBOX); the registry entry is wrong.
  if (entry.origin === window.location.origin) {
    return (
      <Box>
        <Typography component="h1" variant="h4" gutterBottom tabIndex={-1}>
          {entry.title}
        </Typography>
        <Panel title={`${entry.title} cannot be opened`}>
          It is set up to load from Shazlo-One's own address, which is not allowed. Tell the platform team.
        </Panel>
      </Box>
    )
  }

  const framed = status.kind === 'loading' || status.kind === 'ready'
  return (
    <Box>
      <Typography component="h1" variant="h4" gutterBottom tabIndex={-1}>
        {entry.title}
      </Typography>

      {status.kind === 'loading' ? (
        <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 2 }}>
          <CircularProgress size={24} />
          <Typography>Loading {entry.title}…</Typography>
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

      {framed ? <HostedFrame key={attempt} entry={entry} visible={status.kind === 'ready'} onStatus={handle} /> : null}
    </Box>
  )
}
