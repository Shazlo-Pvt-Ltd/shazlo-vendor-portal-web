import { Box, Button, DialogActions, DialogContent, MenuItem, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { Banner, brand, neutral, radius, StatFigure, status } from '@shazlo/ui'
import { AlertTriangle, Download, FileSpreadsheet } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import type { Schemas } from '../../api/model'
import { importCopy } from '../../copy/import'
import { formatCount } from '../../lib/format'
import { saveFile } from './download'
import { actionsSx } from './layout'
import { errorColumns, errorReportCsv, errorReportName, filterErrors, type ErrorFilter } from './rules'

const copy = importCopy.review
type Job = Schemas['ImportJob']
type RowError = Job['errors'][number]

const tabular = { fontVariantNumeric: 'tabular-nums' } as const
/** Problems shown at once; the report has them all. */
export const ERRORS_PAGE = 25

function FileCard({ name, rows, onReplace }: { name: string; rows: number; onReplace: () => void }) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', p: 1.5, border: `1px solid ${neutral.line}`, borderRadius: `${radius.card}px`, bgcolor: neutral.canvas }}>
      <Box sx={{ color: brand.brown, display: 'flex', flexShrink: 0 }}>
        <FileSpreadsheet size={20} strokeWidth={1.75} aria-hidden="true" />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body1" noWrap title={name}>
          {name}
        </Typography>
        <Typography variant="caption" color="textSecondary" sx={tabular}>
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
        <AlertTriangle size={16} strokeWidth={1.75} aria-hidden="true" />
      </Box>
      <span>{message}</span>
    </Stack>
  )
}

// The rows to fix (main's errors table in Build 2's design): a column filter and a search, pages of
// 25, and the whole list as a CSV. A table on desktop, a list on phones (no sideways scrolling).
function ErrorRows({ errors, title, wide, fileName, truncated }: { errors: RowError[]; title: string; wide: boolean; fileName: string; truncated: boolean }) {
  const titleId = useId()
  const [filter, setFilter] = useState<ErrorFilter>({ column: '', query: '' })
  const [page, setPage] = useState(0)
  const columns = useMemo(() => errorColumns(errors), [errors])
  const shown = useMemo(() => filterErrors(errors, filter), [errors, filter])
  const last = Math.max(0, Math.ceil(shown.length / ERRORS_PAGE) - 1)
  const current = Math.min(page, last)
  const visible = shown.slice(current * ERRORS_PAGE, (current + 1) * ERRORS_PAGE)
  const update = (next: Partial<ErrorFilter>) => {
    setFilter((old) => ({ ...old, ...next }))
    setPage(0)
  }
  const product = (e: RowError) => e.product ?? copy.noProduct

  return (
    <Box>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1, flexWrap: 'wrap', rowGap: 1 }}>
        <Typography id={titleId} variant="h3" component="h3">
          {title}
        </Typography>
        <Button variant="text" size="small" onClick={() => saveFile(errorReportCsv(errors), errorReportName(fileName))} startIcon={<Download size={16} strokeWidth={1.75} aria-hidden="true" />}>
          {copy.downloadReport}
        </Button>
      </Stack>
      {truncated && (
        <Box sx={{ mb: 1.5 }}>
          <Banner tone="warning" title={copy.truncated(errors.length)} />
        </Box>
      )}
      {errors.length > ERRORS_PAGE / 5 && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 1.5 }}>
          <TextField select size="small" label={copy.filter.column} value={filter.column} onChange={(event) => update({ column: event.target.value })} sx={{ minWidth: 200 }} slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}>
            <MenuItem value="">{copy.filter.all}</MenuItem>
            {columns.map((column) => (
              <MenuItem key={column} value={column}>
                {column}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label={copy.filter.search}
            value={filter.query}
            onChange={(event) => update({ query: event.target.value })}
            helperText={copy.filter.searchHint}
            sx={{ flexGrow: 1 }}
            slotProps={{ htmlInput: { enterKeyHint: 'search', autoComplete: 'off', maxLength: 100 } }}
          />
        </Stack>
      )}
      <Typography variant="body2" color="textSecondary" role="status" sx={{ mb: 1, ...tabular }}>
        {copy.shown(shown.length, errors.length)}
      </Typography>
      {shown.length === 0 ? (
        <Typography variant="body2">{copy.noMatch}</Typography>
      ) : wide ? (
        <TableContainer sx={{ maxHeight: 360, border: `1px solid ${neutral.line}`, borderRadius: `${radius.card}px` }}>
          <Table stickyHeader size="small" aria-labelledby={titleId}>
            <TableHead>
              <TableRow>
                {(['row', 'product', 'column', 'fix'] as const).map((key) => (
                  <TableCell key={key} align={key === 'row' ? 'right' : 'left'} sx={{ typography: 'subtitle2', color: 'text.secondary', bgcolor: neutral.surface, width: key === 'row' ? 64 : key === 'fix' ? undefined : 180 }}>
                    {copy.columns[key]}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {visible.map((e, i) => (
                <TableRow key={`${e.row}-${e.column}-${i}`} sx={{ verticalAlign: 'top', '&:last-of-type td': { borderBottom: 0 } }}>
                  <TableCell align="right" sx={tabular}>
                    {formatCount(e.row)}
                  </TableCell>
                  <TableCell sx={{ overflowWrap: 'anywhere' }}>{product(e)}</TableCell>
                  <TableCell>{e.column}</TableCell>
                  <TableCell sx={{ overflowWrap: 'anywhere' }}>
                    <Fix message={e.message} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : (
        <Box component="ul" role="list" aria-labelledby={titleId} sx={{ listStyle: 'none', p: 0, m: 0, borderTop: `1px solid ${neutral.line}` }}>
          {visible.map((e, i) => (
            <Box component="li" key={`${e.row}-${e.column}-${i}`} sx={{ py: 1.5, borderBottom: `1px solid ${neutral.line}` }}>
              <Typography variant="caption" color="textSecondary" component="div" sx={tabular}>
                {copy.rowLabel(e.row)} · {e.column}
              </Typography>
              <Typography variant="body1" sx={{ overflowWrap: 'anywhere' }}>
                {product(e)}
              </Typography>
              <Typography variant="body2" component="div" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>
                <Fix message={e.message} />
              </Typography>
            </Box>
          ))}
        </Box>
      )}
      {shown.length > ERRORS_PAGE && (
        <Stack component="nav" aria-label={copy.pages} direction="row" spacing={1.5} sx={{ alignItems: 'center', justifyContent: 'space-between', pt: 1.5 }}>
          <Typography variant="body2" color="textSecondary" sx={tabular}>
            {copy.page(current * ERRORS_PAGE + 1, current * ERRORS_PAGE + visible.length, shown.length)}
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" size="small" disabled={current === 0} onClick={() => setPage(current - 1)} sx={{ minHeight: { xs: 44, md: 32 } }}>
              {copy.previous}
            </Button>
            <Button variant="outlined" size="small" disabled={current >= last} onClick={() => setPage(current + 1)} sx={{ minHeight: { xs: 44, md: 32 } }}>
              {copy.next}
            </Button>
          </Stack>
        </Stack>
      )}
    </Box>
  )
}

// Step 3: what the check found (nothing has been made yet), and saving the rows that passed as drafts.
export function ReviewStep({ job, wide, creating, createError, onReplace, onCreate }: { job: Job; wide: boolean; creating: boolean; createError: string | null; onReplace: () => void; onCreate: () => void }) {
  const allClear = job.errors.length === 0
  // One row is one product.
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
              <Box role="group" aria-label={copy.statsLabel} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, 1fr)' }, gap: 1.5 }}>
                <StatFigure label={copy.stats.total} value={formatCount(job.total_rows)} />
                <StatFigure label={copy.stats.ok} value={formatCount(job.ok_rows)} baseline={copy.stats.okBaseline} />
                <StatFigure label={copy.stats.errors} value={formatCount(job.error_rows)} baseline={copy.stats.errorsBaseline} />
              </Box>
              <ErrorRows errors={job.errors} title={copy.errorsTitle(job.error_rows)} wide={wide} fileName={job.file_name} truncated={job.errors_truncated} />
            </>
          )}
          {job.unchanged > 0 && (
            <Typography variant="body2" color="textSecondary">
              {copy.unchanged(job.unchanged)}
            </Typography>
          )}
          {job.ignored_columns.length > 0 && <Banner tone="info" title={copy.ignored(job.ignored_columns.join(', '))} />}
          {createError && (
            <Banner tone="error" title={copy.createFailed}>
              {createError}
            </Banner>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ ...actionsSx, flexDirection: { xs: 'column', md: 'row' }, alignItems: { xs: 'stretch', md: 'center' } }}>
        <Typography variant="body2" color="textSecondary" sx={{ flex: 1, minWidth: 0, mr: { md: 2 } }}>
          {ready > 0 ? copy.footer(ready) : allClear && job.unchanged > 0 ? copy.alreadyThere : copy.nothingReady}
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
