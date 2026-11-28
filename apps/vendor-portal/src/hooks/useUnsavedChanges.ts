import { useCallback, useEffect, useRef } from 'react'
import { useBlocker } from 'react-router'

/**
 * Stops the page from leaving while `dirty`: inside the app (a link, Back) through the router, and
 * out of it (closing or reloading the tab) with the browser's own warning. Moving within the same
 * path (a query change) is not leaving. The screen draws its own dialog: `blocked` while it waits,
 * then `stay()` or `leave()`.
 *
 * `allowNext()` lets the next navigation through, once: call it just before leaving on purpose
 * (after deleting the product, say), while the form may still look dirty for one render.
 */
export function useLeaveGuard(dirty: boolean): { blocked: boolean; stay: () => void; leave: () => void; allowNext: () => void } {
  const allowed = useRef(false)
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (currentLocation.pathname === nextLocation.pathname) return false
    if (allowed.current) {
      allowed.current = false
      return false
    }
    return dirty
  })

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const stay = useCallback(() => blocker.reset?.(), [blocker])
  const leave = useCallback(() => blocker.proceed?.(), [blocker])
  const allowNext = useCallback(() => {
    allowed.current = true
  }, [])
  return { blocked: blocker.state === 'blocked', stay, leave, allowNext }
}
