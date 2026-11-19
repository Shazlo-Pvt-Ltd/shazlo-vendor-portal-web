import { Box, Button, Chip, Stack, TextField, Typography } from '@mui/material'
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { SafeImage } from '../../security/SafeImage'
import { ImageUploader } from '../uploads/ImageUploader'
import { LIMITS, move, type ImageValues } from './form'

export const IMAGES_ID = 'product-images'
export const altFieldId = (assetId: string) => `image-${assetId}-alt`

interface Props {
  images: ImageValues[]
  errors: Record<string, string>
  listError: string | undefined
  /** The form is read-only (in review, archived): no uploads, no changes. */
  disabled: boolean
  onChange: (next: ImageValues[]) => void
  onAltEdited: (assetId: string) => void
}

type Action = 'up' | 'down'

/**
 * A product's images in the order shoppers see them; the first is the cover. They can be put in
 * order by dragging, or with the Move buttons (for keyboard and screen-reader users), and each has
 * its own alternative text. A move is announced, and focus stays with the image that moved.
 */
export function ImagesEditor({ images, errors, listError, disabled, onChange, onAltEdited }: Props) {
  const [announcement, setAnnouncement] = useState('')
  const [dragging, setDragging] = useState<number | null>(null)
  const [focusAfterMove, setFocusAfterMove] = useState<{ assetId: string; action: Action } | null>(null)
  const buttons = useRef(new Map<string, HTMLButtonElement | null>())
  // The uploader reports each image once; the list may have changed meanwhile, so read it from a ref.
  const latest = useRef(images)
  latest.current = images

  useEffect(() => {
    if (!focusAfterMove) return
    const { assetId, action } = focusAfterMove
    // At the top there is no "Move up" any more (and no "Move down" at the bottom): use the other one.
    const own = buttons.current.get(`${assetId}:${action}`)
    const other = buttons.current.get(`${assetId}:${action === 'up' ? 'down' : 'up'}`)
    ;(own && !own.disabled ? own : other)?.focus()
    setFocusAfterMove(null)
  }, [focusAfterMove])

  const reorder = (from: number, to: number, action?: Action) => {
    const image = images[from]
    if (!image || to < 0 || to >= images.length || from === to) return
    onChange(move(images, from, to))
    setAnnouncement(`Image ${from + 1} moved to position ${to + 1} of ${images.length}.${to === 0 ? ' It is now the cover.' : ''}`)
    if (action) setFocusAfterMove({ assetId: image.assetId, action })
  }

  const remove = (index: number) => {
    onChange(images.filter((_, i) => i !== index))
    setAnnouncement(`Image ${index + 1} removed.`)
  }

  const onDrop = (event: DragEvent, to: number) => {
    event.preventDefault()
    if (dragging !== null) reorder(dragging, to)
    setDragging(null)
  }

  const full = images.length >= LIMITS.images

  return (
    <Box component="section" aria-labelledby={`${IMAGES_ID}-heading`}>
      <Typography id={`${IMAGES_ID}-heading`} component="h2" variant="h6" gutterBottom>
        Images
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Up to {LIMITS.images} images. The first one is the cover shoppers see in lists. Drag an image, or use its Move buttons, to
        change the order. Describe each one for shoppers who cannot see it.
      </Typography>
      {listError ? (
        <Typography id={IMAGES_ID} tabIndex={-1} color="error" variant="body2" role="alert" sx={{ mb: 2 }}>
          {listError}
        </Typography>
      ) : null}

      {images.length > 0 ? (
        <Box component="ol" aria-label="Product images, in order" sx={{ p: 0, m: 0, mb: 2, display: 'grid', gap: 2 }}>
          {images.map((image, index) => {
            const label = `image ${index + 1}`
            return (
              <Stack
                key={image.assetId}
                component="li"
                direction={{ xs: 'column', sm: 'row' }}
                spacing={2}
                draggable={!disabled}
                onDragStart={() => setDragging(index)}
                onDragOver={(event: DragEvent) => event.preventDefault()}
                onDrop={(event: DragEvent) => onDrop(event, index)}
                onDragEnd={() => setDragging(null)}
                sx={{
                  listStyle: 'none',
                  p: 1.5,
                  border: 1,
                  borderColor: dragging === index ? 'primary.main' : 'divider',
                  borderRadius: 1,
                  cursor: disabled ? 'default' : 'grab',
                  opacity: dragging === index ? 0.6 : 1,
                }}
              >
                <Box sx={{ width: 96, height: 96, flexShrink: 0, borderRadius: 1, overflow: 'hidden', bgcolor: 'action.hover' }}>
                  <SafeImage src={image.url} alt={image.alt.trim()} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </Box>
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
                    <Typography variant="subtitle2">Image {index + 1}</Typography>
                    {index === 0 ? <Chip size="small" color="primary" label="Cover" /> : null}
                  </Stack>
                  <TextField
                    id={altFieldId(image.assetId)}
                    label={`Description of image ${index + 1}`}
                    size="small"
                    fullWidth
                    value={image.alt}
                    error={errors[image.assetId] !== undefined}
                    helperText={errors[image.assetId] ?? 'For example "Front view, indigo kurta on a model"'}
                    onChange={(event) => {
                      onChange(images.map((item) => (item.assetId === image.assetId ? { ...item, alt: event.target.value } : item)))
                      onAltEdited(image.assetId)
                    }}
                    slotProps={{ htmlInput: { maxLength: LIMITS.altText } }}
                  />
                  <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap', gap: 1 }}>
                    <Button
                      size="small"
                      ref={(element) => { buttons.current.set(`${image.assetId}:up`, element) }}
                      disabled={disabled || index === 0}
                      onClick={() => reorder(index, index - 1, 'up')}
                      aria-label={`Move ${label} up`}
                    >
                      Move up
                    </Button>
                    <Button
                      size="small"
                      ref={(element) => { buttons.current.set(`${image.assetId}:down`, element) }}
                      disabled={disabled || index === images.length - 1}
                      onClick={() => reorder(index, index + 1, 'down')}
                      aria-label={`Move ${label} down`}
                    >
                      Move down
                    </Button>
                    {index > 0 ? (
                      <Button size="small" disabled={disabled} onClick={() => reorder(index, 0)} aria-label={`Make ${label} the cover`}>
                        Make cover
                      </Button>
                    ) : null}
                    <Button size="small" color="error" disabled={disabled} onClick={() => remove(index)} aria-label={`Remove ${label}`}>
                      Remove
                    </Button>
                  </Stack>
                </Box>
              </Stack>
            )
          })}
        </Box>
      ) : null}

      {disabled ? null : full ? (
        <Typography variant="body2" color="text.secondary">
          This product has {LIMITS.images} images, the most it can have. Remove one to add another.
        </Typography>
      ) : (
        <ImageUploader
          kind="product_image"
          label="Add images"
          multiple
          onUploaded={(asset) => {
            const current = latest.current
            if (current.some((image) => image.assetId === asset.id) || current.length >= LIMITS.images) return
            const next = [...current, { assetId: asset.id, url: asset.url, alt: '' }]
            latest.current = next
            onChange(next)
          }}
        />
      )}

      <Box role="status" aria-live="polite" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>
        {announcement}
      </Box>
    </Box>
  )
}
