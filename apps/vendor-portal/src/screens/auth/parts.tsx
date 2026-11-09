import { styled } from '@mui/material/styles'
import type { ReactNode } from 'react'
import { Banner, buttonCss, Icon, kit, textStyle } from '@shazlo/ui/components'
import { ApiError } from '../../api'

/** The white card of V-01 / V-03 (and V-02's form): r12, 1 px line border, 40 px padding, 24 px gap. */
export const AuthCard = styled('div', { shouldForwardProp: p => p !== 'width' && p !== 'gap' })<{ width?: number; gap?: number }>(
  ({ width, gap = 24 }) => ({
    background: kit.surface,
    border: `1px solid ${kit.line}`,
    borderRadius: 12,
    // Penpot draws the 1 px stroke inside the 40 px padding.
    padding: 39,
    display: 'flex',
    flexDirection: 'column',
    gap,
    width: '100%',
    maxWidth: width,
    minWidth: 0,
    '@media (max-width: 600px)': { padding: '28px 20px' },
  }),
)

/** A link styled as a kit button, for mailto: and other non-router targets. */
export const ButtonAnchor = styled('a', { shouldForwardProp: p => p !== 'variant' && p !== 'fullWidth' })<{
  variant?: 'primary' | 'secondary'
  fullWidth?: boolean
}>(({ variant = 'primary', fullWidth }) => buttonCss(variant, 'md', fullWidth))

/** Small rounded chip with a 14 px glyph: "Kalki Studio is approved" (V-03). */
export function Chip({ icon = 'check', children }: { icon?: 'check' | 'clock' | 'x'; children: ReactNode }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        alignSelf: 'flex-start',
        padding: '4px 10px 4px 8px',
        borderRadius: 999,
        background: kit.chip,
        color: kit.ink,
        ...textStyle.caption,
      }}
    >
      <Icon name={icon} size={14} />
      {children}
    </span>
  )
}

/** Form-level error above the fields (wrong password, network trouble). */
export function FormAlert({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return <Banner role="alert" icon="alert" accent={kit.error} title={title}>{children}</Banner>
}

/** Only same-site paths are allowed as a post-sign-in destination. */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/'
  if (next.startsWith('/sign-in') || next.startsWith('/set-password')) return '/'
  return next
}

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim())

export function focusField(id: string) {
  document.getElementById(id)?.focus()
}

/** Message for a failed call: the API's own copy, or a fix-it hint when the network failed. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  return 'We couldn’t reach Shazlo. Check your connection and try again.'
}
