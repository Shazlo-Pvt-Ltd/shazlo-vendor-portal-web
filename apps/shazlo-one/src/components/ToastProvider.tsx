import { Alert, Box, Typography } from '@mui/material'
import type { ToastLevel } from '@shazlo/shell-protocol'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

export interface ToastRequest {
  /** `info`, `success`, `warning` or `error`: each is the alert severity of the same name. */
  level: ToastLevel
  /** Plain text. It is rendered as text, never as HTML. */
  message: string
  /** Who it is from (a module's title), shown above the message so a module cannot pass as the shell. */
  source?: string
  durationMs?: number
}

interface ToastApi {
  show: (toast: ToastRequest) => void
}

interface Toast extends ToastRequest {
  id: number
}

const ToastContext = createContext<ToastApi | undefined>(undefined)

/** How long each level stays when the sender does not say. A failure stays longer: it is more important. */
const DEFAULT_DURATION_MS: Record<ToastLevel, number> = { info: 6000, success: 5000, warning: 8000, error: 10_000 }
const MIN_DURATION_MS = 3000
const MAX_DURATION_MS = 15_000
/** The most toasts on screen at once; a newer one pushes the oldest off. A sender cannot fill the page. */
export const MAX_VISIBLE_TOASTS = 3
/** The most lines a toast keeps; the rest are joined onto the last one, so a toast cannot cover the screen. */
export const MAX_TOAST_LINES = 3

/** The message with its blank lines dropped and at most {@link MAX_TOAST_LINES} lines. */
function fewLines(message: string): string {
  const lines = message.split('\n').filter((line) => line.trim() !== '')
  if (lines.length <= MAX_TOAST_LINES) return lines.join('\n')
  return [...lines.slice(0, MAX_TOAST_LINES - 1), lines.slice(MAX_TOAST_LINES - 1).join(' ')].join('\n')
}

function ToastItem({ toast, onClose }: { toast: Toast; onClose: (id: number) => void }) {
  const duration = Math.min(Math.max(toast.durationMs ?? DEFAULT_DURATION_MS[toast.level], MIN_DURATION_MS), MAX_DURATION_MS)
  useEffect(() => {
    const timer = setTimeout(() => onClose(toast.id), duration)
    return () => clearTimeout(timer)
  }, [toast.id, duration, onClose])
  return (
    <Alert
      // The region around the toasts is the live region (polite), so the alert itself adds no role of its own:
      // MUI's default `role="alert"` would announce it assertively.
      role="presentation"
      data-level={toast.level}
      severity={toast.level}
      variant="filled"
      onClose={() => onClose(toast.id)}
      sx={{ width: '100%', alignItems: 'flex-start' }}
    >
      {toast.source ? (
        <Typography component="span" variant="caption" sx={{ display: 'block', opacity: 0.9 }}>
          {toast.source}
        </Typography>
      ) : null}
      {/* A text node: whatever the message contains is shown, not interpreted. */}
      <Typography component="span" sx={{ display: 'block', overflowWrap: 'anywhere', whiteSpace: 'pre-line' }}>
        {fewLines(toast.message)}
      </Typography>
    </Alert>
  )
}

/**
 * The shell's own toasts. Modules ask for one with the `toast` message; this is what shows it, so the shell
 * decides how it looks and a module cannot change that. The region is always in the page and announces
 * politely; at most three show at a time.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(0)
  const show = useCallback((request: ToastRequest) => {
    nextId.current += 1
    const id = nextId.current
    setToasts((current) => [...current, { ...request, id }].slice(-MAX_VISIBLE_TOASTS))
  }, [])
  const close = useCallback((id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)), [])
  const api = useMemo<ToastApi>(() => ({ show }), [show])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Box
        role="region"
        aria-label="Notifications"
        aria-live="polite"
        aria-relevant="additions"
        sx={{
          position: 'fixed',
          left: 16,
          bottom: 16,
          zIndex: (theme) => theme.zIndex.snackbar,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          width: 'min(420px, calc(100vw - 32px))',
        }}
      >
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onClose={close} />
        ))}
      </Box>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (api === undefined) {
    throw new Error('useToast must be used inside ToastProvider.')
  }
  return api
}
