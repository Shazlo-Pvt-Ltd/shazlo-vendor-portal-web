import { zodResolver } from '@hookform/resolvers/zod'
import { Box, Button, Chip, FormHelperText, FormLabel, InputAdornment, Stack, TextField, Typography } from '@mui/material'
import { brand, neutral } from '@shazlo/ui'
import { ArrowLeft, Check } from 'lucide-react'
import { useEffect, useId, useState, type FormEventHandler, type ReactNode } from 'react'
import { Controller, useForm, useWatch, type Control, type FieldValues, type Path, type UseFormReturn } from 'react-hook-form'
import { onboardingCopy } from '../../copy/onboarding'
import { fieldProps } from '../../lib/forms'
import {
  ABOUT_MAX,
  brandSchema,
  catalogueSchema,
  contactSchema,
  type BrandValues,
  type CatalogueValues,
  type ContactValues,
  type FieldMessages,
} from './applyModel'

const copy = onboardingCopy.apply
const f = copy.fields
const h = copy.hints

export interface StepProps<V> {
  values: V
  // Messages to show on arrival (from the server, or a stale draft), keyed by field.
  errors: FieldMessages
  // Move focus to the first of those fields (after a jump back from "Send application").
  focusErrors: boolean
  // Called on every change, so the draft on this device stays current.
  onChange: (values: V) => void
  onNext: (values: V) => void
  onBack?: (values: V) => void
  pending?: boolean
}

// Keeps the draft in step with the form, shows any messages the step arrived with, and returns
// the submit handler. Focus goes to the first problem in reading order, not registration order.
function useStep<V extends FieldValues>(form: UseFormReturn<V>, { errors, focusErrors, onChange, onNext }: StepProps<V>, order: readonly Path<V>[]) {
  const { subscribe, setError, setFocus, handleSubmit } = form
  useEffect(() => subscribe({ formState: { values: true }, callback: ({ values }) => onChange({ ...values }) }), [subscribe, onChange])

  // A step remounts on every arrival, so these are read once.
  const [arrival] = useState(() => ({ errors, focusErrors }))
  useEffect(() => {
    const names = order.filter((name) => arrival.errors[name])
    for (const name of names) setError(name, { type: 'server', message: arrival.errors[name] })
    if (arrival.focusErrors && names[0]) setFocus(names[0])
  }, [arrival, order, setError, setFocus])

  return handleSubmit(onNext, (problems) => {
    const first = order.find((name) => name in problems)
    if (first) setFocus(first)
  })
}

const touch = { minHeight: 44 }

function StepForm({ onSubmit, onBack, nextLabel, pending, children }: { onSubmit: FormEventHandler; onBack?: () => void; nextLabel: string; pending?: boolean; children: ReactNode }) {
  return (
    <Box component="form" noValidate onSubmit={onSubmit}>
      <Stack spacing={2.5}>
        {children}
        <Stack direction="row" sx={{ justifyContent: onBack ? 'space-between' : 'flex-end', gap: 1.5, pt: 1 }}>
          {onBack && (
            <Button variant="outlined" size="large" onClick={onBack} startIcon={<ArrowLeft size={18} strokeWidth={1.5} aria-hidden="true" />} sx={touch}>
              {copy.back}
            </Button>
          )}
          <Button type="submit" variant="contained" size="large" disabled={pending} sx={{ ...touch, flex: { xs: 1, sm: 'none' } }}>
            {nextLabel}
          </Button>
        </Stack>
      </Stack>
    </Box>
  )
}

const noAutoCaps = { htmlInput: { autoCapitalize: 'none', spellCheck: false } }

// ---- 1 · Your brand ----------------------------------------------------------------------

const BRAND_ORDER = ['brand_name', 'city', 'instagram_or_website'] as const

export function BrandStep(props: StepProps<BrandValues>) {
  const form = useForm<BrandValues>({ resolver: zodResolver(brandSchema), defaultValues: props.values, shouldFocusError: false })
  const onSubmit = useStep(form, props, BRAND_ORDER)
  const { register, formState } = form
  const { errors } = formState
  return (
    <StepForm onSubmit={onSubmit} nextLabel={copy.next}>
      <TextField label={f.brandName} autoComplete="organization" {...fieldProps(register('brand_name'), errors.brand_name, h.brandName)} />
      <TextField label={f.city} autoComplete="address-level2" {...fieldProps(register('city'), errors.city, h.city)} />
      <TextField label={f.link} autoComplete="url" slotProps={noAutoCaps} {...fieldProps(register('instagram_or_website'), errors.instagram_or_website, h.link)} />
    </StepForm>
  )
}

// ---- 2 · Contact -------------------------------------------------------------------------

const CONTACT_ORDER = ['owner_name', 'email', 'phone'] as const

export function ContactStep(props: StepProps<ContactValues>) {
  const form = useForm<ContactValues>({ resolver: zodResolver(contactSchema), defaultValues: props.values, shouldFocusError: false })
  const onSubmit = useStep(form, props, CONTACT_ORDER)
  const { register, getValues, formState } = form
  const { errors } = formState
  const back = props.onBack
  return (
    <StepForm onSubmit={onSubmit} onBack={back && (() => back(getValues()))} nextLabel={copy.next}>
      <TextField label={f.ownerName} autoComplete="name" {...fieldProps(register('owner_name'), errors.owner_name, h.ownerName)} />
      <TextField
        label={f.email}
        type="email"
        autoComplete="email"
        slotProps={{ htmlInput: { inputMode: 'email', autoCapitalize: 'none', spellCheck: false } }}
        {...fieldProps(register('email'), errors.email, h.email)}
      />
      <TextField label={f.phone} type="tel" autoComplete="tel" slotProps={{ htmlInput: { inputMode: 'tel' } }} {...fieldProps(register('phone'), errors.phone, h.phone)} />
    </StepForm>
  )
}

// ---- 3 · Catalogue -----------------------------------------------------------------------

const CATALOGUE_ORDER = ['product_types', 'price_min', 'price_max', 'about'] as const

const fieldset = { border: 0, p: 0, m: 0, minWidth: 0 }
const legend = { typography: 'body1', color: 'text.primary', mb: 0.5, '&.Mui-focused': { color: 'text.primary' } }

function CategoryChips({ control }: { control: Control<CatalogueValues> }) {
  const hintId = useId()
  return (
    <Controller
      name="product_types"
      control={control}
      render={({ field, fieldState }) => {
        const chosen = new Set(field.value)
        const toggle = (category: string) => field.onChange(chosen.has(category) ? field.value.filter((c) => c !== category) : [...field.value, category])
        return (
          <Box component="fieldset" aria-describedby={hintId} sx={fieldset}>
            <FormLabel component="legend" error={Boolean(fieldState.error)} sx={{ ...legend, mb: 1.25 }}>
              {f.productTypes}
            </FormLabel>
            <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 1 }}>
              {onboardingCopy.categories.map((category, i) => {
                const on = chosen.has(category)
                return (
                  <Chip
                    key={category}
                    component="button"
                    ref={i === 0 ? field.ref : undefined}
                    label={category}
                    aria-pressed={on}
                    onClick={() => toggle(category)}
                    onBlur={field.onBlur}
                    icon={on ? <Check size={16} strokeWidth={1.5} aria-hidden="true" /> : undefined}
                    variant="outlined"
                    sx={{
                      height: { xs: 44, md: 36 },
                      px: 0.5,
                      typography: 'body1',
                      color: neutral.ink,
                      borderColor: on ? brand.brown : neutral.lineStrong,
                      bgcolor: on ? brand.cream : 'transparent',
                      '& .MuiChip-icon': { color: brand.brown, ml: 1, mr: -0.5 },
                      '&&:hover': { bgcolor: on ? brand.cream : 'transparent' },
                      '@media (hover: hover)': { '&&:hover': { bgcolor: on ? brand.cream : neutral.muted } },
                      '&.Mui-focusVisible': { outline: `2px solid ${brand.navy}`, outlineOffset: 2, bgcolor: on ? brand.cream : 'transparent' },
                    }}
                  />
                )
              })}
            </Stack>
            <FormHelperText id={hintId} error={Boolean(fieldState.error)} sx={{ mx: 1.75, mt: 0.75 }}>
              {fieldState.error?.message ?? h.productTypes}
            </FormHelperText>
          </Box>
        )
      }}
    />
  )
}

const rupee = { input: { startAdornment: <InputAdornment position="start">₹</InputAdornment> }, htmlInput: { inputMode: 'numeric' as const } }

export function CatalogueStep(props: StepProps<CatalogueValues>) {
  const form = useForm<CatalogueValues>({ resolver: zodResolver(catalogueSchema), defaultValues: props.values, shouldFocusError: false })
  const onSubmit = useStep(form, props, CATALOGUE_ORDER)
  const { register, getValues, control, formState } = form
  const { errors } = formState
  const about = useWatch({ control, name: 'about' })
  const priceHintId = useId()
  const back = props.onBack
  return (
    <StepForm onSubmit={onSubmit} onBack={back && (() => back(getValues()))} nextLabel={props.pending ? copy.submitting : copy.submit} pending={props.pending}>
      <CategoryChips control={control} />
      <Box component="fieldset" aria-describedby={priceHintId} sx={fieldset}>
        <FormLabel component="legend" sx={legend}>
          {f.priceRange}
        </FormLabel>
        <Typography id={priceHintId} variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {h.priceRange}
        </Typography>
        <Stack direction="row" spacing={1.5}>
          <TextField label={f.priceMin} autoComplete="off" slotProps={rupee} sx={{ flex: 1, minWidth: 0 }} {...fieldProps(register('price_min'), errors.price_min)} />
          <TextField label={f.priceMax} autoComplete="off" slotProps={rupee} sx={{ flex: 1, minWidth: 0 }} {...fieldProps(register('price_max'), errors.price_max)} />
        </Stack>
      </Box>
      <TextField
        label={f.about}
        multiline
        minRows={4}
        {...fieldProps(register('about'), errors.about)}
        helperText={
          <Box component="span" sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
            <span>{errors.about?.message ?? h.about}</span>
            <Box component="span" aria-hidden="true" sx={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
              {about.trim().length} / {ABOUT_MAX}
            </Box>
          </Box>
        }
      />
    </StepForm>
  )
}
