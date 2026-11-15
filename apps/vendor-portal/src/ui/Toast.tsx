import { Alert, Snackbar } from '@mui/material'
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

type Kind = 'success' | 'error' | 'info'
interface Toast {
  id: number
  kind: Kind
  message: string
}

interface ToastApi {
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
}

const ToastContext = createContext<ToastApi | undefined>(undefined)

/** Failures stay longer than confirmations: they are harder to read and more important. */
const DURATION: Record<Kind, number> = { success: 5000, info: 6000, error: 10000 }

/**
 * Short messages about something that just happened ("Product saved"). One at a time, in order.
 * A success is announced politely, a failure assertively.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Toast[]>([])
  const nextId = useRef(0)
  const push = useCallback((kind: Kind, message: string) => {
    nextId.current += 1
    const id = nextId.current
    setQueue((current) => [...current, { id, kind, message }])
  }, [])
  const api = useMemo<ToastApi>(
    () => ({
      success: (message) => push('success', message),
      error: (message) => push('error', message),
      info: (message) => push('info', message),
    }),
    [push],
  )
  const current = queue[0]
  const next = () => setQueue((items) => items.slice(1))

  return (
    <ToastContext.Provider value={api}>
      {children}
      {current ? (
        <Snackbar
          key={current.id}
          open
          autoHideDuration={DURATION[current.kind]}
          onClose={(_event, reason) => {
            if (reason !== 'clickaway') next()
          }}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          <Alert
            severity={current.kind}
            variant="filled"
            role={current.kind === 'error' ? 'alert' : 'status'}
            onClose={next}
            sx={{ width: '100%' }}
          >
            {current.message}
          </Alert>
        </Snackbar>
      ) : null}
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
