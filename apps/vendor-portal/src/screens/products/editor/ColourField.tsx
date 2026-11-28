import { Autocomplete, Box, IconButton, InputAdornment, Stack, TextField } from '@mui/material'
import { brand, garmentColour, neutral, radius } from '@shazlo/ui'
import { Pipette, X } from 'lucide-react'
import { ColourSwatch } from '../../../components/ColourSwatch'
import { colourByName, colourSwatch, COLOUR_NAMES, matchColour } from '../../../lib/catalog'
import { srOnly } from '../../../lib/a11y'

// The hex code the colour picker starts from: the colour's own, a listed colour's, else black.
function pickerStart(value: string): string {
  const swatch = colourSwatch(value)
  const hex = swatch?.kind === 'hex' ? swatch.background : colourByName(matchColour(value))?.hex
  return (hex ?? garmentColour.Black).toLowerCase()
}

// The browser's own colour picker behind an eyedropper button. Picking a shade fills in its hex code.
function ShadePicker({ value, label, disabled, onPick }: { value: string; label: string; disabled: boolean; onPick: (hex: string) => void }) {
  return (
    <Box
      component="label"
      title={label}
      sx={{
        width: 56,
        height: 56,
        flexShrink: 0,
        display: 'grid',
        placeItems: 'center',
        border: `1px solid ${neutral.lineStrong}`,
        borderRadius: `${radius.control}px`,
        color: disabled ? neutral.lineStrong : brand.brown,
        cursor: disabled ? 'default' : 'pointer',
        '@media (hover: hover)': { '&:hover': disabled ? {} : { bgcolor: 'action.hover' } },
        '&:has(input:focus-visible)': { outline: `2px solid ${brand.navy}`, outlineOffset: '2px' },
      }}
    >
      <Pipette size={20} strokeWidth={1.75} aria-hidden="true" />
      <input type="color" aria-label={label} value={pickerStart(value)} disabled={disabled} onChange={(event) => onPick(event.target.value.toUpperCase())} style={srOnly} />
    </Box>
  )
}

type Props = {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  // Leaving the field (or the picker): the form tidies the colour and checks it.
  onBlur: () => void
  hint?: string
  error?: string
  readOnly: boolean
  pickLabel: string
  // Other colours can be taken away again.
  removeLabel?: string
  onRemove?: () => void
}

// One colour: typed freely (a name or a hex code), chosen from the listed colours, which are
// suggestions with their swatches, or picked as a shade. The swatch beside the text follows what
// is typed.
export function ColourField({ id, label, value, onChange, onBlur, hint, error, readOnly, pickLabel, removeLabel, onRemove }: Props) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
      <Autocomplete
        id={id}
        freeSolo
        fullWidth
        options={COLOUR_NAMES}
        value={value}
        inputValue={value}
        readOnly={readOnly}
        autoHighlight={false}
        onInputChange={(_, next) => onChange(next)}
        onChange={(_, next) => onChange(next ?? '')}
        onBlur={onBlur}
        renderOption={(props, option) => {
          const { key, ...rest } = props
          return (
            <Box component="li" key={key} {...rest} sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minHeight: 44 }}>
              <ColourSwatch value={option} size={18} />
              {option}
            </Box>
          )
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            label={label}
            error={Boolean(error)}
            helperText={error ?? hint}
            slotProps={{
              ...params.slotProps,
              input: {
                ...params.slotProps.input,
                startAdornment: colourSwatch(value) ? (
                  <InputAdornment position="start" sx={{ ml: 0.5, mr: 0 }}>
                    <ColourSwatch value={value} size={20} />
                  </InputAdornment>
                ) : undefined,
              },
              htmlInput: { ...params.slotProps.htmlInput, autoComplete: 'off', autoCapitalize: 'off', spellCheck: false, maxLength: 64 },
            }}
          />
        )}
      />
      <ShadePicker value={value} label={pickLabel} disabled={readOnly} onPick={(hex) => onChange(hex)} />
      {onRemove && !readOnly && (
        <IconButton aria-label={removeLabel} onClick={onRemove} sx={{ width: 44, height: 44, mt: 0.75, flexShrink: 0, color: neutral.inkSecondary }}>
          <X size={18} strokeWidth={1.75} aria-hidden="true" />
        </IconButton>
      )}
    </Stack>
  )
}
