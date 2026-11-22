import { Box, Button, Stack, TextField, Typography } from '@mui/material'
import { Plus } from 'lucide-react'
import { memo, useEffect, useRef } from 'react'
import { Controller, useWatch, type UseFormReturn } from 'react-hook-form'
import { catalogCopy } from '../../../copy/catalog'
import { productEditorCopy } from '../../../copy/productEditor'
import { GENDERS, MAX_OTHER_COLOURS, PRODUCT_TYPES } from '../../../lib/catalog'
import { RadioChips, type Choice } from './Choices'
import { ColourField } from './ColourField'
import { LIMITS, tidyColour, type EditorValues } from './form'
import { EditorSection, fieldId, otherColourId, type Problems } from './layout'

const copy = productEditorCopy.about

const genderChoices: Choice[] = GENDERS.map((g) => ({ value: g, label: catalogCopy.genders[g] }))
const typeChoices: Choice[] = PRODUCT_TYPES.map((t) => ({ value: t, label: catalogCopy.productTypes[t] }))

type Form = UseFormReturn<EditorValues>

// Name, on its own: a new product on a phone starts with it on the Photos step too, because photos
// need a saved draft and a draft needs a name.
export function NameField({ form, readOnly, problem, idPrefix }: { form: Form; readOnly: boolean; problem?: string; idPrefix: string }) {
  const { ref, ...field } = form.register('title')
  return (
    <TextField
      {...field}
      inputRef={ref}
      id={fieldId(idPrefix, 'title')}
      label={copy.name}
      fullWidth
      error={Boolean(problem)}
      helperText={problem ?? copy.nameHint}
      slotProps={{ input: { readOnly }, htmlInput: { autoComplete: 'off', enterKeyHint: 'next', maxLength: LIMITS.title } }}
    />
  )
}

// Colours are checked together (an other colour may repeat the main one): when the seller leaves a
// colour field, and again as they fix one that shows a message.
function useColourChecks(form: Form) {
  const { trigger, getFieldState } = form
  const check = () => void trigger(['mainColour', 'otherColours'])
  const recheck = () => {
    if (getFieldState('mainColour').error || getFieldState('otherColours').error) check()
  }
  return { check, recheck }
}

function MainColour({ form, readOnly, problem, idPrefix }: { form: Form; readOnly: boolean; problem?: string; idPrefix: string }) {
  const { check, recheck } = useColourChecks(form)
  return (
    <Controller
      control={form.control}
      name="mainColour"
      render={({ field, fieldState }) => (
        <ColourField
          id={fieldId(idPrefix, 'main_colour')}
          label={copy.mainColour}
          hint={copy.colourHint}
          value={field.value}
          readOnly={readOnly}
          error={fieldState.error?.message ?? problem}
          pickLabel={copy.pickShade(copy.mainColour)}
          onChange={(value) => {
            field.onChange(value)
            recheck()
          }}
          onBlur={() => {
            const tidy = tidyColour(form.getValues('mainColour'))
            if (tidy !== form.getValues('mainColour')) field.onChange(tidy)
            field.onBlur()
            check()
          }}
        />
      )}
    />
  )
}

// Up to 2 other colours, each its own field with a picker and a way to take it away again. With
// none yet, only the button to add one.
function OtherColours({ form, readOnly, idPrefix }: { form: Form; readOnly: boolean; idPrefix: string }) {
  const { control, getValues, setValue } = form
  const others = useWatch({ control, name: 'otherColours' })
  const { check, recheck } = useColourChecks(form)
  // After adding or removing a colour, focus goes to a field (or the add button) that is there.
  const focusNext = useRef<string | null>(null)
  const addRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!focusNext.current) return
    const target = focusNext.current === 'add' ? addRef.current : document.getElementById(focusNext.current)
    focusNext.current = null
    target?.focus()
  }, [others.length])

  const add = () => {
    focusNext.current = otherColourId(idPrefix, others.length)
    setValue('otherColours', [...getValues('otherColours'), ''], { shouldDirty: true })
  }
  const removeAt = (index: number) => {
    const next = getValues('otherColours').filter((_, i) => i !== index)
    focusNext.current = next.length === 0 ? 'add' : otherColourId(idPrefix, Math.min(index, next.length - 1))
    setValue('otherColours', next, { shouldDirty: true })
    recheck()
  }
  const canAdd = !readOnly && others.length < MAX_OTHER_COLOURS
  const addButton = canAdd ? (
    <Box>
      <Button ref={addRef} variant="text" onClick={add} startIcon={<Plus size={18} strokeWidth={1.75} aria-hidden="true" />} sx={{ minHeight: 44, ml: -1 }}>
        {copy.addColour}
      </Button>
    </Box>
  ) : null
  if (others.length === 0) return addButton

  return (
    <Box component="fieldset" sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}>
      <Typography component="legend" variant="subtitle1" sx={{ p: 0, mb: 0.25 }}>
        {copy.otherColours}
      </Typography>
      <Typography variant="body2" color="textSecondary" sx={{ mb: 1.5 }}>
        {copy.otherHint}
      </Typography>
      <Stack spacing={2}>
        {others.map((_, index) => (
          <Controller
            key={index}
            control={control}
            name={`otherColours.${index}`}
            render={({ field, fieldState }) => (
              <ColourField
                id={otherColourId(idPrefix, index)}
                label={copy.otherColour(index + 1)}
                value={field.value ?? ''}
                readOnly={readOnly}
                error={fieldState.error?.message}
                pickLabel={copy.pickShade(copy.otherColour(index + 1))}
                removeLabel={copy.removeColour(index + 1)}
                onRemove={() => removeAt(index)}
                onChange={(value) => {
                  field.onChange(value)
                  recheck()
                }}
                onBlur={() => {
                  const tidy = tidyColour(field.value ?? '')
                  if (tidy !== field.value) field.onChange(tidy)
                  field.onBlur()
                  check()
                }}
              />
            )}
          />
        ))}
        {addButton}
      </Stack>
    </Box>
  )
}

// About the product: name, who it is for, type, colours, material and description (spec §7).
// Problems show only after the seller tries to send it for review, and go once fixed.
export const AboutSection = memo(function AboutSection({ form, readOnly, problems, idPrefix, plain }: { form: Form; readOnly: boolean; problems: Problems; idPrefix: string; plain?: boolean }) {
  const { control, register } = form
  const text = (name: 'material' | 'description') => {
    const { ref, ...field } = register(name)
    return { ...field, inputRef: ref, id: fieldId(idPrefix, name), fullWidth: true }
  }
  return (
    <EditorSection title={copy.title} plain={plain}>
      <Stack spacing={3}>
        <NameField form={form} readOnly={readOnly} problem={problems.title} idPrefix={idPrefix} />
        <Controller
          control={control}
          name="gender"
          render={({ field }) => (
            <RadioChips legend={copy.gender} choices={genderChoices} value={field.value} onChange={field.onChange} disabled={readOnly} error={problems.gender} firstId={fieldId(idPrefix, 'gender')} />
          )}
        />
        <Controller
          control={control}
          name="category"
          render={({ field }) => (
            <RadioChips legend={copy.type} choices={typeChoices} value={field.value} onChange={field.onChange} disabled={readOnly} error={problems.category} firstId={fieldId(idPrefix, 'category')} />
          )}
        />
        <MainColour form={form} readOnly={readOnly} problem={problems.main_colour} idPrefix={idPrefix} />
        <OtherColours form={form} readOnly={readOnly} idPrefix={idPrefix} />
        <TextField {...text('material')} label={copy.material} error={Boolean(problems.material)} helperText={problems.material ?? copy.materialHint} slotProps={{ input: { readOnly }, htmlInput: { autoComplete: 'off', maxLength: LIMITS.material } }} />
        <TextField
          {...text('description')}
          label={copy.description}
          multiline
          minRows={4}
          error={Boolean(problems.description)}
          helperText={problems.description ?? copy.descriptionHint}
          slotProps={{ input: { readOnly }, htmlInput: { maxLength: LIMITS.description } }}
        />
      </Stack>
    </EditorSection>
  )
})
