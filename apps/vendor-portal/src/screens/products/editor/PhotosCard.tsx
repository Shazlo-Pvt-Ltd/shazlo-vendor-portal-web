import { Box, Button, ButtonBase, IconButton, LinearProgress, Stack, Typography } from '@mui/material'
import { brand, neutral, radius, SectionCard, status, useSnackbar } from '@shazlo/ui'
import { AlertTriangle, ImageOff, Plus, Trash2, Upload } from 'lucide-react'
import { memo, useId, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import type { Schemas } from '../../../api/client'
import { useAddProductImage, useRemoveProductImage } from '../../../api/queries'
import { productEditorCopy } from '../../../copy/productEditor'
import { srOnly } from '../../../lib/a11y'

const copy = productEditorCopy.photos

type Image = Schemas['Product']['images'][number]
type Angle = Schemas['PhotoAngle']
export type RequiredAngle = Exclude<Angle, 'extra'>

export const REQUIRED_ANGLES: RequiredAngle[] = ['front', 'back', 'closeup']
const MAX_PHOTOS = 8
const ACCEPT = 'image/jpeg,image/png,image/webp'

export const photoSlotId = (prefix: string, angle: RequiredAngle) => `${prefix}-photo-${angle}`
export const missingAngles = (images: Image[]) => REQUIRED_ANGLES.filter((a) => !images.some((i) => i.angle === a))


type Names = { upload: string; remove: string; replace: string; alt: string; file: string }

function tileFrame(width: number, dashed: boolean, flagged = false) {
  return {
    width,
    aspectRatio: '4 / 5',
    borderRadius: `${radius.card}px`,
    overflow: 'hidden',
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0.75,
    px: 1,
    textAlign: 'center',
    bgcolor: dashed ? neutral.canvas : neutral.placeholder,
    border: dashed ? `1.5px dashed ${flagged ? status.error : neutral.lineStrong}` : `1px solid ${neutral.line}`,
    color: flagged ? status.error : neutral.inkSecondary,
  } as const
}

// One photo position: a label, then the photo (or a dashed upload button), then Replace / Remove.
function Tile({
  label,
  flagged,
  image,
  preview,
  names,
  width,
  compact,
  disabled,
  readOnly,
  slotId,
  multiple,
  addTile,
  onFiles,
  onRemove,
}: {
  label?: string
  flagged?: boolean
  image?: Image
  preview?: string
  names: Names
  width: number
  compact: boolean
  disabled: boolean
  readOnly: boolean
  slotId?: string
  multiple?: boolean
  addTile?: boolean
  onFiles: (files: File[]) => void
  onRemove?: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const missingId = useId()
  const pick = () => input.current?.click()
  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length) onFiles(files)
  }
  const target = compact ? 44 : 32

  let body: ReactNode
  if (preview) {
    body = (
      <Box aria-busy="true" sx={{ ...tileFrame(width, false), justifyContent: 'flex-end', p: 0 }}>
        <Box component="img" src={preview} alt="" sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.45 }} />
        <Box sx={{ position: 'relative', width: '100%', bgcolor: neutral.surface, px: 1, py: 0.75 }}>
          <Typography variant="caption" component="p" sx={{ mb: 0.5 }}>
            {copy.uploading}
          </Typography>
          <LinearProgress aria-hidden="true" sx={{ height: 3, borderRadius: 2, bgcolor: neutral.placeholder, '& .MuiLinearProgress-bar': { bgcolor: brand.brown } }} />
        </Box>
      </Box>
    )
  } else if (image) {
    body = <Box component="img" src={image.url} alt={names.alt} loading="lazy" sx={{ ...tileFrame(width, false), display: 'block', objectFit: 'cover', p: 0 }} />
  } else if (readOnly) {
    body = (
      <Box sx={tileFrame(width, true)}>
        <ImageOff size={18} strokeWidth={1.5} aria-hidden="true" />
        <Typography variant="caption" color="inherit">
          {names.alt}
        </Typography>
      </Box>
    )
  } else {
    const Icon = addTile ? Plus : Upload
    body = (
      <ButtonBase
        id={slotId}
        onClick={pick}
        disabled={disabled}
        aria-describedby={flagged ? missingId : undefined}
        sx={{
          ...tileFrame(width, true, flagged),
          '@media (hover: hover)': { '&:hover': { bgcolor: 'rgba(255, 237, 163, 0.45)' } },
          '&.Mui-disabled': { opacity: 0.6 },
          '&.Mui-focusVisible': { outline: `2px solid ${brand.navy}`, outlineOffset: 2 },
        }}
      >
        <Icon size={18} strokeWidth={1.5} aria-hidden="true" />
        <Typography variant="caption" component="span" color="inherit">
          {names.upload}
        </Typography>
      </ButtonBase>
    )
  }

  return (
    <Box component="li" sx={{ width, flexShrink: 0, scrollSnapAlign: 'start' }}>
      {label && (
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', mb: 0.75, minHeight: 20, color: flagged ? 'error.main' : 'text.secondary' }}>
          {flagged && <AlertTriangle size={14} strokeWidth={1.75} aria-hidden="true" />}
          <Typography variant="body2" component="span" color="inherit" noWrap>
            {label}
          </Typography>
        </Stack>
      )}
      {body}
      {flagged && !image && !preview && (
        <Box component="span" id={missingId} sx={srOnly}>
          {copy.missing(label ?? '')}
        </Box>
      )}
      {image && !preview && !readOnly && (
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mt: 0.5 }}>
          <Button size="small" onClick={pick} aria-label={names.replace} sx={{ minHeight: target, px: 1, ml: -1 }}>
            {copy.replace}
          </Button>
          <IconButton aria-label={names.remove} onClick={onRemove} sx={{ width: target, height: target, mr: -0.5, color: neutral.inkSecondary }}>
            <Trash2 size={16} strokeWidth={1.5} aria-hidden="true" />
          </IconButton>
        </Stack>
      )}
      {!readOnly && <input ref={input} type="file" hidden accept={ACCEPT} multiple={multiple} aria-label={names.file} onChange={onChange} />}
    </Box>
  )
}

export const PhotosCard = memo(function PhotosCard({
  productId,
  images,
  readOnly,
  flagMissing,
  problem,
  compact,
  idPrefix,
}: {
  productId: string | null
  images: Image[]
  readOnly: boolean
  flagMissing: boolean
  problem: string | null
  compact: boolean
  idPrefix: string
}) {
  const add = useAddProductImage(productId ?? '')
  const remove = useRemoveProductImage(productId ?? '')
  const notify = useSnackbar()
  const [uploading, setUploading] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const width = compact ? 112 : 120
  const disabled = !productId
  const extras = images.filter((i) => i.angle === 'extra')
  const missing = missingAngles(images)
  const room = MAX_PHOTOS - images.length - Object.keys(uploading).length
  const row = {
    listStyle: 'none',
    m: 0,
    p: 0,
    display: 'flex',
    gap: 2,
    flexWrap: compact ? 'nowrap' : 'wrap',
    overflowX: compact ? 'auto' : 'visible',
    scrollSnapType: compact ? 'x mandatory' : undefined,
    pb: compact ? 1 : 0,
  } as const

  async function upload(slot: string, angle: Angle, files: File[], replaceId?: string) {
    setError(null)
    for (const file of files) {
      const preview = URL.createObjectURL(file)
      setUploading((u) => ({ ...u, [slot]: preview }))
      try {
        await add.mutateAsync({ file, angle })
        if (replaceId) await remove.mutateAsync(replaceId)
      } catch (e) {
        setError(copy.notAdded(file.name, e instanceof Error ? e.message : ''))
        break
      } finally {
        URL.revokeObjectURL(preview)
        setUploading(({ [slot]: _done, ...rest }) => rest)
      }
    }
  }

  async function removeImage(image: Image, label: string) {
    setError(null)
    try {
      await remove.mutateAsync(image.id)
      notify(copy.removed(label))
    } catch {
      setError(copy.removeFailed)
    }
  }

  const common = { width, compact, disabled, readOnly }

  return (
    <SectionCard
      title={copy.title}
      action={
        <Typography variant="caption" color="text.secondary">
          {copy.limits}
        </Typography>
      }
    >
      {!productId && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {copy.needsTitle}
        </Typography>
      )}
      <Box component="ul" role="list" aria-label={copy.requiredList} sx={row}>
        {REQUIRED_ANGLES.map((angle) => {
          const label = copy.slots[angle]
          const image = images.find((i) => i.angle === angle)
          return (
            <Tile
              key={angle}
              {...common}
              label={label}
              slotId={photoSlotId(idPrefix, angle)}
              flagged={flagMissing && missing.includes(angle)}
              image={image}
              preview={uploading[angle]}
              names={{ upload: copy.upload(label), remove: copy.remove(label), replace: copy.replaceLabel(label), alt: copy.photoAlt(label), file: copy.fileInput(label) }}
              onFiles={(files) => void upload(angle, angle, files.slice(0, 1))}
              onRemove={image ? () => void removeImage(image, label) : undefined}
            />
          )
        })}
      </Box>

      {productId && (extras.length > 0 || !readOnly) && (
        <Box sx={{ mt: 3 }}>
          <Typography variant="h3" component="h3">
            {copy.extraHeading}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {copy.extraHint}
          </Typography>
          <Box component="ul" role="list" aria-label={copy.extraList} sx={row}>
            {extras.map((image, i) => {
              const n = i + 1
              const label = copy.extra(n)
              return (
                <Tile
                  key={image.id}
                  {...common}
                  image={image}
                  preview={uploading[image.id]}
                  names={{ upload: '', remove: copy.removeExtra(n), replace: copy.replaceExtra(n), alt: copy.extraAlt(n), file: copy.replaceExtraFile(n) }}
                  onFiles={(files) => void upload(image.id, 'extra', files.slice(0, 1), image.id)}
                  onRemove={() => void removeImage(image, label)}
                />
              )
            })}
            {uploading.add && <Tile {...common} preview={uploading.add} names={{ upload: '', remove: '', replace: '', alt: '', file: '' }} readOnly onFiles={() => {}} />}
            {!readOnly && room > 0 && (
              <Tile
                {...common}
                addTile
                multiple
                names={{ upload: copy.addPhoto, remove: '', replace: '', alt: '', file: copy.addFileInput }}
                onFiles={(files) => void upload('add', 'extra', files.slice(0, room))}
              />
            )}
          </Box>
        </Box>
      )}

      {error && (
        <Typography role="alert" variant="body2" color="error.main" sx={{ display: 'flex', gap: 0.75, alignItems: 'flex-start', mt: 2 }}>
          <AlertTriangle size={16} strokeWidth={1.75} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
          {error}
        </Typography>
      )}
      {problem && missing.length > 0 && (
        <Typography variant="body2" color="error.main" sx={{ display: 'flex', gap: 0.75, alignItems: 'flex-start', mt: 2 }}>
          <AlertTriangle size={16} strokeWidth={1.75} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
          {problem}
        </Typography>
      )}
      <Typography variant="caption" component="p" color="text.secondary" sx={{ mt: 2, maxWidth: '68ch' }}>
        {copy.helper}
      </Typography>
    </SectionCard>
  )
})
