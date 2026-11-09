import { Typography } from '@mui/material'
import { CheckCircle2, CloudOff, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { formatRelative } from './format'

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

// Options board pick: drafts save a second after typing stops; submitting stays a click.
// `values` must be serialisable; a change is detected by comparing JSON.
export function useAutosave<T>({ values, save, enabled = true, delay = 1000, savedAt: initialSavedAt = null }: { values: T; save: (values: T) => Promise<unknown>; enabled?: boolean; delay?: number; savedAt?: string | null }) {
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

  useEffect(() => {
    saveRef.current = save
    latest.current = values
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
      .catch(() => setState('error'))
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

export function SaveStatus({ state, savedAt }: { state: SaveState; savedAt: string | null }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])
  const text =
    state === 'saving' ? 'Saving…' : state === 'error' ? 'Not saved. Check your connection; we will try again when you edit.' : savedAt ? `Saved · ${formatRelative(savedAt).replace('Just now', 'just now')}` : null
  if (!text) return null
  const Icon = state === 'saving' ? Loader2 : state === 'error' ? CloudOff : CheckCircle2
  return (
    <Typography role="status" variant="body2" color={state === 'error' ? 'error.main' : 'text.secondary'} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
      <Icon size={14} aria-hidden="true" />
      {text}
    </Typography>
  )
}
