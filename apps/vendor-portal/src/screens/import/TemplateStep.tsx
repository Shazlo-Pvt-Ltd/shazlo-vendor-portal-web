import { Box, Button, DialogActions, DialogContent, Stack, Typography } from '@mui/material'
import { Banner, brand, fontFamily, neutral, radius, useSnackbar } from '@shazlo/ui'
import { Download } from 'lucide-react'
import { useId } from 'react'
import { useImportTemplate } from '../../api/queries'
import { importCopy } from '../../copy/import'
import { saveFile } from './download'
import { actionsSx } from './layout'

const copy = importCopy.template

export function ColumnGuide() {
  const headingId = useId()
  return (
    <Box>
      <Typography id={headingId} variant="h3" component="h3" sx={{ mb: 1 }}>
        {copy.columnsTitle}
      </Typography>
      <Box
        component="ul"
        role="list"
        aria-labelledby={headingId}
        sx={{ listStyle: 'none', p: 0, m: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, columnGap: 4, borderTop: `1px solid ${neutral.line}` }}
      >
        {copy.columns.map((column) => (
          <Box component="li" key={column.name} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 2, py: 1, borderBottom: `1px solid ${neutral.line}` }}>
            <Typography variant="body1" component="span">
              {column.name}
            </Typography>
            {column.note && (
              <Typography variant="caption" component="span" color="text.secondary" sx={{ textAlign: 'right' }}>
                {column.note}
              </Typography>
            )}
          </Box>
        ))}
      </Box>
    </Box>
  )
}

// Step 1: what the template holds, and the template itself.
export function TemplateStep({ onNext }: { onNext: () => void }) {
  const template = useImportTemplate()
  const notify = useSnackbar()

  const download = async () => {
    try {
      saveFile(await template.mutateAsync(), copy.fileName)
      notify(copy.downloaded)
      onNext()
    } catch {
      // The banner below says what happened.
    }
  }

  return (
    <>
      <DialogContent>
        <Stack spacing={3}>
          <Typography variant="body1" color="text.secondary" sx={{ maxWidth: '68ch' }}>
            {copy.intro}
          </Typography>
          <ColumnGuide />
          <Box sx={{ bgcolor: brand.cream, borderRadius: `${radius.card}px`, px: 2, py: 1.5 }}>
            <Typography variant="body1">
              <Box component="span" sx={{ fontFamily: fontFamily.display }}>
                {copy.sizesLabel}
              </Box>{' '}
              {copy.sizesNote}
            </Typography>
          </Box>
          {template.isError && <Banner tone="error" title={copy.downloadFailed} />}
        </Stack>
      </DialogContent>
      <DialogActions sx={actionsSx}>
        <Button variant="outlined" onClick={onNext}>
          {copy.haveFile}
        </Button>
        <Button variant="contained" onClick={() => void download()} disabled={template.isPending} startIcon={<Download size={18} strokeWidth={1.5} aria-hidden="true" />}>
          {template.isPending ? copy.downloading : copy.download}
        </Button>
      </DialogActions>
    </>
  )
}
