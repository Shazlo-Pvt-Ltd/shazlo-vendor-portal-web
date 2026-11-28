import { Box, ButtonBase, IconButton, Stack, TextField, Typography } from '@mui/material'
import { brand, neutral, radius } from '@shazlo/ui'
import { Check, Minus, Plus } from 'lucide-react'
import { memo } from 'react'
import { Controller, useWatch, type Control } from 'react-hook-form'
import { productEditorCopy } from '../../../copy/productEditor'
import { formatCount } from '../../../lib/format'
import { sizeCode, sizesForType, WAIST_SIZES, type ProductType } from '../../../lib/catalog'
import { MAX_STOCK, sortRows, stockOf, type EditorValues, type SizeRow } from './form'
import { EditorSection, fieldId, InlineProblem, type Problems } from './layout'
import { SizeChart } from './SizeChart'

const copy = productEditorCopy.sizes

function SizeChip({ size, on, disabled, id, onToggle }: { size: string; on: boolean; disabled: boolean; id?: string; onToggle: () => void }) {
  return (
    <ButtonBase
      id={id}
      aria-pressed={on}
      disabled={disabled}
      onClick={onToggle}
      sx={{
        minHeight: 44,
        minWidth: 52,
        px: 1.5,
        gap: 0.5,
        borderRadius: `${radius.pill}px`,
        border: `1px solid ${on ? brand.brown : neutral.lineStrong}`,
        boxShadow: on ? `inset 0 0 0 1px ${brand.brown}` : 'none',
        bgcolor: on ? neutral.placeholder : 'transparent',
        color: neutral.ink,
        typography: 'body2',
        '@media (hover: hover)': { '&:hover': { bgcolor: neutral.placeholder } },
        '&.Mui-disabled': { opacity: on ? 1 : 0.6 },
      }}
    >
      {size}
      {on && <Check size={14} strokeWidth={2} aria-hidden="true" color={brand.brown} />}
    </ButtonBase>
  )
}

function Chips({ label, sizes, chosen, readOnly, firstId, onToggle }: { label: string; sizes: readonly string[]; chosen: Set<string>; readOnly: boolean; firstId?: string; onToggle: (size: string) => void }) {
  if (!sizes.length) return null
  return (
    <Box role="group" aria-label={label}>
      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
        {sizes.map((size, i) => (
          <SizeChip key={size} size={size} on={chosen.has(size)} disabled={readOnly} id={i === 0 ? firstId : undefined} onToggle={() => onToggle(size)} />
        ))}
      </Stack>
    </Box>
  )
}

type CardProps = { sku: string | null; readOnly: boolean; problem?: string; idPrefix: string; category: ProductType | '' }

// Tap a size, type the stock (− / + for one at a time). 0 is sold out. Codes are automatic.
function SizesCard({ rows, onChange, sku, readOnly, problem, idPrefix, category }: CardProps & { rows: SizeRow[]; onChange: (rows: SizeRow[]) => void }) {
  const chosen = new Set(rows.map((r) => r.size))
  const offered = sizesForType(category || null)
  // A size chosen before the type changed stays, so it can be taken off.
  const extra = rows.map((r) => r.size).filter((s) => !offered.includes(s))
  const waist = offered.filter((s) => WAIST_SIZES.includes(s))
  const letters = [...offered.filter((s) => !WAIST_SIZES.includes(s)), ...extra]
  const total = rows.reduce((n, r) => n + stockOf(r.stock), 0)

  const toggle = (size: string) => onChange(chosen.has(size) ? rows.filter((r) => r.size !== size) : sortRows([...rows, { size, stock: '0' }]))
  const setStock = (size: string, stock: string) => onChange(rows.map((r) => (r.size === size ? { ...r, stock } : r)))
  const stepper = { width: 44, height: 44, border: `1px solid ${neutral.line}`, borderRadius: `${radius.control}px`, color: neutral.ink, '&.Mui-disabled': { color: neutral.lineStrong } }

  return (
    <>
      <Typography variant="body2" color="textSecondary" sx={{ mb: 1.5 }}>
        {category ? copy.chipsHint : `${copy.chipsHint} ${copy.noType}`}
      </Typography>
      <Stack spacing={2}>
        <Chips label={copy.chips} sizes={letters} chosen={chosen} readOnly={readOnly} firstId={fieldId(idPrefix, 'variants')} onToggle={toggle} />
        {waist.length > 0 && (
          <Box>
            <Typography variant="body2" sx={{ mb: 1 }}>
              {copy.waist}
            </Typography>
            <Chips label={copy.waist} sizes={waist} chosen={chosen} readOnly={readOnly} onToggle={toggle} />
          </Box>
        )}
      </Stack>
      {problem && <InlineProblem>{problem}</InlineProblem>}

      {rows.length > 0 && (
        <Box component="ul" aria-label={copy.title} sx={{ listStyle: 'none', p: 0, m: 0, mt: 2.5, borderTop: `1px solid ${neutral.line}` }}>
          {rows.map((row) => {
            const n = stockOf(row.stock)
            return (
              <Box component="li" key={row.size} sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 1.25, borderBottom: `1px solid ${neutral.line}` }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body1">{row.size}</Typography>
                  <Typography variant="caption" component="p" color="textSecondary" noWrap>
                    {[sku ? productEditorCopy.code(sizeCode(sku, row.size)) : '', row.stock !== '' && n === 0 ? copy.soldOut : ''].filter(Boolean).join(' · ')}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexShrink: 0 }}>
                  <IconButton aria-label={copy.decrease(row.size)} disabled={readOnly || n === 0} onClick={() => setStock(row.size, String(n - 1))} sx={stepper}>
                    <Minus size={16} strokeWidth={1.75} aria-hidden="true" />
                  </IconButton>
                  <TextField
                    value={row.stock}
                    onChange={(event) => setStock(row.size, event.target.value.replace(/\D/g, '').slice(0, 5))}
                    onBlur={() => row.stock === '' && setStock(row.size, '0')}
                    size="small"
                    sx={{ width: 76, '& .MuiInputBase-root': { height: 44 }, '& input': { textAlign: 'center', fontVariantNumeric: 'tabular-nums' } }}
                    slotProps={{ input: { readOnly }, htmlInput: { 'aria-label': copy.stock(row.size), inputMode: 'numeric', pattern: '[0-9]*', autoComplete: 'off' } }}
                  />
                  <IconButton aria-label={copy.increase(row.size)} disabled={readOnly || n >= MAX_STOCK} onClick={() => setStock(row.size, String(n + 1))} sx={stepper}>
                    <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
                  </IconButton>
                </Stack>
              </Box>
            )
          })}
        </Box>
      )}
      <Typography variant="body2" color="textSecondary" sx={{ mt: 2, fontVariantNumeric: 'tabular-nums' }}>
        {rows.length ? copy.total(formatCount(total), rows.length) : copy.none}
      </Typography>
    </>
  )
}

export const SizesSection = memo(function SizesSection({ control, sku, readOnly, problems, idPrefix, plain }: { control: Control<EditorValues>; sku: string | null; readOnly: boolean; problems: Problems; idPrefix: string; plain?: boolean }) {
  const [category, sizes] = useWatch({ control, name: ['category', 'sizes'] })
  return (
    <EditorSection title={copy.title} plain={plain}>
      <Controller
        control={control}
        name="sizes"
        render={({ field }) => <SizesCard rows={field.value} onChange={field.onChange} sku={sku} readOnly={readOnly} problem={problems.variants} idPrefix={idPrefix} category={category} />}
      />
      <SizeChart category={category || null} sizes={sizes.map((r) => r.size)} readOnly={readOnly} />
    </EditorSection>
  )
})
