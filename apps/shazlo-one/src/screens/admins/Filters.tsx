import { IconButton, InputAdornment, MenuItem, Stack, TextField } from '@mui/material'
import { Search, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { adminsCopy } from '../../copy/admins'
import { roleName, type Role } from './shared'

const copy = adminsCopy.filters
const SEARCH_DELAY_MS = 300

export type StatusFilter = 'active' | 'inactive' | 'all'
export type Filters = { q: string; role: string; status: StatusFilter }

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
      sx={{ width: { xs: '100%', sm: 300 } }}
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

export function AdminFilters({ filters, roles, onChange }: { filters: Filters; roles: Role[] | undefined; onChange: (patch: Partial<Filters>) => void }) {
  const onSearch = useCallback((q: string) => onChange({ q }), [onChange])
  return (
    <Stack direction="row" spacing={1.5} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1.5 }}>
      <SearchField value={filters.q} onCommit={onSearch} />
      <TextField select size="small" label={copy.role} value={filters.role} onChange={(event) => onChange({ role: event.target.value })} sx={{ minWidth: 172 }} slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}>
        <MenuItem value="">{copy.allRoles}</MenuItem>
        {(roles ?? []).map((r) => (
          <MenuItem key={r.name} value={r.name}>
            {roleName(r.name)}
          </MenuItem>
        ))}
        {/* Until roles load, keep a chosen role selectable so the select shows it. */}
        {!roles && filters.role && <MenuItem value={filters.role}>{roleName(filters.role)}</MenuItem>}
      </TextField>
      <TextField select size="small" label={copy.status} value={filters.status} onChange={(event) => onChange({ status: event.target.value as StatusFilter })} sx={{ minWidth: 148 }}>
        {copy.statusOptions.map((o) => (
          <MenuItem key={o.value} value={o.value}>
            {o.label}
          </MenuItem>
        ))}
      </TextField>
    </Stack>
  )
}
