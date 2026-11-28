import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

// The top bar shows "Products › Ajrakh Block-Print Kurta". Static crumbs come from route
// handles; a screen names its own last crumb with useCrumb once its data has loaded.
type Crumbs = { label: string | null; set: (label: string | null) => void }
const Context = createContext<Crumbs>({ label: null, set: () => {} })

export function CrumbProvider({ children }: { children: ReactNode }) {
  const [label, set] = useState<string | null>(null)
  return <Context.Provider value={{ label, set }}>{children}</Context.Provider>
}

export function useCrumb(label: string | null | undefined) {
  const { set } = useContext(Context)
  useEffect(() => {
    set(label ?? null)
    return () => set(null)
  }, [label, set])
}

export const usePageCrumb = () => useContext(Context).label

export type RouteHandle = { crumbs?: { label: string; to?: string }[] }
