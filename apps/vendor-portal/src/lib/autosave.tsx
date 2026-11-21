import { Typography } from '@mui/material'
import { CheckCircle2, CloudOff, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { formatRelative } from './format'

/** `invalid`: the server refused the values (a 422); the form shows why on its fields. */
export type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'invalid'

// Options board pick: drafts save a second after typing stops; submitting stays a click.
// `values` must be serialisable; a change is detected by comparing JSON.
//   flushOnUnmount: a change still waiting for its second is saved when the form goes away (the
//     seller left the page), if saving is enabled then.
//   isInvalid: tells a refusal of the values (the form shows it on the fields) from a lost connection.
export function useAutosave<T>({
  values,
  save,
  enabled = true,
  delay = 1000,
  savedAt: initialSavedAt = null,
  flushOnUnmount = false,
  isInvalid,
}: {
  values: T
  save: (values: T) => Promise<unknown>
  enabled?: boolean
  delay?: number
  savedAt?: string | null
  flushOnUnmount?: boolean
  isInvalid?: (error: unknown) => boolean
}) {
  const [state, setState] = useState<SaveState>('idle')
  const [savedAt, setSavedAt] = useState<string | null>(initialSavedAt)
  const [initialJson] = useState(() => JSON.stringify(values))
  const last = useRef(initialJson)
  // Mirrors `last` for rendering (refs must not be read during render).
  const [savedJson, setSavedJson] = useState(initialJson)
  const latest = useRef(values)
  const saveRef = useRef(save)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlight = useRef<Promise<void> | null>(null)
  const options = useRef({ enabled, flushOnUnmount, isInvalid })

  useEffect(() => {
    saveRef.current = save
    latest.current = values
    options.current = { enabled, flushOnUnmount, isInvalid }
  })

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    await inFlight.current
    const snapshot = JSON.stringify(latest.current)
    if (snapshot === last.current) return
    setState('saving')
    const run = saveRef
      .current(latest.current)
      .then(() => {
        last.current = snapshot
        setSavedJson(snapshot)
        setSavedAt(new Date().toISOString())
        setState('saved')
      })
      .catch((error: unknown) => setState(options.current.isInvalid?.(error) ? 'invalid' : 'error'))
      .finally(() => {
        inFlight.current = null
      })
    inFlight.current = run
    await run
  }, [])

  const serialized = JSON.stringify(values)
  useEffect(() => {
    if (!enabled || serialized === savedJson) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(), delay)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [serialized, savedJson, enabled, delay, flush])

  // Leaving the page: a pending change is not dropped.
  useEffect(
    () => () => {
      const pending = timer.current !== null
      if (pending && options.current.flushOnUnmount && options.current.enabled) void flush()
    },
    [flush],
  )

  // Treat freshly loaded server values as already saved.
  const reset = useCallback((next: T, at: string | null = null) => {
    last.current = JSON.stringify(next)
    setSavedJson(last.current)
    latest.current = next
    setSavedAt(at)
    setState('idle')
  }, [])

  return { state, savedAt, flush, reset, dirty: serialized !== savedJson }
}

// Pass component="span" when it sits inside another paragraph, such as a page subtitle.
export function SaveStatus({ state, savedAt, component = 'p' }: { state: SaveState; savedAt: string | null; component?: 'p' | 'span' }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])
  const text =
    state === 'saving' ? 'Saving…' : state === 'error' ? 'Not saved. Check your connection; we will try again when you edit.' : state === 'invalid' ? 'Not saved. Fix the highlighted fields.' : savedAt ? `Saved · ${formatRelative(savedAt).replace('Just now', 'just now')}` : null
  if (!text) return null
  const Icon = state === 'saving' ? Loader2 : state === 'error' || state === 'invalid' ? CloudOff : CheckCircle2
  return (
    <Typography component={component} role="status" variant="body2" color={state === 'error' || state === 'invalid' ? 'error.main' : 'text.secondary'} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, verticalAlign: 'bottom' }}>
      <Icon size={14} aria-hidden="true" />
      {text}
    </Typography>
  )
}
