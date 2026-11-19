import { Alert, Box, Button, MenuItem, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, TextField, Typography } from '@mui/material'
import { useId, useMemo, useState } from 'react'
import { saveFile } from './download'
import { errorColumns, errorReportCsv, errorReportName, filterErrors, type ErrorFilter, type RowError } from './rules'

const PAGE_SIZE = 25

interface Props {
  errors: readonly RowError[]
  truncated: boolean
  /** The spreadsheet's name, for the report's file name. */
  fileName: string
}

/**
 * Every problem the import found, by row and column, with a filter, a search and a download of the
 * whole list as a CSV (built in the browser; it holds every error the server returned, not just the
 * ones on screen).
 */
export function ErrorsTable({ errors, truncated, fileName }: Props) {
  const headingId = useId()
  const [filter, setFilter] = useState<ErrorFilter>({ column: '', query: '' })
  const [page, setPage] = useState(0)
  const columns = useMemo(() => errorColumns(errors), [errors])
  const hasRowErrors = errors.some((error) => error.column === null)
  const shown = useMemo(() => filterErrors(errors, filter), [errors, filter])
  const lastPage = Math.max(0, Math.ceil(shown.length / PAGE_SIZE) - 1)
  const current = Math.min(page, lastPage)
  const filtered = filter.column !== '' || filter.query.trim() !== ''

  const update = (next: Partial<ErrorFilter>) => {
    setFilter((old) => ({ ...old, ...next }))
    setPage(0)
  }

  return (
    <Box component="section" aria-labelledby={headingId}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, mb: 2 }}>
        <Typography id={headingId} component="h3" variant="h6">
          Problems to fix ({errors.length}
          {truncated ? '+' : ''})
        </Typography>
        <Button variant="outlined" onClick={() => saveFile(new Blob([errorReportCsv(errors)], { type: 'text/csv;charset=utf-8' }), errorReportName(fileName))}>
          Download the error report (CSV)
        </Button>
      </Stack>
      {truncated ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          There are more problems than we can list. Here are the first {errors.length}. Fix these, check the file again, and the
          rest will show.
        </Alert>
      ) : null}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
        <TextField
          select
          size="small"
          label="Column"
          value={filter.column}
          onChange={(event) => update({ column: event.target.value })}
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="">All columns</MenuItem>
          {hasRowErrors ? <MenuItem value="-">Whole row</MenuItem> : null}
          {columns.map((column) => (
            <MenuItem key={column} value={column}>
              {column}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          type="search"
          label="Search the problems"
          value={filter.query}
          onChange={(event) => update({ query: event.target.value })}
          helperText="A row number, a column or words from the message"
          sx={{ flexGrow: 1 }}
        />
      </Stack>
      <Typography variant="body2" color="text.secondary" role="status" sx={{ mb: 1 }}>
        {filtered
          ? `${shown.length} of ${errors.length} problems match.`
          : `${errors.length} ${errors.length === 1 ? 'problem' : 'problems'}.`}
      </Typography>

      <TableContainer>
        <Table size="small" aria-labelledby={headingId}>
          <TableHead>
            <TableRow>
              <TableCell scope="col">Row</TableCell>
              <TableCell scope="col">Column</TableCell>
              <TableCell scope="col">Problem</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {shown.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map((error, index) => (
              <TableRow key={`${error.row}-${error.column ?? ''}-${error.code}-${index}`}>
                <TableCell>{error.row}</TableCell>
                <TableCell>{error.column ?? 'Whole row'}</TableCell>
                {/* The server's sentence, as text. */}
                <TableCell sx={{ overflowWrap: 'anywhere' }}>{error.message}</TableCell>
              </TableRow>
            ))}
            {shown.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3}>No problems match. Clear the search or choose another column.</TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </TableContainer>
      {shown.length > PAGE_SIZE ? (
        <TablePagination
          component="div"
          count={shown.length}
          page={current}
          rowsPerPage={PAGE_SIZE}
          rowsPerPageOptions={[PAGE_SIZE]}
          onPageChange={(_event, next) => setPage(next)}
        />
      ) : null}
    </Box>
  )
}
