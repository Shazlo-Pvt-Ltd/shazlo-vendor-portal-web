import { styled, type CSSObject } from '@mui/material/styles'
import { useId, type InputHTMLAttributes, type ReactNode, type Ref, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { kit, textStyle } from '../kit'
import { Icon, type IconName } from './Icon'

const fieldBox = (invalid?: boolean): CSSObject => ({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  background: kit.surface,
  border: invalid ? `1.5px solid ${kit.error}` : `1px solid ${kit.field}`,
  borderRadius: 6,
  // Penpot draws strokes inside the box: 8 px padding + 17 px line = 33 px including the border.
  padding: invalid ? '6.5px 10.5px' : '7px 11px',
  minHeight: 33,
  boxSizing: 'border-box',
  width: '100%',
  '&:focus-within': { borderColor: invalid ? kit.error : kit.brown, boxShadow: `0 0 0 2px ${invalid ? 'rgba(163, 58, 6, 0.18)' : 'rgba(122, 69, 30, 0.18)'}` },
})

const bare: CSSObject = {
  ...textStyle.body,
  color: kit.ink,
  border: 0,
  outline: 0,
  background: 'transparent',
  padding: 0,
  margin: 0,
  width: '100%',
  minWidth: 0,
  '&::placeholder': { color: kit.subtle, opacity: 1 },
  '@media (max-width: 600px)': { fontSize: 16 },
}

const FieldBox = styled('div', { shouldForwardProp: p => p !== 'as' && p !== 'invalid' })<{ invalid?: boolean }>(({ invalid }) => fieldBox(invalid))
const BareInput = styled('input')(bare)
const BareTextarea = styled('textarea')({ ...bare, resize: 'vertical', lineHeight: 1.35, minHeight: 72 })
const BareSelect = styled('select')({ ...bare, appearance: 'none', cursor: 'pointer', paddingRight: 24 })

export interface FieldProps {
  label?: ReactNode
  /** Shown beside the label, e.g. a "Changed" tag or "Optional". */
  labelAside?: ReactNode
  helper?: ReactNode
  error?: ReactNode
  id?: string
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode
  style?: React.CSSProperties
}

/** Label (Bodoni 13/600), control, and helper or error text, wired up for screen readers. */
export function Field({ label, labelAside, helper, error, id: idProp, children, style }: FieldProps) {
  const auto = useId()
  const id = idProp ?? auto
  const helpId = `${id}-help`
  const invalid = Boolean(error)
  const help = error ?? helper
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, ...style }}>
      {label && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
          <label htmlFor={id} style={{ ...textStyle.label, color: kit.ink }}>{label}</label>
          {labelAside}
        </div>
      )}
      {children({ id, describedBy: help ? helpId : undefined, invalid })}
      {help && (
        <div id={helpId} style={{ display: 'flex', alignItems: 'center', gap: 4, ...textStyle.caption, color: invalid ? kit.error : kit.subtle }}>
          {invalid && <Icon name="alert" size={12} strokeWidth={1.75} />}
          <span>{help}</span>
        </div>
      )}
    </div>
  )
}

type InputBase = Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'>

export interface TextInputProps extends InputBase {
  label?: ReactNode
  labelAside?: ReactNode
  helper?: ReactNode
  error?: ReactNode
  icon?: IconName
  prefix?: ReactNode
  suffix?: ReactNode
  ref?: Ref<HTMLInputElement>
  fieldStyle?: React.CSSProperties
}

export function TextInput({ label, labelAside, helper, error, icon, prefix, suffix, id, style, fieldStyle, ...rest }: TextInputProps) {
  return (
    <Field label={label} labelAside={labelAside} helper={helper} error={error} id={id} style={style}>
      {({ id: inputId, describedBy, invalid }) => (
        <FieldBox invalid={invalid} style={fieldStyle}>
          {icon && <Icon name={icon} size={16} color={kit.muted} />}
          {prefix && <span style={{ ...textStyle.body, color: kit.subtle }}>{prefix}</span>}
          <BareInput id={inputId} aria-invalid={invalid || undefined} aria-describedby={describedBy} {...rest} />
          {suffix}
        </FieldBox>
      )}
    </Field>
  )
}

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode
  labelAside?: ReactNode
  helper?: ReactNode
  error?: ReactNode
  ref?: Ref<HTMLTextAreaElement>
}

export function TextArea({ label, labelAside, helper, error, id, style, rows = 4, ...rest }: TextAreaProps) {
  return (
    <Field label={label} labelAside={labelAside} helper={helper} error={error} id={id} style={style}>
      {({ id: inputId, describedBy, invalid }) => (
        <FieldBox invalid={invalid} style={{ alignItems: 'flex-start' }}>
          <BareTextarea id={inputId} rows={rows} aria-invalid={invalid || undefined} aria-describedby={describedBy} {...rest} />
        </FieldBox>
      )}
    </Field>
  )
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label?: ReactNode
  labelAside?: ReactNode
  helper?: ReactNode
  error?: ReactNode
  options: Array<{ value: string; label: string } | string>
  ref?: Ref<HTMLSelectElement>
  fieldStyle?: React.CSSProperties
}

export function Select({ label, labelAside, helper, error, options, id, style, fieldStyle, ...rest }: SelectProps) {
  return (
    <Field label={label} labelAside={labelAside} helper={helper} error={error} id={id} style={style}>
      {({ id: inputId, describedBy, invalid }) => (
        <FieldBox invalid={invalid} style={{ position: 'relative', ...fieldStyle }}>
          <BareSelect id={inputId} aria-invalid={invalid || undefined} aria-describedby={describedBy} {...rest}>
            {options.map(o => {
              const opt = typeof o === 'string' ? { value: o, label: o } : o
              return <option key={opt.value} value={opt.value}>{opt.label}</option>
            })}
          </BareSelect>
          <Icon name="chevronDown" size={16} color={kit.muted} style={{ position: 'absolute', right: 12, pointerEvents: 'none' }} />
        </FieldBox>
      )}
    </Field>
  )
}

/** Compact filter dropdown used in table toolbars ("Category: All"). */
export function FilterSelect({ label, value, options, onChange, width }: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
  width?: number
}) {
  const id = useId()
  return (
    <FieldBox style={{ position: 'relative', width: width ?? 'auto', padding: '7px 32px 7px 12px' }}>
      <label htmlFor={id} style={{ ...textStyle.small, color: kit.subtle, whiteSpace: 'nowrap' }}>{label}</label>
      <BareSelect id={id} value={value} onChange={e => onChange(e.target.value)} style={{ ...textStyle.small, paddingRight: 0 }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </BareSelect>
      <Icon name="chevronDown" size={14} color={kit.muted} style={{ position: 'absolute', right: 12, pointerEvents: 'none' }} />
    </FieldBox>
  )
}

const CheckInput = styled('input')({
  appearance: 'none',
  margin: 0,
  width: 16,
  height: 16,
  borderRadius: 4,
  border: `1px solid ${kit.field}`,
  background: kit.surface,
  display: 'inline-grid',
  placeContent: 'center',
  cursor: 'pointer',
  flexShrink: 0,
  '&:checked': {
    background: kit.brown,
    borderColor: kit.brown,
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23FFFCE3' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 6 9 17l-5-5'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'center',
  },
  '&:indeterminate': {
    background: kit.brown,
    borderColor: kit.brown,
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23FFFCE3' stroke-width='2.5' stroke-linecap='round'%3E%3Cpath d='M6 12h12'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'center',
  },
  '&[type="radio"]': { borderRadius: 999 },
  '&[type="radio"]:checked': { background: kit.surface, borderColor: kit.brown, borderWidth: 5, backgroundImage: 'none' },
  '&:focus-visible': { outline: `2px solid ${kit.focus}`, outlineOffset: 2 },
  '&:disabled': { opacity: 0.5, cursor: 'not-allowed' },
})

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: ReactNode
  indeterminate?: boolean
  radio?: boolean
}

export function Checkbox({ label, indeterminate, radio, style, ...rest }: CheckboxProps) {
  const ref = (el: HTMLInputElement | null) => {
    if (el) el.indeterminate = Boolean(indeterminate)
  }
  const input = <CheckInput ref={ref} type={radio ? 'radio' : 'checkbox'} {...rest} />
  if (!label) return input
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', ...textStyle.small, color: kit.ink, ...style }}>
      {input}
      <span>{label}</span>
    </label>
  )
}

/** On/off switch (Draft / Live, notification settings). */
export function Switch({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; id?: string }) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      style={{
        width: 32,
        height: 18,
        borderRadius: 999,
        border: 0,
        padding: 2,
        background: checked ? kit.brown : kit.field,
        display: 'inline-flex',
        justifyContent: checked ? 'flex-end' : 'flex-start',
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      <span style={{ width: 14, height: 14, borderRadius: 999, background: kit.surface }} />
    </button>
  )
}
