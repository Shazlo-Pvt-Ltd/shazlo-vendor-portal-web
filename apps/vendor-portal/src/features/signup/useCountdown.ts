import { useCallback, useEffect, useState } from 'react'

/**
 * A countdown in whole seconds. `start(n)` begins it; `remaining` reaches 0 and stops. Used for a
 * `Retry-After` from the server and for the resend cooldown.
 */
export function useCountdown() {
  const [endsAt, setEndsAt] = useState<number | null>(null)
  const [remaining, setRemaining] = useState(0)

  useEffect(() => {
    if (endsAt === null) return
    const tick = () => {
      const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))
      setRemaining(left)
      if (left === 0) setEndsAt(null)
    }
    tick()
    const timer = setInterval(tick, 250)
    return () => clearInterval(timer)
  }, [endsAt])

  const start = useCallback((seconds: number) => {
    setRemaining(Math.max(0, Math.ceil(seconds)))
    setEndsAt(Date.now() + seconds * 1000)
  }, [])

  return { remaining, start, active: remaining > 0 }
}
