import Popover from '@mui/material/Popover'
import { styled } from '@mui/material/styles'
import { useId, useState } from 'react'
import { Button, Checkbox, Field, Icon, kit, Text, textStyle } from '@shazlo/ui/components'
import { rupees } from '../../lib/format'

// Two V-02 controls the kit has no component for: the "What do you sell?" multi-choice
// dropdown and the two-handle "Typical price range" slider.

/* ---------- What do you sell? ---------- */

export const productTypeOptions = ['Kurtas', 'Co-ords', 'Dupattas', 'Sarees', 'Dresses', 'Tops and shirts', 'Bottoms', 'Jackets', 'Accessories'] as const

/** "Kurtas, co-ords, dupattas": sentence case, as the wireframe writes it. */
export function describeTypes(types: string[]) {
  const text = types.join(', ').toLowerCase()
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const Trigger = styled('button', { shouldForwardProp: p => p !== 'invalid' })<{ invalid?: boolean }>(({ invalid }) => ({
  ...textStyle.body,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  minHeight: 33,
  padding: invalid ? '7.5px 11.5px' : '8px 12px',
  background: kit.surface,
  border: invalid ? `1.5px solid ${kit.error}` : `1px solid ${kit.field}`,
  borderRadius: 6,
  color: kit.ink,
  cursor: 'pointer',
  textAlign: 'left',
  '&:focus-visible': { outline: 0, borderColor: invalid ? kit.error : kit.brown, boxShadow: `0 0 0 2px ${invalid ? 'rgba(163, 58, 6, 0.18)' : 'rgba(122, 69, 30, 0.18)'}` },
  '@media (max-width: 600px)': { fontSize: 16 },
}))

export function ProductTypePicker({ id, value, onChange, error }: {
  id: string
  value: string[]
  onChange: (v: string[]) => void
  error?: string
}) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
  const listId = useId()
  const toggle = (t: string) => onChange(value.includes(t) ? value.filter(x => x !== t) : productTypeOptions.filter(o => o === t || value.includes(o)))
  return (
    <Field id={id} label="What do you sell?" error={error}>
      {({ id: fieldId, describedBy, invalid }) => (
        <>
          <Trigger
            id={fieldId}
            type="button"
            invalid={invalid}
            aria-haspopup="dialog"
            aria-expanded={Boolean(anchor)}
            aria-controls={anchor ? listId : undefined}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            onClick={e => setAnchor(e.currentTarget)}
          >
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: value.length ? kit.ink : kit.subtle }}>
              {value.length ? describeTypes(value) : 'Choose one or more'}
            </span>
            <Icon name="chevronDown" size={16} color={kit.muted} />
          </Trigger>
          <Popover
            open={Boolean(anchor)}
            anchorEl={anchor}
            onClose={() => { setAnchor(null); document.getElementById(fieldId)?.focus() }}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            transformOrigin={{ vertical: 'top', horizontal: 'left' }}
            slotProps={{
              paper: {
                sx: { mt: '4px', width: anchor?.offsetWidth, maxWidth: 'calc(100vw - 32px)', background: kit.surface, border: `1px solid ${kit.line}`, borderRadius: '8px', boxShadow: '0 12px 32px rgba(23, 18, 14, 0.14)' },
              },
            }}
          >
            <div id={listId} role="group" aria-label="Product types" style={{ display: 'flex', flexDirection: 'column', padding: '6px 0' }}>
              {productTypeOptions.map(t => (
                <Checkbox
                  key={t}
                  label={t}
                  checked={value.includes(t)}
                  onChange={() => toggle(t)}
                  style={{ padding: '0 14px', minHeight: 36 }}
                />
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 14px 4px', borderTop: `1px solid ${kit.line}`, marginTop: 6 }}>
                <Text v="caption" tone="subtle">{value.length ? `${value.length} chosen` : 'Pick all that apply'}</Text>
                <Button size="sm" variant="secondary" onClick={() => { setAnchor(null); document.getElementById(fieldId)?.focus() }}>Done</Button>
              </div>
            </div>
          </Popover>
        </>
      )}
    </Field>
  )
}

/* ---------- Typical price range ---------- */

export const PRICE_MIN = 500
export const PRICE_MAX = 10_000
export const PRICE_STEP = 100

const Thumbs = styled('input')({
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  margin: 0,
  padding: 0,
  background: 'transparent',
  WebkitAppearance: 'none',
  appearance: 'none',
  pointerEvents: 'none',
  outline: 0,
  '&::-webkit-slider-runnable-track': { background: 'transparent', height: 16, border: 0 },
  '&::-webkit-slider-thumb': {
    WebkitAppearance: 'none',
    appearance: 'none',
    pointerEvents: 'auto',
    boxSizing: 'border-box',
    width: 16,
    height: 16,
    borderRadius: 999,
    background: kit.surface,
    border: `1.5px solid ${kit.ink}`,
    cursor: 'grab',
  },
  '&::-moz-range-track': { background: 'transparent', border: 0 },
  '&::-moz-range-thumb': {
    pointerEvents: 'auto',
    boxSizing: 'border-box',
    width: 16,
    height: 16,
    borderRadius: 999,
    background: kit.surface,
    border: `1.5px solid ${kit.ink}`,
    cursor: 'grab',
  },
  '&:focus-visible::-webkit-slider-thumb': { boxShadow: `0 0 0 2px ${kit.surface}, 0 0 0 4px ${kit.focus}` },
  '&:focus-visible::-moz-range-thumb': { boxShadow: `0 0 0 2px ${kit.surface}, 0 0 0 4px ${kit.focus}` },
})

/** Position of a handle's centre along a track whose ends are inset by half a handle. */
const at = (v: number) => `calc(8px + ${(v - PRICE_MIN) / (PRICE_MAX - PRICE_MIN)} * (100% - 16px))`

export function PriceRange({ low, high, onChange }: { low: number; high: number; onChange: (low: number, high: number) => void }) {
  const labelId = useId()
  return (
    <div role="group" aria-labelledby={labelId} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Text v="label" id={labelId}>Typical price range</Text>
      <div style={{ position: 'relative', height: 16 }}>
        <span aria-hidden style={{ position: 'absolute', left: 0, right: 0, top: 6, height: 4, background: kit.chip }} />
        <span aria-hidden style={{ position: 'absolute', top: 6, height: 4, background: kit.amber, left: at(low), width: `calc(${at(high)} - ${at(low)})` }} />
        <Thumbs
          type="range"
          aria-label="Lowest typical price"
          aria-valuetext={rupees(low)}
          min={PRICE_MIN}
          max={PRICE_MAX}
          step={PRICE_STEP}
          value={low}
          // Once the low handle is past the middle it sits on top, so it can be dragged back out.
          style={{ zIndex: low > (PRICE_MIN + PRICE_MAX) / 2 ? 2 : 1 }}
          onChange={e => onChange(Math.min(Number(e.target.value), high - PRICE_STEP), high)}
        />
        <Thumbs
          type="range"
          aria-label="Highest typical price"
          aria-valuetext={rupees(high)}
          min={PRICE_MIN}
          max={PRICE_MAX}
          step={PRICE_STEP}
          value={high}
          onChange={e => onChange(low, Math.max(Number(e.target.value), low + PRICE_STEP))}
        />
      </div>
      <div aria-hidden style={{ display: 'flex', justifyContent: 'space-between', ...textStyle.caption, color: kit.muted, fontVariantNumeric: 'tabular-nums' }}>
        <span>{rupees(low)}</span>
        <span>{high >= PRICE_MAX ? `${rupees(high)}+` : rupees(high)}</span>
      </div>
    </div>
  )
}
