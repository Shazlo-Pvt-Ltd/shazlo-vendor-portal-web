import { Box, Button, DialogActions, DialogContent, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material'
import { Banner, brand, neutral, radius, StatFigure, status } from '@shazlo/ui'
import { AlertTriangle, Download, FileSpreadsheet } from 'lucide-react'
import { useId } from 'react'
import type { Schemas } from '../../api/client'
import { importCopy } from '../../copy/import'
import { formatCount } from '../../lib/format'
import { errorReportCsv, saveFile } from './download'
import { actionsSx } from './layout'

const copy = importCopy.review
type Job = Schemas['ImportJob']
type RowError = Job['errors'][number]

const tabular = { fontVariantNumeric: 'tabular-nums' } as const

function FileCard({ name, rows, onReplace }: { name: string; rows: number; onReplace: () => void }) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', p: 1.5, border: `1px solid ${neutral.line}`, borderRadius: `${radius.card}px`, bgcolor: neutral.canvas }}>
      <Box sx={{ color: brand.brown, display: 'flex', flexShrink: 0 }}>
        <FileSpreadsheet size={20} strokeWidth={1.5} aria-hidden="true" />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body1" noWrap title={name}>
          {name}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={tabular}>
          {copy.rows(rows)}
        </Typography>
      </Box>
      <Button variant="outlined" size="small" onClick={onReplace} sx={{ flexShrink: 0, minHeight: { xs: 44, md: 32 } }}>
        {copy.replace}
      </Button>
    </Stack>
  )
}

function Fix({ message }: { message: string }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
      <Box component="span" sx={{ color: status.warning, display: 'flex', pt: '2px', flexShrink: 0 }}>
        <AlertTriangle size={16} strokeWidth={1.5} aria-hidden="true" />
      </Box>
      <span>{message}</span>
    </Stack>
  )
}

// The rows to fix: a table on desktop, a list on phones (no sideways scrolling).
function ErrorRows({ errors, title, wide }: { errors: RowError[]; title: string; wide: boolean }) {
  const titleId = useId()
  return (
    <Box>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1, flexWrap: 'wrap', rowGap: 1 }}>
        <Typography id={titleId} variant="h3" component="h3">
          {title}
        </Typography>
        <Button variant="text" size="small" onClick={() => saveFile(errorReportCsv(errors), copy.reportFileName)} startIcon={<Download size={16} strokeWidth={1.5} aria-hidden="true" />}>
          {copy.downloadReport}
        </Button>
      </Stack>
      {wide ? (
        <TableContainer sx={{ maxHeight: 320, border: `1px solid ${neutral.line}`, borderRadius: `${radius.card}px` }}>
          <Table stickyHeader size="small" aria-labelledby={titleId}>
            <TableHead>
              <TableRow>
                {(['row', 'product', 'column', 'fix'] as const).map((key) => (
                  <TableCell key={key} align={key === 'row' ? 'right' : 'left'} sx={{ typography: 'body2', color: 'text.secondary', bgcolor: neutral.surface, width: key === 'row' ? 64 : key === 'fix' ? undefined : 180 }}>
                    {copy.columns[key]}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {errors.map((e, i) => (
                <TableRow key={`${e.row}-${e.column}-${i}`} sx={{ verticalAlign: 'top', '&:last-of-type td': { borderBottom: 0 } }}>
                  <TableCell align="right" sx={tabular}>
                    {formatCount(e.row)}
                  </TableCell>
                  <TableCell sx={{ overflowWrap: 'anywhere' }}>{e.product ?? copy.noProduct}</TableCell>
                  <TableCell>{e.column}</TableCell>
                  <TableCell>
                    <Fix message={e.message} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : (
        <Box component="ul" role="list" aria-labelledby={titleId} sx={{ listStyle: 'none', p: 0, m: 0, borderTop: `1px solid ${neutral.line}` }}>
          {errors.map((e, i) => (
            <Box component="li" key={`${e.row}-${e.column}-${i}`} sx={{ py: 1.5, borderBottom: `1px solid ${neutral.line}` }}>
              <Typography variant="caption" color="text.secondary" component="div" sx={tabular}>
                {copy.rowLabel(e.row)} · {e.column}
              </Typography>
              <Typography variant="body1" sx={{ overflowWrap: 'anywhere' }}>
                {e.product ?? copy.noProduct}
              </Typography>
              <Typography variant="body2" component="div" sx={{ mt: 0.5 }}>
                <Fix message={e.message} />
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}

// Step 3: what the check found, and creating the rows that passed as drafts.
export function ReviewStep({ job, wide, creating, createError, onReplace, onCreate }: { job: Job; wide: boolean; creating: boolean; createError: string | null; onReplace: () => void; onCreate: () => void }) {
  const allClear = job.errors.length === 0
  // Rows sharing a Product ID become one product, so the button counts products, not rows.
  const ready = job.ok_products
  return (
    <>
      <DialogContent>
        <Stack spacing={3}>
          <FileCard name={job.file_name} rows={job.total_rows} onReplace={onReplace} />
          {allClear ? (
            <Banner tone="success" title={copy.allClearTitle(job.total_rows)}>
              {copy.allClearBody}
            </Banner>
          ) : (
            <>
              <Box role="group" aria-label={copy.statsLabel} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 1.5 }}>
                <StatFigure label={copy.stats.total} value={formatCount(job.total_rows)} />
                <StatFigure label={copy.stats.ok} value={formatCount(job.ok_rows)} baseline={copy.stats.okBaseline} />
                <StatFigure label={copy.stats.errors} value={formatCount(job.error_rows)} baseline={copy.stats.errorsBaseline} />
                <StatFigure label={copy.stats.images} value={formatCount(job.image_errors)} baseline={copy.stats.imagesBaseline} />
              </Box>
              <ErrorRows errors={job.errors} title={copy.errorsTitle(job.error_rows)} wide={wide} />
            </>
          )}
          {createError && (
            <Banner tone="error" title={copy.createFailed}>
              {createError}
            </Banner>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ ...actionsSx, flexDirection: { xs: 'column', md: 'row' }, alignItems: { xs: 'stretch', md: 'center' } }}>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 0, mr: { md: 2 } }}>
          {ready > 0 ? copy.footer(ready) : copy.nothingReady}
        </Typography>
        {!allClear && (
          <Button variant="outlined" onClick={onReplace}>
            {copy.uploadFixed}
          </Button>
        )}
        {ready > 0 && (
          <Button variant="contained" onClick={onCreate} disabled={creating}>
            {creating ? copy.creating : copy.create(ready)}
          </Button>
        )}
      </DialogActions>
    </>
  )
}
