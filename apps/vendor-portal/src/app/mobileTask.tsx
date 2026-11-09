import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

/**
 * Phone chrome overrides. Most screens use the store app bar and bottom tab bar (V-04m). Some draw
 * their own app bar (V-06m "Products · 27 products · 18 live") and editors also drop the tab bar for a
 * fixed action bar (V-05m, V-07m). Screens declare that with `useMobileChrome(...)`.
 */
interface Chrome { ownAppBar: boolean; hideTabBar: boolean }
const none: Chrome = { ownAppBar: false, hideTabBar: false }

const ChromeContext = createContext<{ chrome: Chrome; set: (c: Chrome) => void }>({ chrome: none, set: () => {} })

export function MobileChromeProvider({ children }: { children: ReactNode }) {
  const [chrome, setChrome] = useState<Chrome>(none)
  const set = useCallback((c: Chrome) => setChrome(prev => (prev.ownAppBar === c.ownAppBar && prev.hideTabBar === c.hideTabBar ? prev : c)), [])
  const value = useMemo(() => ({ chrome, set }), [chrome, set])
  return <ChromeContext.Provider value={value}>{children}</ChromeContext.Provider>
}

export const useMobileChromeState = () => useContext(ChromeContext).chrome

/** Call from a screen's mobile layout; the shell restores its own chrome when the screen unmounts. */
export function useMobileChrome({ ownAppBar = true, hideTabBar = false }: Partial<Chrome> = {}) {
  const { set } = useContext(ChromeContext)
  useEffect(() => {
    set({ ownAppBar, hideTabBar })
    return () => set(none)
  }, [set, ownAppBar, hideTabBar])
}
