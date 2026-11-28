import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMatches } from 'react-router'
import type { RouteHandle } from '../app/crumbs'

/*
 * Full-screen tasks (spec §3, §7): the product editor, store detail edits, any one-job screen.
 * On phones (under 600 px) the shell hides the bottom tab bar and the bell, and its top bar keeps only
 * a Back link. Put the one main button in <StickyFooter> (./StickyFooter.tsx). Tablets keep the rail
 * and desktops the sidebar, so the same screen works there unchanged.
 *
 * Declare a task in one of two ways:
 *  1. In the route handle, when the route is always a task (src/app/routes.tsx):
 *       handle: { crumbs: [...], fullScreen: true, back: { to: paths.products, label: 'Products' } }
 *  2. From the screen while it is mounted, when it depends on state or Back must do something else:
 *       useFullScreenTask()                                                   // Back as the route says
 *       useFullScreenTask({ back: { label: 'Photos', onClick: () => setStep(0) } })  // one step back
 *       useFullScreenTask({ back: { label: 'Store details', to: paths.storeDetails } })
 *       useFullScreenTask({ back: null })                                     // the screen draws its own Back
 *       useFullScreenTask({ enabled: isPhone })                               // only while a condition holds
 *     `label` names where Back goes: the bar shows "Back", screen readers hear "Back to Photos".
 * useIsFullScreenTask() tells a screen whether it is in task mode.
 */

export type TaskBack = { to: string; label: string } | { onClick: () => void; label: string }

type Declared = { kind: 'route' | 'none' | 'link' | 'button'; to?: string; label?: string; run: () => void }
type Context = { declared: Declared | null; declare: (d: Declared) => () => void }

const TaskContext = createContext<Context | null>(null)

export function TaskProvider({ children }: { children: ReactNode }) {
  const [declared, setDeclared] = useState<Declared | null>(null)
  const declare = useCallback((d: Declared) => {
    setDeclared(d)
    return () => setDeclared((current) => (current === d ? null : current))
  }, [])
  const value = useMemo(() => ({ declared, declare }), [declared, declare])
  return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>
}

export function useFullScreenTask({ back, enabled = true }: { back?: TaskBack | null; enabled?: boolean } = {}) {
  const ctx = useContext(TaskContext)
  const onClick = back && 'onClick' in back ? back.onClick : undefined
  // The latest handler, so a new arrow function each render does not re-declare the task.
  const run = useRef(onClick)
  useEffect(() => {
    run.current = onClick
  })
  const kind = back === null ? 'none' : back === undefined ? 'route' : 'onClick' in back ? 'button' : 'link'
  const to = back && 'to' in back ? back.to : undefined
  const label = back?.label
  const declare = enabled ? ctx?.declare : undefined
  useEffect(() => declare?.({ kind, to, label, run: () => run.current?.() }), [declare, kind, to, label])
}

// What the shell needs: is this a task, and where does Back go (null: no Back link).
export type ResolvedBack = { label?: string } & ({ to: string } | { onClick: () => void })

export function useTaskState(): { fullScreen: boolean; back: ResolvedBack | null } {
  const declared = useContext(TaskContext)?.declared ?? null
  const handles = useMatches().map((m) => (m.handle ?? {}) as RouteHandle)
  const routeTask = handles.some((h) => h.fullScreen)
  const routeBack = [...handles].reverse().find((h) => h.back)?.back ?? null

  let back: ResolvedBack | null = routeBack
  if (declared?.kind === 'none') back = null
  else if (declared?.kind === 'link' && declared.to) back = { to: declared.to, label: declared.label }
  else if (declared?.kind === 'button') back = { onClick: declared.run, label: declared.label }
  return { fullScreen: routeTask || declared !== null, back }
}

export const useIsFullScreenTask = () => useTaskState().fullScreen
