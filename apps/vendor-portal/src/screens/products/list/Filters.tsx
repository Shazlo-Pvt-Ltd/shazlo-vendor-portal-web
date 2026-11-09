import { Box, Button, Drawer, IconButton, InputAdornment, MenuItem, Select, Stack, TextField, Typography } from '@mui/material'
import { neutral, radius } from '@shazlo/ui'
import { Search, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { productsCopy } from '../../../copy/products'
import { activeFilterCount, type ListParams, type ParamKey } from './useListParams'

const copy = productsCopy
const SEARCH_DELAY_MS = 300

type Update = (patch: Partial<Record<ParamKey, string | number | undefined>>, options?: { replace?: boolean }) => void
type Option = { value: string; label: string }

const categoryOptions: Option[] = copy.categories.map((c) => ({ value: c, label: c }))
const genderOptions: Option[] = copy.genders.map((g) => ({ value: g, label: g }))
const stockOptions: Option[] = [...copy.stockOptions]
const sortOptions: Option[] = [...copy.sortOptions]

// Typing updates the box at once; the URL (and so the request) follows 300 ms after typing stops.
export function SearchField({ value, onCommit }: { value: string; onCommit: (q: string) => void }) {
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
      label={copy.search.label}
      value={text}
      size="small"
      autoComplete="off"
      onChange={(event) => setText(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onCommit(text.trim())
      }}
      sx={{ width: { xs: '100%', md: 280 }, flexShrink: 0 }}
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

function FilterSelect({ label, value, options, allLabel, onChange, fullWidth = false }: { label: string; value: string; options: Option[]; allLabel: string; onChange: (value: string) => void; fullWidth?: boolean }) {
  return (
    <TextField
      select
      size="small"
      label={label}
      value={value}
      fullWidth={fullWidth}
      onChange={(event) => onChange(event.target.value)}
      sx={fullWidth ? undefined : { minWidth: 148 }}
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

function FilterSelects({ params, update, fullWidth }: { params: ListParams; update: Update; fullWidth?: boolean }) {
  return (
    <>
      <FilterSelect label={copy.filters.category} value={params.category} options={categoryOptions} allLabel={copy.filters.all} onChange={(category) => update({ category })} fullWidth={fullWidth} />
      <FilterSelect label={copy.filters.gender} value={params.gender} options={genderOptions} allLabel={copy.filters.all} onChange={(gender) => update({ gender })} fullWidth={fullWidth} />
      <FilterSelect label={copy.filters.stock} value={params.stock ?? ''} options={stockOptions} allLabel={copy.filters.any} onChange={(stock) => update({ stock })} fullWidth={fullWidth} />
    </>
  )
}

const sortLabel = (value: string) => sortOptions.find((o) => o.value === value)?.label ?? ''

function SortSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Select
      size="small"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      inputProps={{ 'aria-label': copy.filters.sort }}
      renderValue={(v) => (
        <>
          <Box component="span" sx={{ color: 'text.secondary' }}>
            {copy.filters.sortPrefix}
          </Box>{' '}
          {sortLabel(v)}
        </>
      )}
    >
      {sortOptions.map((o) => (
        <MenuItem key={o.value} value={o.value}>
          {o.label}
        </MenuItem>
      ))}
    </Select>
  )
}

export function DesktopFilters({ params, update, onSearch }: { params: ListParams; update: Update; onSearch: (q: string) => void }) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', minHeight: 56, flexWrap: 'wrap', rowGap: 1.5 }}>
      <SearchField value={params.q} onCommit={onSearch} />
      <FilterSelects params={params} update={update} />
      <Box sx={{ flex: 1 }} />
      <SortSelect value={params.sort} onChange={(sort) => update({ sort })} />
    </Stack>
  )
}

// Phones: search stays in view; the selects and sort move into a bottom sheet.
export function MobileFilters({ params, update, onSearch, onClear }: { params: ListParams; update: Update; onSearch: (q: string) => void; onClear: () => void }) {
  const [open, setOpen] = useState(false)
  const titleId = useId()
  const active = activeFilterCount(params)
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <SearchField value={params.q} onCommit={onSearch} />
      </Box>
      <Button variant="outlined" onClick={() => setOpen(true)} startIcon={<SlidersHorizontal size={18} strokeWidth={1.5} aria-hidden="true" />} sx={{ minHeight: 44, flexShrink: 0 }}>
        {copy.filters.button(active)}
      </Button>
      <Drawer
        anchor="bottom"
        open={open}
        onClose={() => setOpen(false)}
        transitionDuration={200}
        slotProps={{ paper: { role: 'dialog', 'aria-labelledby': titleId, 'aria-modal': true, sx: { borderRadius: `${radius.sheet}px ${radius.sheet}px 0 0`, bgcolor: neutral.surface, px: 2, pb: 'calc(16px + env(safe-area-inset-bottom, 0px))' } } as object }}
      >
        <Box sx={{ width: 36, height: 4, borderRadius: 2, bgcolor: neutral.line, mx: 'auto', mt: 1.5, mb: 2 }} aria-hidden="true" />
        <Typography id={titleId} variant="h2" component="h2" sx={{ mb: 2 }}>
          {copy.filters.drawerTitle}
        </Typography>
        <Stack spacing={2.5}>
          <FilterSelects params={params} update={update} fullWidth />
          <TextField select size="small" fullWidth label={copy.filters.sort} value={params.sort} onChange={(event) => update({ sort: event.target.value })}>
            {sortOptions.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
        <Stack direction="row" spacing={1.5} sx={{ mt: 3 }}>
          {active > 0 && (
            <Button variant="text" onClick={onClear} sx={{ minHeight: 44, flexShrink: 0 }}>
              {copy.filters.clear}
            </Button>
          )}
          <Button variant="contained" fullWidth onClick={() => setOpen(false)} sx={{ minHeight: 44 }}>
            {copy.filters.showResults}
          </Button>
        </Stack>
      </Drawer>
    </Stack>
  )
}
