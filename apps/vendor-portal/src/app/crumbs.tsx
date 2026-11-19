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

// Where the phone top bar's Back link goes from this page ("Back to Store").
export type BackLink = { to: string; label: string }

export type RouteHandle = {
  crumbs?: { label: string; to?: string }[]
  // Inner pages name their parent; on phones the top bar shows a Back link to it.
  back?: BackLink
  // A full-screen task (see src/shell/task.tsx): on phones the tab bar hides and the top bar keeps only Back.
  fullScreen?: boolean
}
