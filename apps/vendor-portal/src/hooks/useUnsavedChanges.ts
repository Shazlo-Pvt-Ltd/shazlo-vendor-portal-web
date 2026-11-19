import { useCallback, useEffect, useRef } from 'react'
import { useBlocker } from 'react-router'
import { useConfirm } from '../ui/ConfirmDialog'

/**
 * Asks before leaving a form with unsaved edits: inside the app (a link, back) with the shared
 * confirm dialog, and out of it (closing or reloading the tab) with the browser's own warning.
 * Moving within the same path (a query change) is not leaving.
 *
 * Returns `allowNextNavigation`: call it just before navigating away on purpose after a save
 * (a new product going to its own page), while the form may still look dirty for one render.
 */
export function useUnsavedChanges(dirty: boolean, message: string): () => void {
  const confirm = useConfirm()
  const allowed = useRef(false)
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => dirty && !allowed.current && currentLocation.pathname !== nextLocation.pathname,
  )

  useEffect(() => {
    if (blocker.state !== 'blocked') return
    void confirm({
      title: 'Leave without saving?',
      message,
      confirmLabel: 'Leave and lose changes',
      cancelLabel: 'Keep editing',
      destructive: true,
    }).then((leave) => (leave ? blocker.proceed() : blocker.reset()))
  }, [blocker, confirm, message])

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  return useCallback(() => {
    allowed.current = true
  }, [])
}
