import { styled, type CSSObject } from '@mui/material/styles'
import type { ButtonHTMLAttributes, CSSProperties, ElementType, HTMLAttributes, ReactNode, Ref } from 'react'
import logoUrl from '../assets/shazlo-logo.png'
import { badgeTone, kit, textStyle, textTone, type BadgeTone, type TextTone, type TextVariant } from '../kit'
import { Icon, type IconName } from './Icon'
import { useUiLink } from './link'

export const focusRing: CSSObject = {
  '&:focus-visible': { outline: `2px solid ${kit.focus}`, outlineOffset: 2 },
}

/* ---------- Text ---------- */

export interface TextProps extends HTMLAttributes<HTMLElement> {
  v?: TextVariant
  tone?: TextTone
  as?: ElementType
  /** Truncate to one line with an ellipsis. */
  truncate?: boolean
  tabular?: boolean
  htmlFor?: string
  ref?: Ref<HTMLElement>
}

export function Text({ v = 'small', tone = 'ink', as, truncate, tabular, style, ...rest }: TextProps) {
  const Component = (as ?? 'span') as ElementType
  const s = textStyle[v]
  return (
    <Component
      style={{
        ...s,
        color: textTone[tone],
        margin: 0,
        ...(truncate && { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }),
        ...(tabular && { fontVariantNumeric: 'tabular-nums' }),
        ...style,
      }}
      {...rest}
    />
  )
}

/* ---------- Surfaces ---------- */

export const Card = styled('div', { shouldForwardProp: p => p !== 'as' && p !== 'pad' && p !== 'gap' && p !== 'radius' })<{ pad?: number | string; gap?: number; radius?: number }>(
  ({ pad = 20, gap = 16, radius = 8 }) => ({
    background: kit.surface,
    border: `1px solid ${kit.line}`,
    borderRadius: radius,
    // Penpot strokes sit inside the frame, so subtract the 1 px border to keep content where the spec puts it.
    padding: typeof pad === 'number' ? Math.max(0, pad - 1) : pad,
    display: 'flex',
    flexDirection: 'column',
    gap,
    minWidth: 0,
  }),
)

/** A bordered list whose rows are separated by 1 px rules (the wireframes' "bg=line, gap 1" pattern). */
export const ListCard = styled('div')({
  background: kit.line,
  // Penpot strokes are inside the frame: an inset outline keeps rows where the spec puts them.
  outline: `1px solid ${kit.line}`,
  outlineOffset: -1,
  borderRadius: 8,
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  overflow: 'hidden',
  minWidth: 0,
  '& > *': { background: kit.surface },
})

export const ListHeader = styled('div')({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '16px 20px',
})

export const Rule = styled('hr')({ border: 0, height: 1, background: kit.line, margin: 0, width: '100%', flexShrink: 0 })

export const Row = styled('div', { shouldForwardProp: p => p !== 'as' && !['gap', 'align', 'justify', 'wrap'].includes(String(p)) })<{
  gap?: number
  align?: CSSProperties['alignItems']
  justify?: CSSProperties['justifyContent']
  wrap?: boolean
}>(({ gap = 8, align = 'center', justify = 'flex-start', wrap }) => ({
  display: 'flex',
  flexDirection: 'row',
  alignItems: align,
  justifyContent: justify,
  gap,
  minWidth: 0,
  flexWrap: wrap ? 'wrap' : 'nowrap',
}))

export const Stack = styled('div', { shouldForwardProp: p => p !== 'as' && !['gap', 'align'].includes(String(p)) })<{
  gap?: number
  align?: CSSProperties['alignItems']
}>(({ gap = 8, align = 'stretch' }) => ({ display: 'flex', flexDirection: 'column', gap, alignItems: align, minWidth: 0 }))

/* ---------- Brand ---------- */

/** The brush "SHAZLO" wordmark. The PNG is used as a mask so it can be drawn in ink or off-white. */
export function Logo({ tag, tone = 'ink', height = 28 }: { tag?: string; tone?: 'ink' | 'inverse'; height?: number }) {
  const width = Math.round(height * (93 / 28))
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span
        role="img"
        aria-label="Shazlo"
        style={{
          display: 'block',
          width,
          height,
          backgroundColor: tone === 'ink' ? kit.ink : kit.offWhite,
          WebkitMaskImage: `url(${logoUrl})`,
          maskImage: `url(${logoUrl})`,
          WebkitMaskSize: 'contain',
          maskSize: 'contain',
          WebkitMaskRepeat: 'no-repeat',
          maskRepeat: 'no-repeat',
          WebkitMaskPosition: 'left center',
          maskPosition: 'left center',
        }}
      />
      {tag && <ProductTag tone={tone === 'ink' ? 'light' : 'dark'}>{tag}</ProductTag>}
    </span>
  )
}

/** Small bordered caps label: "SELLER", "ONE", "STAGING". */
export function ProductTag({ children, tone = 'light' }: { children: ReactNode; tone?: 'light' | 'dark' }) {
  return (
    <span
      style={{
        ...textStyle.overline,
        color: tone === 'light' ? kit.muted : kit.offWhite,
        border: `1px solid ${tone === 'light' ? kit.field : kit.subtle}`,
        borderRadius: 4,
        padding: '2px 6px',
        display: 'inline-flex',
        alignItems: 'center',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  )
}

export function Avatar({ initials, size = 28, src }: { initials: string; size?: number; src?: string }) {
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        background: kit.cream,
        color: kit.brown,
        ...textStyle.caption,
        fontSize: size >= 40 ? 15 : 12,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        overflow: 'hidden',
        backgroundImage: src ? `url(${src})` : undefined,
        backgroundSize: 'cover',
      }}
    >
      {src ? null : initials}
    </span>
  )
}

/** Photo slot: a sand-coloured tile with a faint image glyph until a real photo exists. */
export function ImagePlaceholder({ width = 40, height = 48, src, alt = '', radius = 6, iconSize = 24, style }: {
  width?: number | string
  height?: number | string
  src?: string
  alt?: string
  radius?: number
  iconSize?: number
  style?: CSSProperties
}) {
  if (src) {
    return <img src={src} alt={alt} style={{ width, height, borderRadius: radius, objectFit: 'cover', flexShrink: 0, display: 'block', ...style }} />
  }
  return (
    <span
      role={alt ? 'img' : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
      style={{
        width,
        height,
        borderRadius: radius,
        background: kit.placeholder,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        ...style,
      }}
    >
      <Icon name="image" size={iconSize} color={kit.ink} style={{ opacity: 0.45 }} />
    </span>
  )
}

export function ProgressBar({ value, max = 100, label }: { value: number; max?: number; label?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={label}
      style={{ height: 6, borderRadius: 999, background: kit.chip, width: '100%', overflow: 'hidden' }}
    >
      <div style={{ width: `${pct}%`, height: '100%', background: kit.amber, borderRadius: 3 }} />
    </div>
  )
}

export function Mono({ children, tone = 'subtle', style }: { children: ReactNode; tone?: TextTone; style?: CSSProperties }) {
  return <Text v="mono" tone={tone} style={style}>{children}</Text>
}

/* ---------- Status badge ---------- */

const badgeGlyph: Record<BadgeTone, IconName> = {
  live: 'check', approved: 'check', info: 'info', publishing: 'refresh', pending: 'clock', sentBack: 'x', rejected: 'x',
  failed: 'x', draft: 'edit', suspended: 'ban',
}

export const badgeLabel: Record<BadgeTone, string> = {
  live: 'Live', approved: 'Approved', info: 'Info', publishing: 'Publishing', pending: 'Pending review', sentBack: 'Sent back',
  rejected: 'Rejected', failed: 'Failed', draft: 'Draft', suspended: 'Suspended',
}

export function StatusBadge({ tone, children, icon }: { tone: BadgeTone; children?: ReactNode; icon?: IconName }) {
  const c = badgeTone[tone]
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px 2px 6px',
        borderRadius: 999,
        background: c.background,
        color: c.foreground,
        ...textStyle.caption,
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      <Icon name={icon ?? badgeGlyph[tone]} size={12} strokeWidth={1.75} />
      {children ?? badgeLabel[tone]}
    </span>
  )
}

/* ---------- Buttons ---------- */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'navy' | 'danger'
export type ButtonSize = 'md' | 'sm'

export function buttonCss(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', fullWidth = false): CSSObject {
  const md = size === 'md'
  const palette: Record<ButtonVariant, CSSObject> = {
    primary: { background: kit.amber, borderColor: kit.amberEdge, color: kit.wine, '&:hover:not(:disabled)': { background: kit.amberHover } },
    secondary: { background: kit.surface, borderColor: kit.field, color: kit.ink, '&:hover:not(:disabled)': { background: '#FBF4E2' } },
    ghost: { background: 'transparent', borderColor: 'transparent', color: kit.ink, '&:hover:not(:disabled)': { background: 'rgba(122, 69, 30, 0.08)' } },
    navy: { background: kit.navy, borderColor: kit.navy, color: kit.offWhite, '&:hover:not(:disabled)': { background: kit.navyHover } },
    danger: { background: kit.surface, borderColor: '#E3B9A3', color: '#8F3504', '&:hover:not(:disabled)': { background: '#FDF0E7' } },
  }
  return {
    ...(md ? textStyle.button : textStyle.caption),
    display: fullWidth ? 'flex' : 'inline-flex',
    width: fullWidth ? '100%' : undefined,
    alignItems: 'center',
    justifyContent: 'center',
    gap: md ? 8 : 6,
    padding: md ? '7px 14px' : '5px 10px',
    minHeight: md ? 33 : 27,
    border: '1px solid',
    borderRadius: 6,
    cursor: 'pointer',
    textDecoration: 'none',
    whiteSpace: 'nowrap',
    boxSizing: 'border-box',
    transition: 'background-color 150ms ease-out',
    flexShrink: 0,
    ...palette[variant],
    '&:disabled, &[aria-disabled="true"]': { opacity: 0.5, cursor: 'not-allowed' },
    ...focusRing,
  }
}

const StyledButton = styled('button', { shouldForwardProp: p => p !== 'as' && !['variant', 'size', 'fullWidth'].includes(String(p)) })<{
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
}>(({ variant, size, fullWidth }) => buttonCss(variant, size, fullWidth))

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: IconName
  iconEnd?: IconName
  fullWidth?: boolean
  /** Renders the app's router link instead of a button. */
  to?: string
  children?: ReactNode
  ref?: Ref<HTMLButtonElement>
}

export function Button({ variant = 'secondary', size = 'md', icon, iconEnd, fullWidth, to, children, type = 'button', ...rest }: ButtonProps) {
  const Link = useUiLink()
  const iconSize = size === 'md' ? 16 : 14
  const content = (
    <>
      {icon && <Icon name={icon} size={iconSize} />}
      {children}
      {iconEnd && <Icon name={iconEnd} size={iconSize} />}
    </>
  )
  if (to) {
    const AsLink = StyledButton as unknown as ElementType
    return (
      <AsLink as={Link} variant={variant} size={size} fullWidth={fullWidth} to={to} className={rest.className} style={rest.style} aria-label={rest['aria-label']} onClick={rest.onClick}>
        {content}
      </AsLink>
    )
  }
  return (
    <StyledButton variant={variant} size={size} fullWidth={fullWidth} type={type} {...rest}>
      {content}
    </StyledButton>
  )
}

export const IconButton = styled('button', { shouldForwardProp: p => p !== 'as' && p !== 'tone' })<{ tone?: 'light' | 'dark' }>(({ tone = 'light' }) => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 32,
  height: 32,
  margin: -7,
  padding: 0,
  border: 0,
  borderRadius: 6,
  background: 'transparent',
  color: tone === 'light' ? kit.muted : kit.navText,
  cursor: 'pointer',
  position: 'relative',
  flexShrink: 0,
  '&:hover': { background: tone === 'light' ? 'rgba(122, 69, 30, 0.08)' : 'rgba(255, 252, 227, 0.08)' },
  ...focusRing,
}))

/** Text link in Bodoni 13/600 link blue, as used for "View all", "Forgot password?", "Apply to sell". */
export function TextLink({ to, children, underline, onClick, v = 'label', style, external }: {
  to?: string
  children: ReactNode
  underline?: boolean
  onClick?: () => void
  v?: TextVariant
  style?: CSSProperties
  external?: boolean
}) {
  const Link = useUiLink()
  const css: CSSProperties = {
    ...textStyle[v],
    color: kit.link,
    textDecoration: underline ? 'underline' : 'none',
    textUnderlineOffset: 2,
    cursor: 'pointer',
    background: 'none',
    border: 0,
    padding: 0,
    ...style,
  }
  if (to && external) return <a href={to} style={css} target="_blank" rel="noreferrer">{children}</a>
  if (to) return <Link to={to} style={css} className="shz-link">{children}</Link>
  return <button type="button" onClick={onClick} style={css} className="shz-link">{children}</button>
}
