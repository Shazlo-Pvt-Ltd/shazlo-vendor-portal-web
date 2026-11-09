import { Box, FormControlLabel, IconButton, InputAdornment, MenuItem, Select, Stack, Switch, TextField } from '@mui/material'
import { Search, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { components } from '../../../api/schema'
import { queueCopy } from '../../../copy/queue'
import type { Patch, QueueParams } from './useQueueParams'

const copy = queueCopy.filters
const SEARCH_DELAY_MS = 300

type Update = (patch: Patch, options?: { replace?: boolean }) => void
type Option = { value: string; label: string }

// Typing updates the box at once; the URL (and so the request) follows 300 ms after typing stops.
function SearchField({ value, onCommit }: { value: string; onCommit: (q: string) => void }) {
  const [text, setText] = useState(value)
  const [seen, setSeen] = useState(value)
  // The URL changed from outside (back, Clear filters): show what it now says.
  if (seen !== value) {
    setSeen(value)
    if (text.trim() !== value) setText(value)
  }

  useEffect(() => {
    if (text.trim() === value) return
    const timer = window.setTimeout(() => onCommit(text.trim()), SEARCH_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [text, value, onCommit])

  return (
    <TextField
      label={copy.search}
      value={text}
      size="small"
      autoComplete="off"
      onChange={(event) => setText(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onCommit(text.trim())
      }}
      sx={{ width: { xs: '100%', sm: 280 }, flexShrink: 0 }}
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
                aria-label={copy.clearSearch}
                edge="end"
                size="small"
                onClick={() => {
                  setText('')
                  onCommit('')
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

function FilterSelect({ label, value, options, allLabel, onChange }: { label: string; value: string; options: Option[]; allLabel: string; onChange: (value: string) => void }) {
  // Until the list of vendors arrives, a vendor from the link has no option yet: show "All" meanwhile.
  const known = value === '' || options.some((o) => o.value === value)
  return (
    <TextField
      select
      size="small"
      label={label}
      value={known ? value : ''}
      onChange={(event) => onChange(event.target.value)}
      sx={{ minWidth: 168 }}
      slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
    >
      <MenuItem value="">{allLabel}</MenuItem>
      {options.map((o) => (
        <MenuItem key={o.value} value={o.value}>
          {o.label}
        </MenuItem>
      ))}
    </TextField>
  )
}

const sortLabel = (value: string) => copy.sortOptions.find((o) => o.value === value)?.label ?? ''

function SortSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Select
      size="small"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      inputProps={{ 'aria-label': copy.sort }}
      renderValue={(v) => (
        <>
          <Box component="span" sx={{ color: 'text.secondary' }}>
            {copy.sortPrefix}
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
  )
}

export function QueueFilters({ params, update, onSearch, vendors }: { params: QueueParams; update: Update; onSearch: (q: string) => void; vendors: components['schemas']['VendorRef'][] }) {
  const vendorOptions = vendors.map((v) => ({ value: v.id, label: v.name })).sort((a, b) => a.label.localeCompare(b.label))
  return (
    <Stack role="search" aria-label={copy.label} direction="row" spacing={1.5} useFlexGap sx={{ alignItems: 'center', minHeight: 56, flexWrap: 'wrap', rowGap: 1.5 }}>
      <SearchField value={params.q} onCommit={onSearch} />
      <FilterSelect label={copy.vendor} value={params.vendor} options={vendorOptions} allLabel={copy.allVendors} onChange={(vendor) => update({ vendor })} />
      <FilterSelect label={copy.submitted} value={params.submitted ?? ''} options={copy.submittedOptions} allLabel={copy.anyTime} onChange={(submitted) => update({ submitted })} />
      <FormControlLabel
        control={<Switch checked={params.resubmissions} onChange={(event) => update({ resubmissions: event.target.checked })} slotProps={{ input: { role: 'switch' } }} />}
        label={copy.resubmissions}
        sx={{ ml: 0, mr: 0, flexShrink: 0 }}
      />
      <Box sx={{ flex: 1 }} />
      <SortSelect value={params.sort} onChange={(sort) => update({ sort })} />
    </Stack>
  )
}
