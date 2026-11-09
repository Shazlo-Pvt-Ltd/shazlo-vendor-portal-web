import { Box, MenuItem, Stack, TextField } from '@mui/material'
import { SectionCard } from '@shazlo/ui'
import { memo } from 'react'
import { Controller, useFormState, type UseFormReturn } from 'react-hook-form'
import { productEditorCopy } from '../../../copy/productEditor'
import { fieldProps } from '../../../lib/forms'
import type { EditorValues } from './form'

const copy = productEditorCopy.details
const options = productEditorCopy.options

type SelectName = 'category' | 'gender' | 'fabric'

function SelectField({ form, name, label, choices, readOnly }: { form: UseFormReturn<EditorValues>; name: SelectName; label: string; choices: readonly string[]; readOnly: boolean }) {
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field, fieldState }) => {
        // Keep a value the list does not know (from a bulk import, say) selectable instead of blank.
        const list = field.value && !choices.includes(field.value) ? [field.value, ...choices] : choices
        return (
          <TextField
            select
            fullWidth
            label={label}
            name={field.name}
            value={field.value}
            inputRef={field.ref}
            onBlur={field.onBlur}
            onChange={(event) => {
              form.clearErrors(name)
              field.onChange(event.target.value)
            }}
            error={Boolean(fieldState.error)}
            helperText={fieldState.error?.message}
            slotProps={{ input: { readOnly } }}
          >
            {list.map((choice) => (
              <MenuItem key={choice} value={choice}>
                {choice}
              </MenuItem>
            ))}
          </TextField>
        )
      }}
    />
  )
}

// Memoised: `form` is stable, so typing elsewhere does not re-render this card; it follows its own errors.
export const DetailsCard = memo(function DetailsCard({ form, readOnly }: { form: UseFormReturn<EditorValues>; readOnly: boolean }) {
  const { register, clearErrors, control, getFieldState } = form
  // Drops a server error as soon as the seller edits the field (without re-rendering on every key).
  const clearIfShown = (name: 'title' | 'description') => getFieldState(name).error && clearErrors(name)
  const { errors } = useFormState({ control, name: ['title', 'description'] })
  const locked = { input: { readOnly } }
  return (
    <SectionCard title={copy.title}>
      <Stack spacing={2.5}>
        <TextField label={copy.name} {...fieldProps(register('title', { onChange: () => clearIfShown('title') }), errors.title, copy.nameHint)} slotProps={locked} />
        <TextField
          label={copy.description}
          multiline
          minRows={4}
          {...fieldProps(register('description', { onChange: () => clearIfShown('description') }), errors.description, copy.descriptionHint)}
          slotProps={locked}
        />
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(3, minmax(0, 1fr))' } }}>
          <SelectField form={form} name="category" label={copy.category} choices={options.categories} readOnly={readOnly} />
          <SelectField form={form} name="gender" label={copy.gender} choices={options.genders} readOnly={readOnly} />
          <SelectField form={form} name="fabric" label={copy.fabric} choices={options.fabrics} readOnly={readOnly} />
        </Box>
      </Stack>
    </SectionCard>
  )
})
