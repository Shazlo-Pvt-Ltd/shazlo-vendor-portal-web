import { Box, Chip, IconButton, Stack, TextField, Typography } from '@mui/material'
import { brand, neutral, radius, SectionCard } from '@shazlo/ui'
import { AlertTriangle, Check, Minus, Plus } from 'lucide-react'
import { memo, useId } from 'react'
import { Controller, type Control } from 'react-hook-form'
import { productEditorCopy } from '../../../copy/productEditor'
import { formatCount } from '../../../lib/format'
import { skuFor, sortSizes, stockOf, type EditorValues, type SizeRow } from './form'

const copy = productEditorCopy.sizes
const SIZES = productEditorCopy.options.sizes
const MAX_STOCK = 99_999

export const sizesFocusId = (prefix: string) => `${prefix}-sizes`

type CardProps = { sku: string | null; readOnly: boolean; problem: string | null; compact: boolean; idPrefix: string }

// Bound to the form's `sizes` field; memoised so typing in other cards does not re-render it.
export const SizesField = memo(function SizesField({ control, onEdit, ...card }: CardProps & { control: Control<EditorValues>; onEdit: () => void }) {
  return (
    <Controller
      control={control}
      name="sizes"
      render={({ field }) => (
        <SizesCard
          {...card}
          rows={field.value}
          onChange={(rows) => {
            onEdit()
            field.onChange(rows)
          }}
        />
      )}
    />
  )
})

// Options board pick: size chips, then a − / + stepper per chosen size (not a table).
function SizesCard({
  rows,
  onChange,
  sku,
  readOnly,
  problem,
  compact,
  idPrefix,
}: CardProps & { rows: SizeRow[]; onChange: (rows: SizeRow[]) => void }) {
  const hintId = useId()
  const problemId = useId()
  const chosen = new Set(rows.map((r) => r.size))
  const total = rows.reduce((n, r) => n + stockOf(r.stock), 0)
  const target = compact ? 44 : 40

  const toggle = (size: string) => onChange(chosen.has(size) ? rows.filter((r) => r.size !== size) : sortSizes([...rows, { size, stock: '0' }]))
  const setStock = (size: string, stock: string) => onChange(rows.map((r) => (r.size === size ? { ...r, stock } : r)))

  const stepper = { width: target, height: target, border: `1px solid ${neutral.line}`, borderRadius: `${radius.control}px`, color: neutral.ink, '&.Mui-disabled': { color: neutral.lineStrong } }

  return (
    <SectionCard title={copy.title}>
      <Typography id={hintId} variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {copy.chipsHint}
      </Typography>
      <Stack role="group" aria-label={copy.chips} aria-describedby={[hintId, problem ? problemId : ''].join(' ').trim()} direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
        {SIZES.map((size, i) => {
          const on = chosen.has(size)
          return (
            <Chip
              key={size}
              id={i === 0 ? sizesFocusId(idPrefix) : undefined}
              label={size}
              variant="outlined"
              clickable
              disabled={readOnly}
              aria-pressed={on}
              onClick={() => toggle(size)}
              icon={on ? <Check size={14} strokeWidth={2} aria-hidden="true" /> : undefined}
              sx={{
                height: target,
                minWidth: target + 8,
                fontSize: '0.875rem',
                color: neutral.ink,
                bgcolor: on ? brand.cream : 'transparent',
                borderColor: on ? brand.brown : neutral.lineStrong,
                '& .MuiChip-icon': { color: brand.brown, ml: 1, mr: -0.5 },
                '@media (hover: hover)': { '&&:hover': { bgcolor: on ? brand.cream : 'rgba(255, 237, 163, 0.45)' } },
                '&.Mui-focusVisible': { bgcolor: on ? brand.cream : 'transparent', outline: `2px solid ${brand.navy}`, outlineOffset: 2 },
                '&.Mui-disabled': { opacity: 0.7 },
              }}
            />
          )
        })}
      </Stack>
      {problem && (
        <Typography id={problemId} variant="body2" color="error.main" sx={{ display: 'flex', gap: 0.75, alignItems: 'flex-start', mt: 1.5 }}>
          <AlertTriangle size={16} strokeWidth={1.75} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
          {problem}
        </Typography>
      )}

      {rows.length > 0 && (
        <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0, mt: 2.5, borderTop: `1px solid ${neutral.line}` }}>
          {rows.map((row) => {
            const n = stockOf(row.stock)
            return (
              <Box component="li" key={row.size} sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 1.25, borderBottom: `1px solid ${neutral.line}` }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body1">{row.size}</Typography>
                  <Typography variant="mono" component="p" color="text.secondary" noWrap>
                    {sku ? skuFor(sku, row.size) : '—'}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexShrink: 0 }}>
                  <IconButton aria-label={copy.decrease(row.size)} disabled={readOnly || n === 0} onClick={() => setStock(row.size, String(n - 1))} sx={stepper}>
                    <Minus size={16} strokeWidth={1.5} aria-hidden="true" />
                  </IconButton>
                  <TextField
                    value={row.stock}
                    onChange={(event) => setStock(row.size, event.target.value.replace(/\D/g, '').slice(0, 5))}
                    onBlur={() => row.stock === '' && setStock(row.size, '0')}
                    size="small"
                    sx={{ width: 72, '& .MuiInputBase-root': { height: target }, '& input': { textAlign: 'center', fontVariantNumeric: 'tabular-nums' } }}
                    slotProps={{ input: { readOnly }, htmlInput: { 'aria-label': copy.stock(row.size), inputMode: 'numeric', pattern: '[0-9]*', autoComplete: 'off' } }}
                  />
                  <IconButton aria-label={copy.increase(row.size)} disabled={readOnly || n >= MAX_STOCK} onClick={() => setStock(row.size, String(n + 1))} sx={stepper}>
                    <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
                  </IconButton>
                </Stack>
              </Box>
            )
          })}
        </Box>
      )}
      <Typography variant="body2" color="text.secondary" sx={{ mt: 2, fontVariantNumeric: 'tabular-nums' }}>
        {rows.length ? copy.total(formatCount(total), rows.length) : copy.none}
      </Typography>
    </SectionCard>
  )
}
