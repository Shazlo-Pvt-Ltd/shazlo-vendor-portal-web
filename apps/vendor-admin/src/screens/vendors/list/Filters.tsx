import { Box, IconButton, InputAdornment, MenuItem, Select, Stack, TextField } from '@mui/material'
import { Search, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { vendorsCopy } from '../../../copy/vendors'
import { filterBar, filterSpacer, fullRow } from '../../../lib/responsive'
import type { Update, VendorParams } from './useVendorParams'

const copy = vendorsCopy
const SEARCH_DELAY_MS = 300

// Typing updates the box at once; the URL (and so the request) follows 300 ms after typing stops.
function SearchField({ value, onCommit }: { value: string; onCommit: (q: string) => void }) {
  const [text, setText] = useState(value)
  const [seen, setSeen] = useState(value)
  // What this field last put in the URL. The URL catches up a moment later, often after more
  // typing; only a value we did not send (back, Clear filters) replaces what is in the box.
  const [sent, setSent] = useState(value)
  if (seen !== value) {
    setSeen(value)
    if (value !== sent) {
      setSent(value)
      setText(value)
    }
  }

  const commit = useCallback(
    (q: string) => {
      setSent(q)
      onCommit(q)
    },
    [onCommit],
  )

  useEffect(() => {
    if (text.trim() === value) return
    const timer = window.setTimeout(() => commit(text.trim()), SEARCH_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [text, value, commit])

  return (
    <TextField
      label={copy.search.label}
      value={text}
      size="small"
      autoComplete="off"
      onChange={(event) => setText(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit(text.trim())
      }}
      sx={{ ...fullRow, width: { xs: '100%', sm: 320 }, maxWidth: '100%', flexShrink: 0 }}
      slotProps={{
        htmlInput: { enterKeyHint: 'search', spellCheck: false },
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <Search size={18} strokeWidth={1.5} aria-hidden="true" />
            </InputAdornment>
          ),
          endAdornment: text ? (
            <InputAdornment position="end">
              <IconButton
                aria-label={copy.search.clear}
                edge="end"
                size="small"
                onClick={() => {
                  setText('')
                  commit('')
                }}
              >
                <X size={16} strokeWidth={1.5} aria-hidden="true" />
              </IconButton>
            </InputAdornment>
          ) : undefined,
        },
      }}
    />
  )
}

const sortLabel = (value: string) => copy.sortOptions.find((o) => o.value === value)?.label ?? ''

export function VendorFilters({ params, update, cities, onSearch }: { params: VendorParams; update: Update; cities: string[]; onSearch: (q: string) => void }) {
  // Keep a city from the URL selectable even before the list (and its cities) has loaded.
  const options = params.city && !cities.includes(params.city) ? [params.city, ...cities] : cities
  return (
    <Stack direction="row" spacing={1.5} useFlexGap sx={{ alignItems: 'center', minHeight: 56, flexWrap: 'wrap', rowGap: 1.5, ...filterBar }}>
      <SearchField value={params.q} onCommit={onSearch} />
      <TextField
        select
        size="small"
        label={copy.filters.city}
        value={params.city}
        onChange={(event) => update({ city: event.target.value })}
        sx={{ minWidth: { xs: 0, sm: 200 } }}
        slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
      >
        <MenuItem value="">{copy.filters.allCities}</MenuItem>
        {options.map((city) => (
          <MenuItem key={city} value={city}>
            {city}
          </MenuItem>
        ))}
      </TextField>
      <Box sx={filterSpacer} />
      <Select
        size="small"
        value={params.sort}
        onChange={(event) => update({ sort: event.target.value })}
        inputProps={{ 'aria-label': copy.filters.sort }}
        sx={{ minWidth: 0 }}
        renderValue={(v) => (
          <>
            <Box component="span" sx={{ color: 'text.secondary' }}>
              {copy.filters.sortPrefix}
            </Box>{' '}
            {sortLabel(v)}
          </>
        )}
      >
        {copy.sortOptions.map((o) => (
          <MenuItem key={o.value} value={o.value}>
            {o.label}
          </MenuItem>
        ))}
      </Select>
    </Stack>
  )
}
