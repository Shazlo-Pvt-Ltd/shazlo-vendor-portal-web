import { Box, TextField, Typography } from '@mui/material'
import { brand, fontFamily, radius, SectionCard } from '@shazlo/ui'
import { memo, useId } from 'react'
import { useFormState, useWatch, type UseFormReturn } from 'react-hook-form'
import { productEditorCopy } from '../../../copy/productEditor'
import { formatINR } from '../../../lib/format'
import { fieldProps } from '../../../lib/forms'
import { parseRupees, payoutRupees, priceIssues, type EditorValues } from './form'

const copy = productEditorCopy.price
const percent = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 })

// "You receive" sits next to the price (options board pick), so the seller sees the payout as they type.
function YouReceive({ pricePaise, invalid, commissionBps }: { pricePaise: number | null; invalid: boolean; commissionBps: number | undefined }) {
  const id = useId()
  const split = pricePaise && commissionBps != null ? payoutRupees(pricePaise, commissionBps) : null
  return (
    <Box role="group" aria-labelledby={id} sx={{ bgcolor: brand.cream, borderRadius: `${radius.card}px`, px: 2.5, py: 2, gridColumn: { sm: '1 / -1', lg: 'auto' } }}>
      <Typography id={id} variant="body2" color="text.secondary">
        {copy.receive}
      </Typography>
      <Typography variant="stat" component="p" sx={{ fontFamily: fontFamily.display, fontSize: '2rem', lineHeight: 1.2, fontVariantNumeric: 'lining-nums tabular-nums', my: 0.5 }}>
        {split ? formatINR(split.receive) : '—'}
      </Typography>
      <Typography variant="caption" component="p" color="text.secondary">
        {invalid ? copy.fixPrice : !pricePaise ? copy.noPrice : split && commissionBps != null ? copy.after(`${percent.format(commissionBps / 100)}%`, formatINR(split.commission)) : copy.afterUnknown}
      </Typography>
    </Box>
  )
}

export const PriceCard = memo(function PriceCard({ form, readOnly, live, commissionBps }: { form: UseFormReturn<EditorValues>; readOnly: boolean; live: boolean; commissionBps: number | undefined }) {
  const { register, clearErrors, control, getFieldState } = form
  const clearIfShown = (name: 'mrp' | 'price') => getFieldState(name).error && clearErrors(name)
  const { errors } = useFormState({ control, name: ['mrp', 'price'] })
  const [mrp, price] = useWatch({ control, name: ['mrp', 'price'] })
  const parsed = parseRupees(price)
  const invalid = Boolean(priceIssues({ mrp, price }, live).price)
  const pricePaise = !invalid && parsed.ok ? parsed.paise : null
  const money = { input: { readOnly }, htmlInput: { inputMode: 'decimal', autoComplete: 'off', style: { fontVariantNumeric: 'tabular-nums' } } } as const
  return (
    <SectionCard title={copy.title}>
      <Box sx={{ display: 'grid', gap: 2, alignItems: 'start', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(2, minmax(0, 1fr)) minmax(200px, 1.15fr)' } }}>
        <TextField label={copy.mrp} {...fieldProps(register('mrp', { deps: ['price'], onChange: () => clearIfShown('mrp') }), errors.mrp, copy.mrpHint)} slotProps={money} />
        <TextField label={copy.selling} {...fieldProps(register('price', { onChange: () => clearIfShown('price') }), errors.price, copy.sellingHint)} slotProps={money} />
        <YouReceive pricePaise={pricePaise} invalid={invalid} commissionBps={commissionBps} />
      </Box>
    </SectionCard>
  )
})
