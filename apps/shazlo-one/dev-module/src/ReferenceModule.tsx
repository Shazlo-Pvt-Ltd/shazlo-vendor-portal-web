import { createModuleClient, type ModuleClient, type ToastLevel } from '@shazlo/shell-protocol'
import { useEffect, useRef, useState } from 'react'
import type { ModuleConfig } from '../config'
import { fetchAdminMe, type AdminMeResult } from './vendorApi'

/** The id this module has in the shell's registry. */
export const MODULE_ID = 'reference'
export const MODULE_VERSION = '0.0.0'

const PAGES = [
  { path: '/', title: 'Overview' },
  { path: '/pages/orders', title: 'Orders (example)' },
  { path: '/pages/reports', title: 'Reports (example)' },
] as const

const TOAST_LEVELS: readonly ToastLevel[] = ['info', 'success', 'warning', 'error']

const titleOf = (path: string) => PAGES.find((page) => page.path === path)?.title ?? 'Reference module'

interface Session {
  email: string
  roles: string[]
  /** Epoch seconds. */
  expiresAt: number
}

/**
 * Opened outside the shell, the module says so and does nothing else: no listener, no message, no
 * request. A module has nothing to show without the shell's session.
 */
function NotFramed({ shellOrigin }: { shellOrigin: string }) {
  return (
    <main>
      <h1>Reference module</h1>
      <p>
        This page is the Shazlo-One reference module. It works only inside the shell, which gives it its session.
      </p>
      <p>
        Open <a href={shellOrigin}>Shazlo-One</a>, sign in and choose "Reference module".
      </p>
    </main>
  )
}

function describeApi(result: AdminMeResult | undefined): string {
  if (result === undefined) return 'Not called yet.'
  if (result.kind === 'ok') return `vendor-api answered 200: admin ${result.admin.id}, roles ${result.admin.roles.join(', ') || 'none'}.`
  if (result.kind === 'unauthorized') return 'vendor-api refused the token (401).'
  return result.message
}

function FramedModule({ config, frameWindow, now }: { config: ModuleConfig; frameWindow: Window; now: () => number }) {
  const client = useRef<ModuleClient | undefined>(undefined)
  const callApi = useRef<() => void>(() => {})
  const [session, setSession] = useState<Session | undefined>()
  const [api, setApi] = useState<AdminMeResult | undefined>()
  const [apiNote, setApiNote] = useState('')
  const [path, setPath] = useState('/')
  const [shellError, setShellError] = useState<string | undefined>()
  const [action, setAction] = useState('')
  const [, setTick] = useState(0)

  // Keeps "expires in N minutes" honest without a new message.
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 15_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const state = { first: true, retryAfterAuth: false }

    const call = async (module: ModuleClient) => {
      // The token stays inside the client; it is read here, used once and never shown or kept.
      const token = module.getAccessToken()
      if (token === undefined) {
        setApiNote('There is no valid token yet.')
        return
      }
      setApiNote('Calling vendor-api…')
      try {
        const result = await fetchAdminMe(config.vendorApiOrigin, token, controller.signal)
        setApi(result)
        if (result.kind === 'unauthorized') {
          // At most once every 30 seconds: the client enforces it.
          const asked = module.requestToken('unauthorized')
          state.retryAfterAuth = asked
          setApiNote(
            asked
              ? 'Asked the shell for a new token. The call is repeated when it arrives.'
              : 'A new token was requested less than 30 seconds ago, so none was requested now.',
          )
        } else {
          setApiNote('')
        }
      } catch {
        // Aborted: the module was closed meanwhile.
      }
    }

    // The client listens from here, before `ready` is sent.
    const module = createModuleClient({
      shellOrigin: config.shellOrigin,
      window: frameWindow,
      module: MODULE_ID,
      moduleVersion: MODULE_VERSION,
      development: config.development,
      now,
      onAuth: (auth) => {
        setSession({ email: auth.user.email, roles: auth.user.roles, expiresAt: auth.expiresAt })
        // Call on the first token, and again when a refused one was replaced; not on every refresh.
        if (state.first || state.retryAfterAuth) {
          state.first = false
          state.retryAfterAuth = false
          void call(module)
        }
      },
      onNavigate: (next) => {
        setPath(next)
        module.sendTitle(next, titleOf(next))
        setAction(`The shell asked for ${next}; sent its title back.`)
      },
      onShellError: (error) => setShellError(`${error.code}: ${error.message}`),
    })
    client.current = module
    callApi.current = () => void call(module)
    module.sendReady()

    return () => {
      controller.abort()
      module.dispose()
      client.current = undefined
      callApi.current = () => {}
    }
  }, [config, frameWindow, now])

  const send = (label: string, run: (module: ModuleClient) => boolean) => {
    const module = client.current
    setAction(module !== undefined && run(module) ? `Sent ${label}.` : `Could not send ${label}.`)
  }

  const go = (next: string, title: string) => {
    setPath(next)
    send(`title for ${next}`, (module) => module.sendTitle(next, title))
  }

  const minutesLeft = session === undefined ? undefined : Math.max(0, Math.round((session.expiresAt * 1000 - now()) / 60_000))

  return (
    <main>
      <h1>Reference module</h1>
      <p>A module that speaks the shell protocol, for development and the shell's tests. It is never deployed.</p>

      {shellError ? (
        <p role="alert" className="error">
          The shell reported an error: {shellError}
        </p>
      ) : null}

      <section aria-labelledby="session-heading">
        <h2 id="session-heading">Session from the shell</h2>
        {session === undefined ? (
          <p role="status">Waiting for the shell to send the session…</p>
        ) : (
          <dl>
            <dt>Email</dt>
            <dd>{session.email}</dd>
            <dt>Roles</dt>
            <dd>{session.roles.length > 0 ? session.roles.join(', ') : 'none'}</dd>
            <dt>Token expires</dt>
            <dd>
              {new Date(session.expiresAt * 1000).toLocaleTimeString()} ({minutesLeft} min left)
            </dd>
          </dl>
        )}
        <p className="note">The token itself is kept in memory and never shown.</p>
      </section>

      <section aria-labelledby="api-heading">
        <h2 id="api-heading">vendor-api</h2>
        <p role="status">{describeApi(api)}</p>
        {apiNote ? <p role="status">{apiNote}</p> : null}
        <button type="button" onClick={() => callApi.current()} disabled={session === undefined}>
          Call GET /v1/admin/me
        </button>
      </section>

      <section aria-labelledby="nav-heading">
        <h2 id="nav-heading">Navigation inside the module</h2>
        <p>
          Current path: <code>{path}</code>
        </p>
        <ul>
          {PAGES.map((page) => (
            <li key={page.path}>
              <button type="button" onClick={() => go(page.path, page.title)} aria-current={path === page.path ? 'page' : undefined}>
                {page.title} ({page.path})
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="toast-heading">
        <h2 id="toast-heading">Notifications</h2>
        <ul>
          {TOAST_LEVELS.map((level) => (
            <li key={level}>
              <button
                type="button"
                onClick={() => send(`${level} toast`, (module) => module.sendToast({ level, message: `A ${level} message from the reference module.` }))}
              >
                Send a {level} toast
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="other-heading">
        <h2 id="other-heading">Errors and sign-out</h2>
        <ul>
          <li>
            <button
              type="button"
              onClick={() => send('non-fatal error', (module) => module.sendError('reference_nonfatal', 'A non-fatal error from the reference module.', false))}
            >
              Send a non-fatal error
            </button>
          </li>
          <li>
            <button
              type="button"
              onClick={() => send('fatal error', (module) => module.sendError('reference_fatal', 'A fatal error from the reference module.', true))}
            >
              Send a fatal error
            </button>
          </li>
          <li>
            <button type="button" onClick={() => send('logout', (module) => module.sendLogout('reference_module_button'))}>
              Sign out of Shazlo-One
            </button>
          </li>
        </ul>
      </section>

      <p role="status" aria-live="polite" className="note">
        {action}
      </p>
    </main>
  )
}

interface Props {
  config: ModuleConfig
  /** The module's own window (its `parent` is the shell). Tests pass the window of an iframe. */
  frameWindow?: Window
  now?: () => number
}

export function ReferenceModule({ config, frameWindow = window, now = Date.now }: Props) {
  // Framed means the page has a parent that is not itself. Opened directly, there is no shell.
  if (frameWindow.parent === frameWindow) return <NotFramed shellOrigin={config.shellOrigin} />
  return <FramedModule config={config} frameWindow={frameWindow} now={now} />
}
