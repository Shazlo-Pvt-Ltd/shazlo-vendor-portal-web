import { useEffect, useRef } from 'react'
import { useLocation, useNavigationType, type NavigationType } from 'react-router'
import { paths } from '../app/paths'

// After moving to another page inside the app, focus goes to the new page's h1, so a screen reader
// announces where the seller landed instead of staying silent on a link that is gone (WCAG 2.4.3).
// Not on the first page, not when only the query or the fragment changes, and never over focus the
// page placed itself (a saved notice, a dialog). Pages load lazily and often show a skeleton heading
// first, so the heading is looked for as it appears, for a few seconds.

/**
 * How long after a navigation a heading that appears may still take focus. Long enough for a slow
 * page and a Try again; after a heading has taken focus it is only handed on when focus is lost.
 */
const WATCH_MS = 30_000

export interface FocusMoment {
  active: Element | null
  main: Element
  /** How the app got here: `POP` (back, forward), `PUSH` (a link) or `REPLACE`. */
  navigation: `${NavigationType}`
  /** A heading has already taken focus since this navigation. */
  tookFocus: boolean
}

const lost = (active: Element | null) => !active || active === document.body || !active.isConnected

/** Whether a page heading may take focus now. */
export function mayTakeFocus({ active, main, navigation, tookFocus }: FocusMoment): boolean {
  if (lost(active)) return true
  // Once a heading has focus, only its own disappearance (a skeleton giving way) hands it on.
  if (tookFocus) return false
  // A replace keeps the person where they are (the product editor adopting its new address).
  if (navigation === 'REPLACE') return false
  // Focus the page put inside itself stays; the link that opened the page (outside main) gives way.
  return !main.contains(active)
}

function focusHeading(heading: HTMLElement) {
  if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1')
  // A heading is not a control: no focus ring, and the scroll stays where the shell put it.
  heading.style.outline = 'none'
  heading.focus({ preventScroll: true })
}

/** Moves focus to the page's h1 after each in-app navigation. Call it once, in the shell. */
export function usePageHeadingFocus() {
  const { pathname } = useLocation()
  const type = useNavigationType()
  const navigationType = useRef<FocusMoment['navigation']>(`${type}`)
  const previous = useRef(pathname)

  // Read by the effect below without restarting it: only a new path starts a new watch.
  useEffect(() => {
    navigationType.current = `${type}`
  }, [type])

  useEffect(() => {
    const navigation = navigationType.current
    const from = previous.current
    previous.current = pathname
    if (from === pathname) return
    // Bulk import opens as a dialog over Products: the dialog keeps focus, and gives it back on close.
    if (from === paths.bulkImport || pathname === paths.bulkImport) return
    const main = document.getElementById('content') ?? document.querySelector('main')
    if (!main) return

    let tookFocus = false
    let focused: HTMLElement | null = null
    const attempt = () => {
      const heading = main.querySelector('h1')
      if (!(heading instanceof HTMLElement) || heading === focused) return
      if (!mayTakeFocus({ active: document.activeElement, main, navigation, tookFocus })) return
      focusHeading(heading)
      focused = heading
      tookFocus = true
    }
    attempt()
    const observer = new MutationObserver(attempt)
    observer.observe(main, { childList: true, subtree: true })
    const stop = window.setTimeout(() => observer.disconnect(), WATCH_MS)
    return () => {
      observer.disconnect()
      window.clearTimeout(stop)
    }
  }, [pathname])
}
