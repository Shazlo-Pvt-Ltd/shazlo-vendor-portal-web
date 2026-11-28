import { Box } from '@mui/material'
import { neutral } from '@shazlo/ui'
import { colourSwatch } from '../lib/catalog'

// A colour as a small circle: a hex code drawn as itself, a listed colour (or a common other name
// for one) with its swatch, and any other name as a plain, dashed circle. The colour's words are
// always written beside it, so the circle is decoration. The fill comes from the data (the
// product's own hex code, or the shared swatch tokens), never from this file.
export function ColourSwatch({ value, size = 14 }: { value: string | null | undefined; size?: number }) {
  const swatch = colourSwatch(value)
  if (!swatch) return null
  return (
    <Box
      component="span"
      aria-hidden="true"
      data-swatch={swatch.kind}
      style={swatch.background ? { background: swatch.background } : undefined}
      sx={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        flexShrink: 0,
        boxSizing: 'border-box',
        verticalAlign: 'middle',
        bgcolor: swatch.background ? undefined : neutral.placeholder,
        border: swatch.border ? `1px ${swatch.kind === 'unknown' ? 'dashed' : 'solid'} ${neutral.lineStrong}` : 'none',
      }}
    />
  )
}

// The swatch and the colour's name, on one line that wraps as a unit.
export function ColourName({ value, size }: { value: string; size?: number }) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, maxWidth: '100%', verticalAlign: 'bottom' }}>
      <ColourSwatch value={value} size={size} />
      <Box component="span" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
        {value}
      </Box>
    </Box>
  )
}

// Several colours, each with its swatch, separated by commas for screen readers and copy-paste.
export function ColourList({ values, size }: { values: readonly string[]; size?: number }) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', flexWrap: 'wrap', columnGap: 1, rowGap: 0.25, maxWidth: '100%' }}>
      {values.map((value, i) => (
        <Box component="span" key={`${value}-${i}`} sx={{ display: 'inline-flex', alignItems: 'center', maxWidth: '100%' }}>
          <ColourName value={value} size={size} />
          {i < values.length - 1 ? ',' : null}
        </Box>
      ))}
    </Box>
  )
}
