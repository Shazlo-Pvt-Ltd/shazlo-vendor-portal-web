import { Box, Button, DialogActions, DialogContent, Stack, Typography } from '@mui/material'
import { Banner, emphasis, garmentColour, neutral, radius } from '@shazlo/ui'
import { Download } from 'lucide-react'
import { useId } from 'react'
import type { Schemas } from '../../api/model'
import { useImportTemplate } from '../../api/queries'
import { ColourList } from '../../components/ColourSwatch'
import { catalogCopy } from '../../copy/catalog'
import { importCopy } from '../../copy/import'
import { IMPORT_COLUMNS, OPTIONAL_IMPORT_COLUMNS } from '../../lib/catalog'
import { saveFile } from './download'
import { actionsSx } from './layout'

const copy = importCopy.template
const COLOUR_COLUMNS: readonly Schemas['ImportColumn'][] = ['main_colour', 'other_colours']
// A lead-in label in the display face's real semibold, at the line's own size.
const DISPLAY_FACE = emphasis.semibold

// The 10 template columns (PDF §4), each with whether it is needed and the example row's value.
export function ColumnGuide() {
  const headingId = useId()
  return (
    <Box>
      <Typography id={headingId} variant="h3" component="h3" sx={{ mb: 0.5 }}>
        {copy.columnsTitle}
      </Typography>
      <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
        {copy.exampleTitle}: {copy.example.product_name}
      </Typography>
      <Box component="ul" role="list" aria-labelledby={headingId} sx={{ listStyle: 'none', p: 0, m: 0, borderTop: `1px solid ${neutral.line}` }}>
        {IMPORT_COLUMNS.map((column) => (
          <Box
            component="li"
            key={column}
            sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr auto', sm: 'minmax(0, 1fr) minmax(0, 1.4fr) auto' }, columnGap: 2, rowGap: 0.25, alignItems: 'baseline', py: 1, borderBottom: `1px solid ${neutral.line}` }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle1" component="span">
                {catalogCopy.importColumns[column]}
              </Typography>
              <Typography variant="mono" component="span" color="textSecondary" sx={{ display: 'block' }}>
                {column}
              </Typography>
            </Box>
            <Typography variant="body2" component="span" color="textSecondary" sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' }, gridRow: { xs: 2, sm: 'auto' }, overflowWrap: 'anywhere' }}>
              {COLOUR_COLUMNS.includes(column) ? <ColourList values={copy.example[column].split(',').map((c) => c.trim()).filter(Boolean)} size={12} /> : copy.example[column]}
            </Typography>
            <Typography variant="caption" component="span" color="textSecondary" sx={{ textAlign: 'right', gridRow: { xs: 1, sm: 'auto' }, gridColumn: { xs: 2, sm: 'auto' } }}>
              {OPTIONAL_IMPORT_COLUMNS.includes(column) ? copy.optional : copy.required}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

// Step 1: what the template holds, and the template itself.
export function TemplateStep({ onNext }: { onNext: (downloaded: boolean) => void }) {
  const template = useImportTemplate()

  const download = async () => {
    try {
      saveFile(await template.mutateAsync(), copy.fileName)
      onNext(true)
    } catch {
      // The banner below says what happened.
    }
  }

  return (
    <>
      <DialogContent>
        <Stack spacing={3}>
          <Typography variant="body1" color="textSecondary" sx={{ maxWidth: '68ch' }}>
            {copy.intro}
          </Typography>
          <ColumnGuide />
          <Box sx={{ bgcolor: neutral.canvas, border: `1px solid ${neutral.line}`, borderRadius: `${radius.card}px`, px: 2, py: 1.5 }}>
            <Typography variant="body1">
              <Box component="span" sx={DISPLAY_FACE}>
                {copy.coloursLabel}
              </Box>{' '}
              {copy.coloursNote(garmentColour.Rust)}
            </Typography>
            <Typography variant="body1" sx={{ mt: 1 }}>
              <Box component="span" sx={DISPLAY_FACE}>
                {copy.sizesLabel}
              </Box>{' '}
              {copy.sizesNote}
            </Typography>
            <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
              {copy.photosNote}
            </Typography>
          </Box>
          {template.isError && <Banner tone="error" title={copy.downloadFailed} />}
        </Stack>
      </DialogContent>
      <DialogActions sx={actionsSx}>
        <Button variant="outlined" onClick={() => onNext(false)}>
          {copy.haveFile}
        </Button>
        <Button variant="contained" onClick={() => void download()} disabled={template.isPending} startIcon={<Download size={18} strokeWidth={1.75} aria-hidden="true" />}>
          {template.isPending ? copy.downloading : copy.download}
        </Button>
      </DialogActions>
    </>
  )
}
