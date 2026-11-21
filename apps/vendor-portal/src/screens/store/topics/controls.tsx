import { Box, Button, Checkbox, FormControlLabel, FormHelperText, FormLabel, IconButton, Link, Radio, RadioGroup, Stack, TextField, Typography } from '@mui/material'
import { brand, neutral, radius, statusBackground } from '@shazlo/ui'
import { X } from 'lucide-react'
import { useId, useState, type HTMLAttributes, type KeyboardEvent, type ReactNode } from 'react'
import { storeCopy as copy } from '../../../copy/store'
import { srOnly } from '../../../lib/a11y'
import { fieldId } from './model'

// Form controls for the store-details topics (spec §8): labels always visible, "(optional)" in
// words and never an asterisk (no `required`), 16 px inputs, 44 px targets, radios for short lists,
// and the right keyboard on phones (inputmode / autocomplete on every field).

export const touch = { minHeight: 44 } as const
const inputText = { '& .MuiInputBase-input': { fontSize: '1rem' } } as const
const fieldset = { border: 0, p: 0, m: 0, minWidth: 0 } as const
const legend = { typography: 'body1', color: 'text.primary', mb: 0.75, '&.Mui-focused': { color: 'text.primary' }, '&.Mui-error': { color: 'text.primary' } } as const
// Radios and checkboxes in brown: yellow is only ever a button fill.
const control = { color: brand.brown, '&.Mui-checked': { color: brand.brown }, '&.Mui-focusVisible': { outline: `2px solid ${brand.navy}`, outlineOffset: -4 } } as const

type InputAttrs = Pick<HTMLAttributes<HTMLInputElement>, 'inputMode' | 'autoCapitalize' | 'autoCorrect' | 'spellCheck'>

export function TextInput({
  path,
  label,
  value,
  onChange,
  error,
  hint,
  autoComplete,
  type,
  attrs,
  end,
  multiline,
}: {
  path: string
  label: string
  value: string
  onChange: (value: string) => void
  error?: string
  hint?: ReactNode
  autoComplete: string
  type?: 'text' | 'email' | 'tel'
  attrs?: InputAttrs
  end?: ReactNode
  multiline?: boolean
}) {
  return (
    <TextField
      id={fieldId(path)}
      name={path}
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      type={type}
      autoComplete={autoComplete}
      error={Boolean(error)}
      helperText={error ?? hint}
      fullWidth
      multiline={multiline}
      minRows={multiline ? 2 : undefined}
      sx={inputText}
      slotProps={{ htmlInput: { ...attrs }, ...(end ? { input: { endAdornment: end } } : {}) }}
    />
  )
}

// Shared keyboard settings.
export const keyboards = {
  // Email, UPI ID and IFSC: no capitals, corrections or red underlines.
  plain: { autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false },
  email: { inputMode: 'email', autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false },
  upi: { inputMode: 'email', autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false },
  ifsc: { autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false },
  code: { autoCapitalize: 'characters', autoCorrect: 'off', spellCheck: false },
  numeric: { inputMode: 'numeric' },
  decimal: { inputMode: 'decimal' },
  tel: { inputMode: 'tel' },
} as const satisfies Record<string, InputAttrs>

export type Option<V> = { value: V; label: string; hint?: string }

// One choice from a few: radios, never a dropdown. The first radio carries the field id, so the
// error summary can send focus to the group.
export function ChoiceGroup<V extends string | number>({
  path,
  legend: title,
  hint,
  value,
  options,
  onChange,
  error,
  row = false,
}: {
  path: string
  legend: string
  hint?: string
  value: V | null | ''
  options: readonly Option<V>[]
  onChange: (value: V) => void
  error?: string
  row?: boolean
}) {
  const helpId = useId()
  const help = error ?? hint
  return (
    <Box component="fieldset" aria-describedby={help ? helpId : undefined} sx={fieldset}>
      <FormLabel component="legend" error={Boolean(error)} sx={legend}>
        {title}
      </FormLabel>
      <RadioGroup
        name={path}
        row={row}
        value={value === null || value === '' ? '' : String(value)}
        onChange={(_, next) => {
          const option = options.find((o) => String(o.value) === next)
          if (option) onChange(option.value)
        }}
        sx={{ gap: row ? { xs: 0, sm: 1 } : 0, columnGap: 2 }}
      >
        {options.map((o, i) => (
          <FormControlLabel
            key={String(o.value)}
            value={String(o.value)}
            control={<Radio id={i === 0 ? fieldId(path) : undefined} sx={control} />}
            label={
              o.hint ? (
                <Box component="span" sx={{ display: 'block', py: 1 }}>
                  <Typography component="span" variant="body1" sx={{ display: 'block' }}>
                    {o.label}
                  </Typography>
                  <Typography component="span" variant="body2" color="text.secondary" sx={{ display: 'block' }}>
                    {o.hint}
                  </Typography>
                </Box>
              ) : (
                o.label
              )
            }
            sx={{ ...touch, mr: row ? 2 : 0, alignItems: o.hint ? 'flex-start' : 'center', '& .MuiRadio-root': o.hint ? { mt: 0.5 } : {} }}
          />
        ))}
      </RadioGroup>
      {help && (
        <FormHelperText id={helpId} error={Boolean(error)} sx={{ mx: 0, mt: 0.5 }}>
          {help}
        </FormHelperText>
      )}
    </Box>
  )
}

// A yes/no tick box, with its own message (agreements) or none (inside a CheckGroup).
export function CheckOption({ id, label, checked, onChange, error }: { id?: string; label: ReactNode; checked: boolean; onChange: (checked: boolean) => void; error?: string }) {
  const helpId = useId()
  return (
    <Box>
      <FormControlLabel
        control={
          <Checkbox
            id={id}
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            sx={control}
            slotProps={{ input: { 'aria-describedby': error ? helpId : undefined, 'aria-invalid': error ? true : undefined } as Record<string, unknown> }}
          />
        }
        label={label}
        // Long labels (the price rule) wrap beside the box, starting level with it.
        sx={{ ...touch, mr: 0, alignItems: 'flex-start', '& .MuiFormControlLabel-label': { pt: '11px', pb: 1 } }}
      />
      {error && (
        <FormHelperText id={helpId} error sx={{ mx: 0, mt: 0 }}>
          {error}
        </FormHelperText>
      )}
    </Box>
  )
}

// Several tick boxes answering one question, with one message for the group.
// The first box takes the group's field id (fieldId(path)), so the error summary can reach it.
export function CheckGroup({ legend: title, hint, error, children }: { legend: string; hint?: string; error?: string; children: ReactNode }) {
  const helpId = useId()
  const help = error ?? hint
  return (
    <Box component="fieldset" aria-describedby={help ? helpId : undefined} sx={fieldset}>
      <FormLabel component="legend" error={Boolean(error)} sx={legend}>
        {title}
      </FormLabel>
      <Stack>{children}</Stack>
      {help && (
        <FormHelperText id={helpId} error={Boolean(error)} sx={{ mx: 0, mt: 0.5 }}>
          {help}
        </FormHelperText>
      )}
    </Box>
  )
}

// A titled group of text fields (the pickup address).
export function FieldGroup({ legend: title, hint, children }: { legend: string; hint?: string; children: ReactNode }) {
  const hintId = useId()
  return (
    <Box component="fieldset" aria-describedby={hint ? hintId : undefined} sx={fieldset}>
      <FormLabel component="legend" sx={{ ...legend, mb: hint ? 0.25 : 1.5 }}>
        {title}
      </FormLabel>
      {hint && (
        <Typography id={hintId} variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {hint}
        </Typography>
      )}
      <Stack spacing={2.5}>{children}</Stack>
    </Box>
  )
}

// Cities or PIN codes as removable chips. What is typed but not added yet counts too: Continue and
// Save add it (placesOf in ./model.ts), so nobody loses a place by forgetting to press Add.
export function PlacesField({
  path,
  places,
  typed,
  onChange,
  error,
}: {
  path: string
  places: readonly string[]
  typed: string
  // One call per change, with both: adding a place also empties the field.
  onChange: (places: string[], typed: string) => void
  error?: string
}) {
  const listId = useId()
  const [announce, setAnnounce] = useState('')
  const c = copy.delivery

  const add = () => {
    const fresh = [...new Set(typed.split(',').map((p) => p.trim()))].filter((p) => p && !places.includes(p))
    onChange([...places, ...fresh], '')
    if (fresh.length) setAnnounce(fresh.join(', '))
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    // Enter adds the place instead of sending the form.
    e.preventDefault()
    add()
  }

  return (
    <Box>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
        <TextField
          id={fieldId(path)}
          name={path}
          label={c.place}
          value={typed}
          onChange={(e) => onChange([...places], e.target.value)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          error={Boolean(error)}
          helperText={error ?? c.placeHint}
          fullWidth
          sx={inputText}
          slotProps={{ htmlInput: { 'aria-controls': places.length ? listId : undefined, enterKeyHint: 'done' } }}
        />
        <Button variant="outlined" onClick={add} sx={{ ...touch, minHeight: 56, flexShrink: 0 }}>
          {c.addPlace}
        </Button>
      </Stack>
      {places.length > 0 && (
        <Box component="ul" id={listId} aria-label={c.placesLabel} sx={{ listStyle: 'none', p: 0, m: 0, mt: 1.5, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {places.map((place) => (
            <Box
              component="li"
              key={place}
              sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, pl: 1.75, minHeight: 44, borderRadius: `${radius.pill}px`, border: `1px solid ${neutral.lineStrong}`, bgcolor: neutral.surface }}
            >
              <Typography variant="body1" component="span">
                {place}
              </Typography>
              <IconButton
                aria-label={c.removePlace(place)}
                onClick={() => onChange(places.filter((p) => p !== place), typed)}
                sx={{ width: 44, height: 44, color: neutral.inkSecondary }}
              >
                <X size={16} strokeWidth={1.75} aria-hidden="true" />
              </IconButton>
            </Box>
          ))}
        </Box>
      )}
      <Box role="status" sx={srOnly}>
        {announce && c.added(announce)}
      </Box>
    </Box>
  )
}

// GOV.UK-style error summary at the top of the page: every problem, in page order, each a link to
// its field. useFormErrors focuses it (by its id) when Continue / Save finds problems.
export const ERROR_SUMMARY_ID = 'error-summary'

export function ErrorSummary({ errors }: { errors: readonly [string, string][] }) {
  const titleId = useId()
  if (errors.length === 0) return null
  const follow = (key: string) => {
    const el = document.getElementById(fieldId(key))
    if (!el) return
    el.focus()
    el.scrollIntoView?.({ block: 'center' })
  }
  return (
    <Box
      id={ERROR_SUMMARY_ID}
      tabIndex={-1}
      role="group"
      aria-labelledby={titleId}
      sx={{ mb: 3, p: { xs: 2, sm: 2.5 }, borderRadius: `${radius.card}px`, bgcolor: statusBackground.error, outline: 'none', '&:focus-visible': { outline: `2px solid ${brand.navy}`, outlineOffset: 2 } }}
    >
      <Typography id={titleId} variant="h3" component="h2" sx={{ mb: 1 }}>
        {copy.errorSummary.title}
      </Typography>
      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
        {errors.map(([key, message]) => (
          <Box component="li" key={key} sx={{ py: 0.5 }}>
            <Link
              href={`#${fieldId(key)}`}
              onClick={(e) => {
                e.preventDefault()
                follow(key)
              }}
              sx={{ color: brand.wine, textDecorationColor: brand.wine, display: 'inline-flex', minHeight: 24 }}
            >
              {message}
            </Link>
          </Box>
        ))}
      </Box>
    </Box>
  )
}
