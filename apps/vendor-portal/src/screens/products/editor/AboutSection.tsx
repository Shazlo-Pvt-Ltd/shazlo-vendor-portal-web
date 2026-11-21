import { Box, Button, Stack, TextField } from '@mui/material'
import { Plus } from 'lucide-react'
import { memo, useState } from 'react'
import { Controller, useWatch, type UseFormReturn } from 'react-hook-form'
import { catalogCopy } from '../../../copy/catalog'
import { productEditorCopy } from '../../../copy/productEditor'
import { COLOURS, GENDERS, MAX_OTHER_COLOURS, PRODUCT_TYPES } from '../../../lib/catalog'
import { CheckboxChips, RadioChips, type Choice } from './Choices'
import { LIMITS, type EditorValues } from './form'
import { EditorSection, fieldId, type Problems } from './layout'

const copy = productEditorCopy.about

const genderChoices: Choice[] = GENDERS.map((g) => ({ value: g, label: catalogCopy.genders[g] }))
const typeChoices: Choice[] = PRODUCT_TYPES.map((t) => ({ value: t, label: catalogCopy.productTypes[t] }))
const colourChoices: Choice[] = COLOURS.map((c) => ({ value: c.name, label: c.name, swatch: { background: c.swatch, border: c.border } }))

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

function OtherColours({ form, readOnly }: { form: Form; readOnly: boolean }) {
  const [main, others] = useWatch({ control: form.control, name: ['mainColour', 'otherColours'] })
  const [open, setOpen] = useState(others.length > 0)
  if (!open && others.length === 0) {
    if (readOnly) return null
    return (
      <Box>
        <Button variant="text" onClick={() => setOpen(true)} startIcon={<Plus size={18} strokeWidth={1.5} aria-hidden="true" />} sx={{ minHeight: 44, ml: -1 }}>
          {copy.addColour}
        </Button>
      </Box>
    )
  }
  return (
    <Controller
      control={form.control}
      name="otherColours"
      render={({ field }) => (
        <CheckboxChips
          legend={copy.otherColours}
          hint={copy.otherHint}
          choices={colourChoices.filter((c) => c.value !== main)}
          value={field.value}
          max={MAX_OTHER_COLOURS}
          disabled={readOnly}
          onChange={field.onChange}
        />
      )}
    />
  )
}

// About the product: name, who it is for, type, colours, material and description (spec §7).
// Problems show only after the seller tries to send it for review, and go once fixed.
export const AboutSection = memo(function AboutSection({ form, readOnly, problems, idPrefix, plain }: { form: Form; readOnly: boolean; problems: Problems; idPrefix: string; plain?: boolean }) {
  const { control, register, getValues, setValue } = form
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
        <Controller
          control={control}
          name="mainColour"
          render={({ field }) => (
            <RadioChips
              legend={copy.mainColour}
              choices={colourChoices}
              value={field.value}
              onChange={(colour) => {
                field.onChange(colour)
                const others = getValues('otherColours')
                if (others.includes(colour)) setValue('otherColours', others.filter((c) => c !== colour), { shouldDirty: true })
              }}
              disabled={readOnly}
              error={problems.main_colour}
              firstId={fieldId(idPrefix, 'main_colour')}
            />
          )}
        />
        <OtherColours form={form} readOnly={readOnly} />
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
