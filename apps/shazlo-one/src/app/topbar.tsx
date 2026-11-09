import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Breadcrumb } from '@shazlo/ui/components'

interface Slots { crumbs: HTMLElement | null; actions: HTMLElement | null }
interface Ctx { slots: Slots; setCrumbs: (el: HTMLElement | null) => void; setActions: (el: HTMLElement | null) => void }
const TopBarContext = createContext<Ctx | null>(null)

export function TopBarProvider({ children }: { children: ReactNode }) {
  const [slots, set] = useState<Slots>({ crumbs: null, actions: null })
  const setCrumbs = useCallback((el: HTMLElement | null) => set(s => (s.crumbs === el ? s : { ...s, crumbs: el })), [])
  const setActions = useCallback((el: HTMLElement | null) => set(s => (s.actions === el ? s : { ...s, actions: el })), [])
  const value = useMemo(() => ({ slots, setCrumbs, setActions }), [slots, setCrumbs, setActions])
  return <TopBarContext.Provider value={value}>{children}</TopBarContext.Provider>
}

/** The shell renders these mount points in its top bar (desktop only). */
export function TopBarMounts({ trailing }: { trailing?: ReactNode }) {
  const ctx = useContext(TopBarContext)
  return (
    <>
      <div ref={ctx?.setCrumbs} style={{ display: 'flex', minWidth: 0, overflow: 'hidden' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div ref={ctx?.setActions} style={{ display: 'flex', alignItems: 'center', gap: 16 }} />
        {trailing}
      </div>
    </>
  )
}

/**
 * Screens declare their breadcrumb and extra top-bar actions:
 * `<TopBar crumbs={[{ label: 'Products', to: '/products' }, { label: 'Ajrakh kurta' }]} />`
 */
export function TopBar({ crumbs, actions }: { crumbs: Array<{ label: string; to?: string }>; actions?: ReactNode }) {
  const ctx = useContext(TopBarContext)
  if (!ctx) return null
  return (
    <>
      {ctx.slots.crumbs && createPortal(<Breadcrumb items={crumbs} />, ctx.slots.crumbs)}
      {actions && ctx.slots.actions && createPortal(actions, ctx.slots.actions)}
    </>
  )
}
