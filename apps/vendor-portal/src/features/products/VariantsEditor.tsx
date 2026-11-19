import { Box, Button, FormControlLabel, InputAdornment, Stack, Switch, TextField, Typography } from '@mui/material'
import { LIMITS, emptyVariant, type ProductErrors, type VariantField, type VariantValues } from './form'

export const variantFieldId = (key: string, field: VariantField) => `variant-${key}-${field}`
export const VARIANTS_ID = 'product-variants'

interface Props {
  variants: VariantValues[]
  errors: ProductErrors['variants']
  /** A problem with the list as a whole, for example "add at least one active variant". */
  listError: string | undefined
  onChange: (next: VariantValues[]) => void
  /** Clears one problem as soon as the vendor touches its field. */
  onFieldEdited: (key: string, field: VariantField | 'row') => void
}

const name = (variant: VariantValues, index: number) => (variant.sku.trim() ? `variant ${index + 1} (${variant.sku.trim()})` : `variant ${index + 1}`)

/**
 * The sizes and colours a product is sold in, each with its own SKU and price. A variant that is
 * already saved keeps its SKU, size and colour (they are its identity on the server); to sell a
 * different size or colour, add a new variant. Variants are listed in SKU order after a save, as
 * the API returns them, so there is no reordering here.
 */
export function VariantsEditor({ variants, errors, listError, onChange, onFieldEdited }: Props) {
  const update = (key: string, patch: Partial<VariantValues>, field?: VariantField) => {
    onChange(variants.map((variant) => (variant.key === key ? { ...variant, ...patch } : variant)))
    if (field) onFieldEdited(key, field)
    // Size and colour together must be unique, so changing either may clear that problem.
    if (field === 'size' || field === 'color') onFieldEdited(key, 'row')
  }

  const add = () => {
    const next = emptyVariant()
    onChange([...variants, next])
    // Focus the new row's SKU once it is on the page.
    requestAnimationFrame(() => document.getElementById(variantFieldId(next.key, 'sku'))?.focus())
  }

  const remove = (index: number) => {
    onChange(variants.filter((_, i) => i !== index))
    // Keep focus in the list: on the next row's Remove, the previous one, or Add.
    requestAnimationFrame(() => {
      const rows = document.querySelectorAll<HTMLButtonElement>('[data-remove-variant]')
      const target = rows[Math.min(index, rows.length - 1)] ?? document.getElementById(`${VARIANTS_ID}-add`)
      target?.focus()
    })
  }

  return (
    <Box component="section" aria-labelledby={`${VARIANTS_ID}-heading`}>
      <Typography id={`${VARIANTS_ID}-heading`} component="h2" variant="h6" gutterBottom>
        Variants
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Each size and colour you sell, with its own SKU and price. Prices are in rupees; the MRP is the printed price (leave it
        empty if it is the same as the price).
      </Typography>
      {listError ? (
        <Typography id={VARIANTS_ID} tabIndex={-1} color="error" variant="body2" role="alert" sx={{ mb: 2 }}>
          {listError}
        </Typography>
      ) : null}

      <Stack spacing={2}>
        {variants.map((variant, index) => {
          const problems = errors[variant.key] ?? {}
          const field = (key: VariantField) => ({
            id: variantFieldId(variant.key, key),
            error: problems[key] !== undefined,
            helperText: problems[key],
            size: 'small' as const,
          })
          const locked = variant.saved
          return (
            <Box
              key={variant.key}
              component="fieldset"
              sx={{ border: 1, borderColor: problems.row ? 'error.main' : 'divider', borderRadius: 1, p: 2, m: 0, minWidth: 0 }}
            >
              <Typography component="legend" variant="subtitle2" sx={{ px: 0.5 }}>
                Variant {index + 1}
              </Typography>
              <Box
                sx={{
                  display: 'grid',
                  gap: 2,
                  gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(3, minmax(0, 1fr))' },
                }}
              >
                <TextField
                  {...field('sku')}
                  label="SKU"
                  required
                  value={variant.sku}
                  onChange={(event) => update(variant.key, { sku: event.target.value }, 'sku')}
                  slotProps={{ htmlInput: { maxLength: LIMITS.sku, readOnly: locked, autoCapitalize: 'characters', spellCheck: false } }}
                />
                <TextField
                  {...field('size')}
                  label="Size"
                  value={variant.size}
                  onChange={(event) => update(variant.key, { size: event.target.value }, 'size')}
                  slotProps={{ htmlInput: { maxLength: LIMITS.size, readOnly: locked } }}
                  helperText={problems.size ?? 'For example M or 32'}
                />
                <TextField
                  {...field('color')}
                  label="Colour"
                  value={variant.color}
                  onChange={(event) => update(variant.key, { color: event.target.value }, 'color')}
                  slotProps={{ htmlInput: { maxLength: LIMITS.color, readOnly: locked } }}
                />
                <TextField
                  {...field('price')}
                  label="Price"
                  required
                  value={variant.price}
                  onChange={(event) => update(variant.key, { price: event.target.value }, 'price')}
                  slotProps={{ input: { startAdornment: <InputAdornment position="start">₹</InputAdornment> }, htmlInput: { inputMode: 'decimal' } }}
                />
                <TextField
                  {...field('mrp')}
                  label="MRP"
                  value={variant.mrp}
                  onChange={(event) => update(variant.key, { mrp: event.target.value }, 'mrp')}
                  helperText={problems.mrp ?? 'Not below the price'}
                  slotProps={{ input: { startAdornment: <InputAdornment position="start">₹</InputAdornment> }, htmlInput: { inputMode: 'decimal' } }}
                />
                <FormControlLabel
                  control={<Switch checked={variant.isActive} onChange={(event) => update(variant.key, { isActive: event.target.checked })} />}
                  label={variant.isActive ? 'On sale' : 'Not on sale'}
                />
              </Box>
              {locked ? (
                <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
                  The SKU, size and colour of a saved variant cannot change. To sell another size or colour, add a variant.
                </Typography>
              ) : null}
              {problems.row ? (
                <Typography color="error" variant="body2" role="alert" sx={{ mt: 1 }}>
                  {problems.row}
                </Typography>
              ) : null}
              <Box sx={{ mt: 1 }}>
                <Button size="small" color="error" data-remove-variant onClick={() => remove(index)} aria-label={`Remove ${name(variant, index)}`}>
                  Remove
                </Button>
              </Box>
            </Box>
          )
        })}
      </Stack>

      <Button id={`${VARIANTS_ID}-add`} sx={{ mt: 2 }} variant="outlined" onClick={add} disabled={variants.length >= LIMITS.variants}>
        Add a variant
      </Button>
    </Box>
  )
}
