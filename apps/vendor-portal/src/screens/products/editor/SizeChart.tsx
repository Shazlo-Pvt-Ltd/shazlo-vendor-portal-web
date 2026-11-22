import { Box, Button, LinearProgress, Stack, TextField, Typography } from '@mui/material'
import { neutral, radius, status } from '@shazlo/ui'
import { ChevronDown, ImagePlus, Trash2 } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { ApiError } from '../../../api/errors'
import type { Schemas } from '../../../api/model'
import { useSaveSizeChart, useSizeChart, useUploadImage } from '../../../api/queries'
import { catalogCopy } from '../../../copy/catalog'
import { productEditorCopy } from '../../../copy/productEditor'
import { isValidMeasurement, MEASUREMENTS, productTypesInGroup, sizeChartGroupFor, sortSizes, type ProductType, type SizeChartGroup } from '../../../lib/catalog'
import { ImageReadError, prepareImage } from '../../../lib/imageResize'
import { SafeImage } from '../../../security/SafeImage'

const copy = productEditorCopy.sizeChart
const labels = catalogCopy.sizeChart

type Chart = Schemas['SizeChart']
type Texts = Record<string, Record<string, string>>

const cellKey = (size: string, measurement: string) => `${size}.${measurement}`

function textsOf(measurements: Chart['measurements']): Texts {
  return Object.fromEntries(Object.entries(measurements).map(([size, row]) => [size, Object.fromEntries(Object.entries(row).map(([m, v]) => [m, v == null ? '' : String(v)]))]))
}

// The brand's chart for one group, edited for the sizes this product has. Saving keeps the other
// sizes already in the chart, since every product of the group shares it.
function ChartForm({ group, chart, sizes, readOnly }: { group: SizeChartGroup; chart: Chart; sizes: readonly string[]; readOnly: boolean }) {
  const measurements = MEASUREMENTS[group]
  const [texts, setTexts] = useState<Texts>(() => textsOf(chart.measurements))
  const [photoUrl, setPhotoUrl] = useState(chart.photo_url)
  const [invalid, setInvalid] = useState<Record<string, string>>({})
  const [result, setResult] = useState<{ tone: 'saved' | 'error'; text: string } | null>(null)
  const [photo, setPhoto] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null })
  const save = useSaveSizeChart(group)
  const upload = useUploadImage()
  const fixId = useId()
  const prefix = useId()
  const photoInput = useRef<HTMLInputElement>(null)
  const rows = sortSizes(sizes, (s) => s)

  const edit = (size: string, measurement: string, text: string) => {
    setResult(null)
    setTexts((t) => ({ ...t, [size]: { ...t[size], [measurement]: text } }))
    setInvalid(({ [cellKey(size, measurement)]: _fixed, ...rest }) => rest)
  }

  async function onPhoto(file: File | undefined) {
    if (!file) return
    setResult(null)
    setPhoto({ busy: true, error: null })
    try {
      const { url } = await upload.mutateAsync({ file: await prepareImage(file), purpose: 'size_chart' })
      setPhotoUrl(url)
      setPhoto({ busy: false, error: null })
    } catch (error) {
      setPhoto({ busy: false, error: error instanceof ImageReadError ? productEditorCopy.photos.unreadable : error instanceof Error ? error.message : '' })
    }
  }

  async function onSave() {
    setResult(null)
    const problems: Record<string, string> = {}
    const out: Chart['measurements'] = { ...chart.measurements }
    for (const size of rows) {
      const row: Record<string, number | null> = {}
      for (const m of measurements) {
        const text = texts[size]?.[m]?.trim() ?? ''
        if (!text) {
          row[m] = null
          continue
        }
        const value = Number(text.replace(',', '.'))
        if (isValidMeasurement(value)) row[m] = value
        else problems[cellKey(size, m)] = catalogCopy.errors.sizeChart.value
      }
      out[size] = row
    }
    if (Object.keys(problems).length) {
      setInvalid(problems)
      document.getElementById(`${prefix}-${Object.keys(problems)[0]}`)?.focus()
      return
    }
    try {
      await save.mutateAsync({ measurements: out, photo_url: photoUrl })
      setResult({ tone: 'saved', text: copy.saved })
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        setInvalid(Object.fromEntries(Object.entries(error.fields).map(([key, message]) => [key.replace(/^measurements\./, ''), message])))
      }
      setResult({ tone: 'error', text: error instanceof Error ? error.message : copy.fix })
    }
  }

  const fixMessage = Object.values(invalid)[0]

  return (
    <Stack spacing={2.5} sx={{ mt: 1.5 }}>
      <Box>
        <Typography variant="body1">{labels.usedFor(productTypesInGroup(group).map((t) => catalogCopy.productTypes[t]))}</Typography>
        <Typography variant="body2" color="textSecondary" sx={{ mt: 0.5 }}>
          {copy.intro}
        </Typography>
      </Box>

      {rows.length === 0 ? (
        <Typography variant="body2" color="textSecondary">
          {copy.noSizes}
        </Typography>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: `44px repeat(${measurements.length}, minmax(0, 1fr))`, gap: 0.75, alignItems: 'center' }}>
          <Typography variant="caption" color="textSecondary">
            {copy.size}
          </Typography>
          {measurements.map((m) => (
            <Typography key={m} variant="caption" color="textSecondary" noWrap>
              {`${labels.measurements[m]} (${labels.unit})`}
            </Typography>
          ))}
          {rows.map((size) => [
            <Typography key={size} variant="body2">
              {size}
            </Typography>,
            ...measurements.map((m) => {
              const key = cellKey(size, m)
              return (
                <TextField
                  key={key}
                  size="small"
                  value={texts[size]?.[m] ?? ''}
                  onChange={(event) => edit(size, m, event.target.value.replace(/[^\d.,]/g, '').slice(0, 5))}
                  error={Boolean(invalid[key])}
                  slotProps={{
                    input: { readOnly },
                    htmlInput: { id: `${prefix}-${key}`, 'aria-label': copy.cell(labels.measurements[m], size), 'aria-describedby': invalid[key] ? fixId : undefined, inputMode: 'decimal', autoComplete: 'off', style: { textAlign: 'center', fontVariantNumeric: 'tabular-nums' } },
                  }}
                />
              )
            }),
          ])}
        </Box>
      )}
      {fixMessage && (
        <Typography id={fixId} variant="body2" sx={{ color: status.error }}>
          {`${copy.fix} ${fixMessage}`}
        </Typography>
      )}

      <Box>
        <Typography variant="body1" sx={{ mb: 1 }}>
          {copy.photoTitle}
        </Typography>
        {photoUrl && (
          <Box sx={{ '& > img': { display: 'block', maxWidth: 200, maxHeight: 240, objectFit: 'contain', borderRadius: `${radius.card}px`, border: `1px solid ${neutral.line}`, mb: 1 } }}>
            <SafeImage src={photoUrl} alt={copy.photoAlt} />
          </Box>
        )}
        {photo.busy && (
          <Box role="status" sx={{ maxWidth: 200, mb: 1 }}>
            <Typography variant="caption">{copy.photoUploading}</Typography>
            <LinearProgress aria-label={copy.photoUploading} sx={{ height: 3, mt: 0.5 }} />
          </Box>
        )}
        {photo.error && (
          <Typography role="alert" variant="body2" sx={{ color: status.error, mb: 1 }}>
            {photo.error}
          </Typography>
        )}
        {!readOnly && (
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            <Button variant="outlined" disabled={photo.busy} onClick={() => photoInput.current?.click()} startIcon={<ImagePlus size={18} strokeWidth={1.75} aria-hidden="true" />} sx={{ minHeight: 44 }}>
              {photoUrl ? copy.replacePhoto : copy.addPhoto}
            </Button>
            {photoUrl && (
              <Button
                variant="text"
                color="inherit"
                onClick={() => {
                  setResult(null)
                  setPhotoUrl(null)
                }}
                startIcon={<Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />}
                sx={{ minHeight: 44 }}
              >
                {copy.removePhoto}
              </Button>
            )}
            <input
              ref={photoInput}
              type="file"
              hidden
              accept="image/*"
              aria-label={copy.photoInput}
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                void onPhoto(file)
              }}
            />
          </Stack>
        )}
      </Box>

      {!readOnly && (
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
          <Button variant="outlined" onClick={() => void onSave()} disabled={save.isPending || photo.busy} sx={{ minHeight: 44 }}>
            {save.isPending ? copy.saving : copy.save}
          </Button>
          <Typography role={result?.tone === 'error' ? 'alert' : 'status'} variant="body2" sx={{ color: result?.tone === 'error' ? status.error : 'text.secondary' }}>
            {result?.text ?? ''}
          </Typography>
        </Stack>
      )}
    </Stack>
  )
}

function ChartPanel({ group, sizes, readOnly }: { group: SizeChartGroup; sizes: readonly string[]; readOnly: boolean }) {
  const chart = useSizeChart(group)
  if (chart.isPending) {
    return (
      <Box role="status" aria-label={productEditorCopy.loading} sx={{ py: 2 }}>
        <LinearProgress sx={{ height: 3, maxWidth: 240 }} />
      </Box>
    )
  }
  if (chart.isError) {
    return (
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', py: 1 }}>
        <Typography role="alert" variant="body2" sx={{ color: status.error }}>
          {chart.error.message}
        </Typography>
        <Button onClick={() => void chart.refetch()}>{productEditorCopy.banners.retry}</Button>
      </Stack>
    )
  }
  return <ChartForm key={group} group={group} chart={chart.data} sizes={sizes} readOnly={readOnly} />
}

// Size chart (optional), closed until tapped. Product types without a chart (sarees, dupattas,
// stoles) and products with no type yet show nothing.
export function SizeChart({ category, sizes, readOnly }: { category: ProductType | null; sizes: readonly string[]; readOnly: boolean }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const group = sizeChartGroupFor(category)
  if (!group) return null
  return (
    <Box sx={{ mt: 3, pt: 1.5, borderTop: `1px solid ${neutral.line}` }}>
      <Button
        variant="text"
        color="inherit"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        endIcon={<ChevronDown size={18} strokeWidth={1.75} aria-hidden="true" style={{ transform: open ? 'rotate(180deg)' : 'none' }} />}
        sx={{ minHeight: 44, ml: -1, typography: 'body1' }}
      >
        {copy.toggle}
      </Button>
      <Box id={panelId} hidden={!open}>
        {open && <ChartPanel group={group} sizes={sizes} readOnly={readOnly} />}
      </Box>
    </Box>
  )
}
