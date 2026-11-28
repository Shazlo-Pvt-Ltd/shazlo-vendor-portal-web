import { Box, Typography } from '@mui/material'
import { brand, neutral, radius, status } from '@shazlo/ui'
import { Check } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { srOnly } from '../../../lib/a11y'

export type Choice = { value: string; label: string; swatch?: { background: string; border: boolean } }

// One chip: a real radio (keyboard and screen readers get native behaviour) inside a
// label drawn as a chip. Chosen chips get a darker border, a tint and a tick, never colour alone.
function Chip({ type, name, choice, checked, disabled, inputId, describedBy, onToggle }: { type: 'radio' | 'checkbox'; name: string; choice: Choice; checked: boolean; disabled: boolean; inputId?: string; describedBy?: string; onToggle: () => void }) {
  return (
    <Box
      component="label"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.75,
        minHeight: 44,
        px: 1.5,
        borderRadius: `${radius.pill}px`,
        border: `1px solid ${checked ? brand.brown : neutral.lineStrong}`,
        boxShadow: checked ? `inset 0 0 0 1px ${brand.brown}` : 'none',
        bgcolor: checked ? neutral.placeholder : 'transparent',
        color: neutral.ink,
        typography: 'body2',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled && !checked ? 0.6 : 1,
        userSelect: 'none',
        '@media (hover: hover)': { '&:hover': { bgcolor: disabled ? undefined : neutral.placeholder } },
        '&:has(input:focus-visible)': { outline: `2px solid ${brand.navy}`, outlineOffset: '2px' },
      }}
    >
      <input type={type} name={name} id={inputId} value={choice.value} checked={checked} disabled={disabled} onChange={onToggle} aria-describedby={describedBy} style={srOnly} />
      {choice.swatch && (
        <Box
          component="span"
          aria-hidden="true"
          sx={{ width: 18, height: 18, borderRadius: '50%', flexShrink: 0, background: choice.swatch.background, border: choice.swatch.border ? `1px solid ${neutral.lineStrong}` : 'none' }}
        />
      )}
      <span>{choice.label}</span>
      {checked && <Check size={14} strokeWidth={2} aria-hidden="true" color={brand.brown} />}
    </Box>
  )
}

type GroupProps = {
  legend: string
  hint?: ReactNode
  error?: string
  choices: readonly Choice[]
  disabled?: boolean
  // Given to the first chip's input, so a problem link can move focus to the group.
  firstId?: string
}

function Group({ legend, hint, error, children }: { legend: string; hint?: ReactNode; error?: string; children: (describedBy: string | undefined) => ReactNode }) {
  const hintId = useId()
  const errorId = useId()
  const describedBy = [hint ? hintId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined
  return (
    <Box component="fieldset" sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}>
      <Typography component="legend" variant="subtitle1" sx={{ p: 0, mb: 0.5 }}>
        {legend}
      </Typography>
      {hint && (
        <Typography id={hintId} variant="body2" color="textSecondary" sx={{ mb: 1 }}>
          {hint}
        </Typography>
      )}
      {error && (
        <Typography id={errorId} variant="body2" sx={{ color: status.error, mb: 1 }}>
          {error}
        </Typography>
      )}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: hint || error ? 0 : 0.5 }}>{children(describedBy)}</Box>
    </Box>
  )
}

// Choose one (gender, product type).
export function RadioChips({ legend, hint, error, choices, disabled = false, firstId, value, onChange }: GroupProps & { value: string; onChange: (value: string) => void }) {
  const name = useId()
  return (
    <Group legend={legend} hint={hint} error={error}>
      {(describedBy) =>
        choices.map((choice, i) => (
          <Chip key={choice.value} type="radio" name={name} choice={choice} checked={value === choice.value} disabled={disabled} inputId={i === 0 ? firstId : undefined} describedBy={describedBy} onToggle={() => onChange(choice.value)} />
        ))
      }
    </Group>
  )
}
