import MuiDialog from '@mui/material/Dialog'
import GlobalStyles from '@mui/material/GlobalStyles'
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { kit, kitFont, textStyle } from '../kit'
import { Icon, type IconName } from './Icon'
import { IconButton, Text } from './primitives'

/** Page-level CSS the kit relies on: canvas, text selection, scrollbars, skeleton shimmer. */
export function KitGlobalStyles() {
  return (
    <GlobalStyles
      styles={{
        'html, body, #root': { minHeight: '100%' },
        body: { margin: 0, background: kit.canvas, color: kit.ink, fontFamily: kitFont.body, WebkitFontSmoothing: 'antialiased', textRendering: 'optimizeLegibility' },
        '*, *::before, *::after': { boxSizing: 'border-box' },
        '::selection': { background: kit.cream, color: kit.ink },
        'h1, h2, h3, h4, p': { margin: 0 },
        'input, textarea, select': { caretColor: kit.brown },
        '.shz-link:hover': { textDecoration: 'underline !important' },
        '.shz-tabs::-webkit-scrollbar': { display: 'none' },
        '*': { scrollbarColor: `${kit.field} transparent` },
        '.shz-skeleton': { animation: 'shz-pulse 1.4s ease-in-out infinite' },
        '@keyframes shz-pulse': { '0%, 100%': { opacity: 1 }, '50%': { opacity: 0.55 } },
        '.shz-visually-hidden': { position: 'absolute', top: 0, left: 0, width: 1, height: 1, margin: -1, padding: 0, border: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', clipPath: 'inset(50%)', whiteSpace: 'nowrap' },
        '.shz-skip': { position: 'absolute', left: 8, top: -40, zIndex: 100, background: kit.navy, color: kit.offWhite, padding: '8px 12px', borderRadius: 6, ...textStyle.label },
        '.shz-skip:focus': { top: 8 },
        '@media (prefers-reduced-motion: reduce)': { '*': { transitionDuration: '0ms !important', animationDuration: '0ms !important' } },
      }}
    />
  )
}

/* ---------- Dialog ---------- */

export function Dialog({ open, onClose, title, description, children, actions, width = 520, icon }: {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  actions?: ReactNode
  width?: number
  icon?: IconName
}) {
  return (
    <MuiDialog
      open={open}
      onClose={onClose}
      aria-labelledby="shz-dialog-title"
      slotProps={{
        paper: { sx: { width, maxWidth: 'calc(100vw - 32px)', m: 2, background: kit.surface, border: `1px solid ${kit.line}`, borderRadius: '12px', boxShadow: '0 24px 48px rgba(23, 18, 14, 0.18)' } },
        backdrop: { sx: { background: 'rgba(23, 18, 14, 0.45)' } },
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 28 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          {icon && <Icon name={icon} size={20} color={kit.ink} style={{ marginTop: 2 }} />}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
            <Text v="heading" as="h2" id="shz-dialog-title">{title}</Text>
            {description && <Text v="small" tone="muted" as="p">{description}</Text>}
          </div>
          <IconButton aria-label="Close" onClick={onClose} style={{ margin: '-4px -6px 0 0' }}><Icon name="x" size={18} /></IconButton>
        </div>
        {children}
        {actions && <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>{actions}</div>}
      </div>
    </MuiDialog>
  )
}

/* ---------- Toasts ---------- */

export type ToastLevel = 'info' | 'success' | 'warning' | 'error'
interface ToastItem { id: number; level: ToastLevel; message: string }

const ToastContext = createContext<(message: string, level?: ToastLevel, durationMs?: number) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const next = useRef(1)
  const dismiss = useCallback((id: number) => setItems(list => list.filter(t => t.id !== id)), [])
  const show = useCallback((message: string, level: ToastLevel = 'success', durationMs = 4000) => {
    const id = next.current++
    setItems(list => [...list.slice(-2), { id, level, message }])
    window.setTimeout(() => dismiss(id), durationMs)
  }, [dismiss])
  const glyph: Record<ToastLevel, IconName> = { info: 'info', success: 'check', warning: 'alert', error: 'alert' }
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite" style={{ position: 'fixed', left: 24, bottom: 24, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 2000, maxWidth: 'calc(100vw - 48px)' }}>
        {items.map(t => (
          <div key={t.id} role={t.level === 'error' ? 'alert' : 'status'} style={{ display: 'flex', alignItems: 'center', gap: 10, background: kit.navy, color: kit.offWhite, borderRadius: 8, padding: '10px 12px 10px 14px', boxShadow: '0 8px 24px rgba(23, 18, 14, 0.2)', ...textStyle.small, minWidth: 260 }}>
            <Icon name={glyph[t.level]} size={16} color={t.level === 'error' ? '#F6B8A0' : kit.amber} />
            <span style={{ flex: 1 }}>{t.message}</span>
            <IconButton tone="dark" aria-label="Dismiss" onClick={() => dismiss(t.id)} style={{ margin: 0, width: 24, height: 24 }}><Icon name="x" size={14} /></IconButton>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const show = useContext(ToastContext)
  return useMemo(() => ({ show }), [show])
}
