import { Box, Button, DialogActions, DialogContent, LinearProgress, Stack, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { brand, neutral, radius, status } from '@shazlo/ui'
import { AlertTriangle, FileSpreadsheet } from 'lucide-react'
import { useRef, useState, type DragEvent } from 'react'
import { importCopy } from '../../copy/import'
import { actionsSx } from './layout'

const copy = importCopy.upload

// Step 2: a drop zone with a real button for keyboards and phones. While a file uploads or is
// checked, the zone shows progress instead; server refusals (413, 415) are shown inside it.
export function UploadStep({ busy, error, onFile, onBack }: { busy: string | null; error: string | null; onFile: (file: File) => void; onBack: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setOver(false)
    const file = event.dataTransfer.files[0]
    if (file && !busy) onFile(file)
  }

  return (
    <>
      <DialogContent>
        <Box
          data-dropzone=""
          onDragOver={(event) => {
            event.preventDefault()
            if (!over) setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
          sx={{
            display: 'grid',
            justifyItems: 'center',
            gap: 1.5,
            textAlign: 'center',
            px: { xs: 2, sm: 4 },
            py: { xs: 4, sm: 6 },
            border: `1.5px dashed ${over ? brand.brown : neutral.lineStrong}`,
            borderRadius: `${radius.card}px`,
            bgcolor: over ? alpha(brand.cream, 0.45) : neutral.canvas,
          }}
        >
          <Box sx={{ color: brand.brown, display: 'flex' }}>
            <FileSpreadsheet size={32} strokeWidth={1.25} aria-hidden="true" />
          </Box>
          {busy ? (
            <Box role="status" sx={{ width: '100%', maxWidth: 360 }}>
              <Typography variant="body1">{busy}</Typography>
              <LinearProgress aria-label={busy} sx={{ my: 1.5, height: 3 }} />
              <Typography variant="caption" color="text.secondary">
                {copy.checkingHint}
              </Typography>
            </Box>
          ) : (
            <>
              <Typography variant="body1" sx={{ maxWidth: '46ch' }}>
                {copy.drop}{' '}
                <Button
                  variant="text"
                  onClick={() => input.current?.click()}
                  sx={{ p: 0, minWidth: 0, minHeight: 0, verticalAlign: 'baseline', font: 'inherit', color: 'info.main', textDecoration: 'underline', textUnderlineOffset: '0.18em' }}
                >
                  {copy.choose}
                </Button>
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {copy.hint}
              </Typography>
            </>
          )}
          {error && !busy && (
            <Stack role="alert" direction="row" spacing={1} sx={{ alignItems: 'flex-start', color: status.error, textAlign: 'left', maxWidth: '52ch' }}>
              <Box sx={{ display: 'flex', pt: '2px', flexShrink: 0 }}>
                <AlertTriangle size={16} strokeWidth={1.75} aria-hidden="true" />
              </Box>
              <Typography variant="body2">{error}</Typography>
            </Stack>
          )}
          <input
            ref={input}
            type="file"
            accept={copy.accept}
            hidden
            aria-label={copy.inputLabel}
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) onFile(file)
            }}
          />
        </Box>
      </DialogContent>
      <DialogActions sx={{ ...actionsSx, justifyContent: 'flex-start' }}>
        <Button variant="text" onClick={onBack} disabled={busy !== null}>
          {copy.back}
        </Button>
      </DialogActions>
    </>
  )
}
