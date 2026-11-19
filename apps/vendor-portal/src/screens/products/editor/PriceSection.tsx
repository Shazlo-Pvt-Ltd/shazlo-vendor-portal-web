import { Box, InputAdornment, Link, Stack, TextField, Typography } from '@mui/material'
import { neutral, radius } from '@shazlo/ui'
import { memo } from 'react'
import { useFormState, useWatch, type UseFormReturn } from 'react-hook-form'
import { Link as RouterLink } from 'react-router'
import type { Schemas } from '../../../api/client'
import { paths } from '../../../app/paths'
import { productEditorCopy } from '../../../copy/productEditor'
import { formatBps, sellerReceives } from '../../../lib/commission'
import { formatINR } from '../../../lib/format'
import { parseRupees, priceIssues, wholeRupees, type EditorValues } from './form'
import { EditorSection, fieldId, type Problems } from './layout'

const copy = productEditorCopy.price

// "You receive ₹X after Y% commission (₹Z)" once a rate is agreed; until then, where to agree it.
// The brand always sets the price; this line only shows what that price pays (spec §6).
function YouReceive({ pricePaise, invalid, commission }: { pricePaise: number | null; invalid: boolean; commission: Schemas['Commission'] | null }) {
  const split = sellerReceives(pricePaise, commission)
  let body
  if (commission?.agreed_bps == null) {
    body = (
      <>
        {copy.receivePending}{' '}
        <Link component={RouterLink} to={paths.commission}>
          {copy.commissionLink}
        </Link>
      </>
    )
  } else if (invalid) body = copy.receiveFixPrice
  else if (!split) body = copy.receiveNoPrice
  else {
    const money = wholeRupees(split)
    body = copy.receive(formatINR(money.receive), formatBps(split.bps), formatINR(money.commission))
  }
  return (
    <Box sx={{ bgcolor: neutral.canvas, border: `1px solid ${neutral.line}`, borderRadius: `${radius.card}px`, px: 2, py: 1.5 }}>
      <Typography variant="body1" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {body}
      </Typography>
    </Box>
  )
}

export const PriceSection = memo(function PriceSection({ form, readOnly, live, commission, problems, idPrefix, plain }: { form: UseFormReturn<EditorValues>; readOnly: boolean; live: boolean; commission: Schemas['Commission'] | null; problems: Problems; idPrefix: string; plain?: boolean }) {
  const { register, control, getFieldState, trigger } = form
  const { errors } = useFormState({ control, name: ['mrp', 'price'] })
  const [mrp, price] = useWatch({ control, name: ['mrp', 'price'] })
  const parsed = parseRupees(price)
  const invalid = Boolean(priceIssues({ mrp, price }, live).price)
  const pricePaise = !invalid && parsed.ok ? parsed.paise : null

  // Checked on Next and Send, not while typing; a shown error is re-checked as the seller fixes it.
  const recheck = () => {
    if (getFieldState('price').error || getFieldState('mrp').error) void trigger(['price', 'mrp'])
  }
  const money = (name: 'price' | 'mrp') => {
    const { ref, ...field } = register(name, { onChange: recheck })
    return { ...field, inputRef: ref, id: fieldId(idPrefix, name === 'price' ? 'price_paise' : 'mrp'), fullWidth: true }
  }
  const slot = {
    input: { readOnly, startAdornment: <InputAdornment position="start">₹</InputAdornment> },
    htmlInput: { inputMode: 'decimal', autoComplete: 'off', style: { fontVariantNumeric: 'tabular-nums' } },
  } as const
  const sellingError = errors.price?.message ?? problems.price_paise

  return (
    <EditorSection title={copy.title} plain={plain}>
      <Stack spacing={2.5}>
        <Box sx={{ display: 'grid', gap: 2, alignItems: 'start', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))' } }}>
          <TextField {...money('price')} label={copy.selling} error={Boolean(sellingError)} helperText={sellingError ?? copy.sellingHint} slotProps={slot} />
          <TextField {...money('mrp')} label={copy.mrp} error={Boolean(errors.mrp)} helperText={errors.mrp?.message ?? copy.mrpHint} slotProps={slot} />
        </Box>
        <YouReceive pricePaise={pricePaise} invalid={invalid} commission={commission} />
        <Typography variant="body2" color="text.secondary">
          {copy.rule}
        </Typography>
      </Stack>
    </EditorSection>
  )
})
