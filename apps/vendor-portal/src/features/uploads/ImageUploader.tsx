import { Box, Button, FormHelperText, LinearProgress, Stack, Typography } from '@mui/material'
import { useId, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { SafeImage } from '../../security/SafeImage'
import { acceptedMessage, ALLOWED_CONTENT_TYPES, DEFAULT_MAX_BYTES, type AssetKind, type AssetOut } from '../../api/uploads/rules'
import { useImageUploads, type UploadItem, type UseImageUploadsOptions } from './useImageUploads'

const KIND_LABEL: Record<AssetKind, string> = {
  brand_logo: 'logo',
  brand_banner: 'banner',
  product_image: 'image',
}

interface Props {
  kind: AssetKind
  /** What the vendor is choosing, for example "Brand logo". */
  label: string
  /** Several files at once (product images). Otherwise a new file replaces the old one. */
  multiple?: boolean
  /** An image that is already saved (a logo from the draft), shown until a new one is chosen. */
  currentUrl?: string | null
  /** Called with each uploaded and registered image: use `asset.id` to attach it to the page or product. */
  onUploaded: (asset: AssetOut, file: File) => void
  helperText?: string
  /** Replaces the network steps; for tests. */
  deps?: UseImageUploadsOptions['deps']
}

function statusText(item: UploadItem): string {
  switch (item.status) {
    case 'queued':
      return 'Waiting…'
    case 'signing':
      return 'Getting ready…'
    case 'uploading':
      return `Uploading… ${Math.round(item.progress * 100)}%`
    case 'registering':
      return 'Saving…'
    case 'ready':
      return 'Uploaded'
    case 'cancelled':
      return 'Cancelled'
    case 'error':
      return 'Not uploaded'
  }
}

/** The part of progress a screen reader hears: at the start, each quarter and the end. */
function announcement(item: UploadItem): string {
  if (item.status === 'uploading') return `${item.file.name}: ${Math.floor((item.progress * 100) / 25) * 25}% uploaded`
  if (item.status === 'ready') return `${item.file.name} uploaded`
  if (item.status === 'error') return `${item.file.name} could not be uploaded`
  if (item.status === 'cancelled') return `${item.file.name} upload cancelled`
  return ''
}

function Row({ item, errorId, onCancel, onRetry, onRemove }: { item: UploadItem; errorId: string; onCancel: () => void; onRetry: () => void; onRemove: () => void }) {
  const busy = item.status === 'queued' || item.status === 'signing' || item.status === 'uploading' || item.status === 'registering'
  return (
    <Stack component="li" direction="row" spacing={2} sx={{ alignItems: 'center', py: 1, listStyle: 'none' }}>
      <Box sx={{ width: 56, height: 56, flexShrink: 0, borderRadius: 1, overflow: 'hidden', bgcolor: 'action.hover' }}>
        {item.status === 'ready' && item.asset ? (
          // Once saved, the picture comes from the image host, through the safe image component.
          <SafeImage src={item.asset.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <img src={item.previewUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
      </Box>
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography noWrap variant="body2" title={item.file.name}>
          {item.file.name}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {statusText(item)}
        </Typography>
        {item.status === 'uploading' || item.status === 'signing' || item.status === 'registering' ? (
          <LinearProgress
            variant={item.status === 'uploading' ? 'determinate' : 'indeterminate'}
            value={Math.round(item.progress * 100)}
            aria-label={`Uploading ${item.file.name}`}
            sx={{ mt: 0.5 }}
          />
        ) : null}
        {item.error ? (
          <FormHelperText error id={errorId} role="alert">
            {item.error}
          </FormHelperText>
        ) : null}
      </Box>
      <Stack direction="row" spacing={1}>
        {busy ? (
          <Button size="small" onClick={onCancel} aria-label={`Cancel upload of ${item.file.name}`}>
            Cancel
          </Button>
        ) : null}
        {item.status === 'error' && item.canRetry ? (
          <Button size="small" onClick={onRetry} aria-label={`Try again: ${item.file.name}`}>
            Try again
          </Button>
        ) : null}
        {!busy ? (
          <Button size="small" onClick={onRemove} aria-label={`Remove ${item.file.name} from the list`}>
            Remove
          </Button>
        ) : null}
      </Stack>
    </Stack>
  )
}

/**
 * Chooses and uploads images of one kind. The file is checked (type and size) before anything is
 * sent, then uploaded straight to the image host with progress, cancel and retry. A real button
 * opens the file chooser (files can also be dropped on the box); progress and errors are announced.
 */
export function ImageUploader({ kind, label, multiple = false, currentUrl, onUploaded, helperText, deps }: Props) {
  const { items, add, cancel, retry, remove } = useImageUploads(kind, {
    maxFiles: multiple ? undefined : 1,
    onUploaded,
    deps,
  })
  const input = useRef<HTMLInputElement>(null)
  const labelId = useId()
  const hintId = useId()
  const liveId = useId()
  const [dragging, setDragging] = useState(false)
  const hint = helperText ?? `${acceptedMessage(ALLOWED_CONTENT_TYPES, DEFAULT_MAX_BYTES)}.`

  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    add(Array.from(event.target.files ?? []))
    // Allow choosing the same file again after removing it.
    event.target.value = ''
  }
  const drop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    add(Array.from(event.dataTransfer.files))
  }

  const errorIdFor = (item: UploadItem) => `${hintId}-error-${item.id}`
  const errors = items.filter((item) => item.error)
  const live = items.map(announcement).filter(Boolean).join('. ')
  const showCurrent = Boolean(currentUrl) && items.length === 0
  const kindLabel = KIND_LABEL[kind]

  return (
    <Box role="group" aria-labelledby={labelId}>
      <Typography id={labelId} component="h2" variant="subtitle1" gutterBottom>
        {label}
      </Typography>
      <Box
        onDragOver={(event: DragEvent) => { event.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
        sx={{
          border: 2,
          borderStyle: 'dashed',
          borderColor: dragging ? 'primary.main' : 'divider',
          borderRadius: 1,
          p: 2,
          textAlign: 'center',
        }}
      >
        {showCurrent ? (
          <Box sx={{ mb: 2 }}>
            <SafeImage src={currentUrl} alt={`Current ${kindLabel}`} style={{ maxWidth: '100%', maxHeight: 160, objectFit: 'contain' }} />
          </Box>
        ) : null}
        <Button variant="outlined" onClick={() => input.current?.click()} aria-describedby={[hintId, ...errors.map(errorIdFor)].join(' ')}>
          {multiple ? 'Choose images' : items.length > 0 || showCurrent ? `Choose a different ${kindLabel}` : `Choose a ${kindLabel}`}
        </Button>
        <input
          ref={input}
          type="file"
          hidden
          multiple={multiple}
          accept={ALLOWED_CONTENT_TYPES.join(',')}
          aria-label={`${label}: choose ${multiple ? 'files' : 'a file'}`}
          onChange={choose}
        />
        <Typography id={hintId} variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {hint} {multiple ? 'You can also drop images here.' : 'You can also drop an image here.'}
        </Typography>
      </Box>

      {items.length > 0 ? (
        <Box component="ul" sx={{ p: 0, m: 0, mt: 1 }}>
          {items.map((item) => (
            <Row key={item.id} item={item} errorId={errorIdFor(item)} onCancel={() => cancel(item.id)} onRetry={() => retry(item.id)} onRemove={() => remove(item.id)} />
          ))}
        </Box>
      ) : null}

      {/* What a screen reader hears: progress by quarters, then the outcome. */}
      <Box id={liveId} role="status" aria-live="polite" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>
        {live}
      </Box>
    </Box>
  )
}
