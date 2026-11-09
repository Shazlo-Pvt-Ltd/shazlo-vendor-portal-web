import { Box, Button, FormHelperText, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { brand, fontFamily, neutral, radius, StatusPill } from '@shazlo/ui'
import { ImageIcon, Upload } from 'lucide-react'
import { memo, useId, useRef, useState, type ChangeEvent, type InputHTMLAttributes, type ReactNode } from 'react'
import { Controller, type Control } from 'react-hook-form'
import { useUploadImage } from '../../api/queries'
import { brandCopy as copy } from '../../copy/brand'
import { initials, type BrandValues } from './schema'

// The form re-renders on every keystroke (the preview and Changed tags follow the values), so the
// inputs below are memoised: each one redraws only when its own value, error or props change.
// Pass them stable props (module-level option lists and input attributes).

const IMAGE_TYPES = 'image/jpeg,image/png,image/webp'
// 44 px touch targets on phones.
export const touchTarget = { minHeight: { xs: 44, md: 36 } } as const

// Options board pick: a small cream "Changed" tag beside the label of every field that differs from the live page.
export function ChangedTag() {
  return <StatusPill status="pending" label={copy.changed} />
}

// A static label above the control, so the Changed tag can sit beside it. The tag is part of the
// label text, so screen readers hear "Story Changed" on the field itself.
export function FieldLabel({ id, htmlFor, label, changed = false }: { id?: string; htmlFor?: string; label: string; changed?: boolean }) {
  const sx = { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, minHeight: 22, mb: 0.75, color: neutral.ink } as const
  const content = (
    <>
      {label}
      {changed && (
        <>
          {' '}
          <ChangedTag />
        </>
      )}
    </>
  )
  return htmlFor ? (
    <Typography component="label" id={id} htmlFor={htmlFor} variant="body2" sx={sx}>
      {content}
    </Typography>
  ) : (
    <Typography component="div" id={id} variant="body2" sx={sx}>
      {content}
    </Typography>
  )
}

// Error or hint on the left, "38 / 60" on the right.
function CountedHelper({ message, count, max }: { message?: string; count: number; max: number }) {
  return (
    <Box component="span" sx={{ display: 'flex', gap: 2 }}>
      {message && (
        <>
          <span>{message}</span>{' '}
        </>
      )}
      <Box component="span" sx={{ ml: 'auto', flexShrink: 0, fontVariantNumeric: 'tabular-nums', color: count > max ? 'error.main' : 'text.secondary' }}>
        {count} / {max}
      </Box>
    </Box>
  )
}

type TextName = 'based_in' | 'tagline' | 'story' | 'instagram' | 'website'

export const TextInput = memo(function TextInput({
  control,
  name,
  label,
  changed,
  disabled,
  max,
  multiline = false,
  htmlInput,
}: {
  control: Control<BrandValues>
  name: TextName
  label: string
  changed: boolean
  disabled: boolean
  max?: number
  multiline?: boolean
  htmlInput?: InputHTMLAttributes<HTMLInputElement>
}) {
  const id = useId()
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const message = fieldState.error?.message
        return (
          <Box>
            <FieldLabel htmlFor={id} label={label} changed={changed} />
            <TextField
              id={id}
              name={field.name}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              inputRef={field.ref}
              disabled={disabled}
              error={Boolean(message)}
              helperText={max === undefined ? message : <CountedHelper message={message} count={field.value.length} max={max} />}
              fullWidth
              multiline={multiline}
              minRows={multiline ? 4 : undefined}
              maxRows={multiline ? 14 : undefined}
              slotProps={{ htmlInput }}
            />
          </Box>
        )
      }}
    />
  )
})

export const SelectInput = memo(function SelectInput({
  control,
  name,
  label,
  options,
  changed,
  disabled,
}: {
  control: Control<BrandValues>
  name: 'return_policy' | 'dispatch_time'
  label: string
  options: readonly { value: string; label: string }[]
  changed: boolean
  disabled: boolean
}) {
  const id = useId()
  const labelId = `${id}-label`
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Box>
          <FieldLabel id={labelId} label={label} changed={changed} />
          <TextField select id={id} name={field.name} value={field.value} onChange={field.onChange} onBlur={field.onBlur} inputRef={field.ref} disabled={disabled} fullWidth slotProps={{ select: { labelId } }}>
            {options.map((o) => (
              <MenuItem key={o.value} value={o.value} sx={touchTarget}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>
        </Box>
      )}
    />
  )
})

// A round logo, or the brand's initials until one is uploaded.
export function LogoMark({ url, name, size, alt = '', ring = false }: { url: string | null; name: string; size: number; alt?: string; ring?: boolean }) {
  return (
    <Box
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: '50%',
        overflow: 'hidden',
        display: 'grid',
        placeItems: 'center',
        bgcolor: brand.cream,
        color: brand.brown,
        border: ring ? `3px solid ${neutral.surface}` : `1px solid ${neutral.line}`,
      }}
    >
      {url ? (
        <Box component="img" src={url} alt={alt} sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      ) : (
        <Box component="span" aria-hidden="true" sx={{ fontFamily: fontFamily.display, fontSize: Math.round(size * 0.32), lineHeight: 1 }}>
          {initials(name)}
        </Box>
      )}
    </Box>
  )
}

function CoverFrame({ url, alt }: { url: string | null; alt: string }) {
  return (
    <Box
      sx={{
        position: 'relative',
        aspectRatio: '8 / 3',
        width: '100%',
        borderRadius: `${radius.card}px`,
        overflow: 'hidden',
        bgcolor: neutral.placeholder,
        border: `1px solid ${neutral.line}`,
        display: 'grid',
        placeItems: 'center',
        color: neutral.inkTertiary,
      }}
    >
      {url ? (
        <Box component="img" src={url} alt={alt} sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      ) : (
        <Stack spacing={1} sx={{ alignItems: 'center' }}>
          <ImageIcon size={20} strokeWidth={1.5} aria-hidden="true" />
          <Typography variant="body2">{copy.identity.noCover}</Typography>
        </Stack>
      )}
    </Box>
  )
}

const IMAGE_TEXT = {
  logo: { label: copy.identity.logo, hint: copy.identity.logoHint, preview: copy.identity.logoPreview, file: copy.identity.logoFile },
  cover: { label: copy.identity.cover, hint: copy.identity.coverHint, preview: copy.identity.coverPreview, file: copy.identity.coverFile },
} as const

// Logo or cover: a preview, what makes a good photo, and a button that opens the file picker.
// Upload problems (wrong type, too large) show under the field.
export function ImageField({
  kind,
  value,
  onChange,
  changed,
  disabled,
  brandName,
  fieldError,
}: {
  kind: 'logo' | 'cover'
  value: string | null
  onChange: (url: string) => void
  changed: boolean
  disabled: boolean
  brandName: string
  fieldError?: string
}) {
  const text = IMAGE_TEXT[kind]
  const upload = useUploadImage()
  const [uploadError, setUploadError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const id = useId()
  const labelId = `${id}-label`
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const error = uploadError ?? fieldError
  const verb = value ? copy.identity.replace : copy.identity.upload

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Clear the picker so choosing the same file again still triggers a change.
    if (input.current) input.current.value = ''
    if (!file) return
    setUploadError(null)
    try {
      const { url } = await upload.mutateAsync({ file, purpose: kind })
      onChange(url)
    } catch (e) {
      setUploadError(e instanceof Error && e.message ? e.message : copy.errors.upload)
    }
  }

  const button: ReactNode = (
    <Button
      variant="outlined"
      startIcon={<Upload size={16} strokeWidth={1.5} aria-hidden="true" />}
      onClick={() => input.current?.click()}
      disabled={disabled || upload.isPending}
      aria-label={upload.isPending ? undefined : `${verb} ${text.label.toLowerCase()}`}
      aria-describedby={error ? `${hintId} ${errorId}` : hintId}
      sx={{ ...touchTarget, flexShrink: 0 }}
    >
      {upload.isPending ? copy.identity.uploading : verb}
    </Button>
  )
  const hint = (
    <Typography id={hintId} variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 0 }}>
      {text.hint}
    </Typography>
  )

  return (
    <Box role="group" aria-labelledby={labelId}>
      <FieldLabel id={labelId} label={text.label} changed={changed} />
      {kind === 'logo' ? (
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <LogoMark url={value} name={brandName} size={64} alt={text.preview} />
          {hint}
          {button}
        </Stack>
      ) : (
        <>
          <CoverFrame url={value} alt={text.preview} />
          <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start', mt: 1.5 }}>
            {hint}
            {button}
          </Stack>
        </>
      )}
      {error && (
        <FormHelperText id={errorId} error role="alert" sx={{ mx: 0, mt: 1 }}>
          {error}
        </FormHelperText>
      )}
      <input ref={input} type="file" accept={IMAGE_TYPES} hidden tabIndex={-1} aria-label={text.file} onChange={(e) => void choose(e)} />
    </Box>
  )
}

export const ImageInput = memo(function ImageInput({
  control,
  name,
  changed,
  disabled,
  brandName,
}: {
  control: Control<BrandValues>
  name: 'logo_url' | 'cover_url'
  changed: boolean
  disabled: boolean
  brandName: string
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <ImageField
          kind={name === 'logo_url' ? 'logo' : 'cover'}
          value={field.value}
          onChange={field.onChange}
          changed={changed}
          disabled={disabled}
          brandName={brandName}
          fieldError={fieldState.error?.message}
        />
      )}
    />
  )
})

export const BrandNameField = memo(function BrandNameField({ value }: { value: string }) {
  const id = useId()
  return (
    <Box>
      <FieldLabel htmlFor={id} label={copy.identity.brandName} />
      <TextField id={id} value={value} disabled fullWidth helperText={copy.identity.brandNameHint} />
    </Box>
  )
})
