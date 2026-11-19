import {
  Alert,
  Box,
  Button,
  FormControl,
  FormControlLabel,
  FormLabel,
  LinearProgress,
  Link as MuiLink,
  Paper,
  Radio,
  RadioGroup,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode, type Ref } from 'react'
import { Link } from 'react-router'
import { downloadImportTemplate, importProducts, type ImportMode, type ImportReport } from '../../api'
import { isAbort } from '../uploads/upload'
import { PageHeader, useConfirm, useToast } from '../../ui'
import { saveFile } from './download'
import { ErrorsTable } from './ErrorsTable'
import { IMPORT_MAX_BYTES, IMPORT_MAX_ROWS, TEMPLATE_COLUMNS, canImport, checkImportFile, fileErrorMessage, formatBytes } from './rules'

type WriteMode = Exclude<ImportMode, 'validate'>
type Busy = 'checking' | 'importing' | undefined

/** The most created products listed by name after an import; the rest are in the products list. */
const LISTED_PRODUCTS = 20

const ACCEPT = '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function Step({ number, title, id, children }: { number: number; title: string; id: string; children: ReactNode }) {
  return (
    <Paper component="section" variant="outlined" aria-labelledby={id} sx={{ p: { xs: 2, sm: 3 } }}>
      <Typography id={id} component="h2" variant="h6" gutterBottom>
        {number}. {title}
      </Typography>
      {children}
    </Paper>
  )
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <Box component="li" sx={{ listStyle: 'none', minWidth: 120 }}>
      <Typography variant="h5" component="span" sx={{ display: 'block' }}>
        {value}
      </Typography>
      <Typography variant="body2" color="text.secondary" component="span">
        {label}
      </Typography>
    </Box>
  )
}

/** The counts of a report, as a list a screen reader reads as label and value. */
function Counts({ items }: { items: [string, number][] }) {
  return (
    <Stack component="ul" direction="row" sx={{ p: 0, m: 0, mb: 2, flexWrap: 'wrap', gap: 3 }}>
      {items.map(([label, value]) => (
        <Count key={label} label={label} value={value} />
      ))}
    </Stack>
  )
}

/**
 * `/import`: download the template, check a spreadsheet (nothing is written), read the report and
 * fix the rows, then import. The import is offered only after a check of the same file, and asks
 * for confirmation; until then nothing is written.
 */
export default function ImportPage() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const controller = useRef<AbortController | null>(null)
  const reportHeading = useRef<HTMLHeadingElement>(null)
  const resultHeading = useRef<HTMLHeadingElement>(null)
  const hintId = useId()
  const fileErrorId = useId()

  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | undefined>()
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState<Busy>()
  const [requestError, setRequestError] = useState<string | undefined>()
  const [checked, setChecked] = useState<{ file: File; report: ImportReport } | null>(null)
  const [mode, setMode] = useState<WriteMode>('import')
  const [result, setResult] = useState<{ file: File; mode: WriteMode; report: ImportReport } | null>(null)
  const [downloading, setDownloading] = useState<'csv' | 'xlsx' | undefined>()

  // Leaving the page stops a request in flight.
  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => {
    if (checked) reportHeading.current?.focus()
  }, [checked])
  useEffect(() => {
    if (result) resultHeading.current?.focus()
  }, [result])

  // The check belongs to one file: a different file must be checked again before it can be imported.
  const validated = checked !== null && checked.file === file ? checked.report : null

  function choose(chosen: File | undefined) {
    if (!chosen || busy) return
    setRequestError(undefined)
    setChecked(null)
    setResult(null)
    const problem = checkImportFile(chosen)
    setFileError(problem)
    setFile(problem ? null : chosen)
  }

  async function run(target: File, runMode: ImportMode): Promise<ImportReport | undefined> {
    controller.current?.abort()
    const abort = new AbortController()
    controller.current = abort
    setRequestError(undefined)
    setBusy(runMode === 'validate' ? 'checking' : 'importing')
    try {
      return await importProducts(target, { mode: runMode, signal: abort.signal })
    } catch (caught) {
      if (isAbort(caught) || abort.signal.aborted) {
        setRequestError(
          runMode === 'validate'
            ? 'The check was cancelled. Nothing was imported.'
            : 'The import was cancelled. If the file had already reached us, some products may have been imported: check your products list. Importing the same file again is safe.',
        )
      } else {
        setRequestError(fileErrorMessage(caught))
      }
      return undefined
    } finally {
      if (controller.current === abort) controller.current = null
      setBusy(undefined)
    }
  }

  async function onCheck() {
    if (!file) return
    setResult(null)
    const report = await run(file, 'validate')
    if (report) setChecked({ file, report })
  }

  async function onImport() {
    if (!file || !validated || !canImport(validated)) return
    const { valid, unchanged, rejected } = validated.summary
    const go = await confirm({
      title: 'Import these products?',
      message:
        mode === 'all_or_nothing'
          ? `If every row is still correct, ${valid} new product${valid === 1 ? '' : 's'} will be created as drafts. If any row has a problem, nothing is written.`
          : `${valid} new product${valid === 1 ? '' : 's'} will be created as drafts${rejected > 0 ? `; ${rejected} with problems will be skipped` : ''}${unchanged > 0 ? `; ${unchanged} already exist and stay as they are` : ''}.`,
      confirmLabel: 'Import',
    })
    if (!go) return
    const report = await run(file, mode)
    if (!report) return
    setResult({ file, mode, report })
    if (report.committed) {
      toast.success(`${report.summary.created} product${report.summary.created === 1 ? '' : 's'} imported`)
      void queryClient.invalidateQueries({ queryKey: ['get', '/v1/vendor/products'] })
    }
  }

  async function onTemplate(format: 'csv' | 'xlsx') {
    setDownloading(format)
    try {
      saveFile(await downloadImportTemplate({ format }), `shazlo-product-import-template.${format}`)
    } catch (caught) {
      toast.error(fileErrorMessage(caught))
    } finally {
      setDownloading(undefined)
    }
  }

  const onInput = (event: ChangeEvent<HTMLInputElement>) => {
    choose(event.target.files?.[0])
    // Choosing the same file again (after fixing it) must still count as a choice.
    event.target.value = ''
  }
  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    choose(event.dataTransfer.files[0])
  }

  const importable = validated !== null && canImport(validated)

  return (
    <>
      <PageHeader
        title="Bulk import"
        description="Add many products at once from a spreadsheet. Check the file first: nothing is saved until you import it. Imported products are drafts without images; add images, then submit them for review."
      />
      <Stack spacing={3}>
        <Step number={1} title="Get the template" id="import-step-template">
          <Typography sx={{ mb: 2 }}>
            One row is one variant (a size and colour); rows with the same <code>sku</code> are one product. Write the product&apos;s
            details on its first row. The template has example rows: check it unchanged to see what a clean report looks like.
          </Typography>
          <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', gap: 1, mb: 2 }}>
            <Button variant="outlined" onClick={() => void onTemplate('xlsx')} disabled={downloading !== undefined}>
              {downloading === 'xlsx' ? 'Downloading…' : 'Download the template (Excel)'}
            </Button>
            <Button variant="outlined" onClick={() => void onTemplate('csv')} disabled={downloading !== undefined}>
              {downloading === 'csv' ? 'Downloading…' : 'Download the template (CSV)'}
            </Button>
          </Stack>
          <Box component="details">
            <Box component="summary" sx={{ cursor: 'pointer', mb: 1 }}>
              What each column means
            </Box>
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small" aria-label="The template's columns">
                <TableHead>
                  <TableRow>
                    <TableCell scope="col">Column</TableCell>
                    <TableCell scope="col">Needed</TableCell>
                    <TableCell scope="col">What to write</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {TEMPLATE_COLUMNS.map((column) => (
                    <TableRow key={column.name}>
                      <TableCell>
                        <code>{column.name}</code>
                      </TableCell>
                      <TableCell>{column.required === 'always' ? 'On every row' : column.required === 'first' ? "On the product's first row" : 'No'}</TableCell>
                      <TableCell>{column.help}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Text may not start with = + - or @, and formulas are refused: paste values. Columns we do not know are ignored. Images
              cannot be imported.
            </Typography>
          </Box>
        </Step>

        <Step number={2} title="Check your file" id="import-step-check">
          <Box
            onDragOver={(event: DragEvent) => {
              event.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            sx={{ border: 2, borderStyle: 'dashed', borderColor: dragging ? 'primary.main' : 'divider', borderRadius: 1, p: 3, textAlign: 'center', mb: 2 }}
          >
            <Button
              variant="outlined"
              onClick={() => input.current?.click()}
              disabled={busy !== undefined}
              aria-describedby={[hintId, fileError ? fileErrorId : ''].filter(Boolean).join(' ')}
            >
              {file ? 'Choose a different file' : 'Choose a file'}
            </Button>
            <input ref={input} type="file" hidden accept={ACCEPT} aria-label="Spreadsheet to import" onChange={onInput} />
            <Typography id={hintId} variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              A CSV (.csv) or Excel (.xlsx) file up to {formatBytes(IMPORT_MAX_BYTES)}, with at most {IMPORT_MAX_ROWS.toLocaleString('en-IN')} rows. You can
              also drop it here.
            </Typography>
            {file ? (
              <Typography sx={{ mt: 1, overflowWrap: 'anywhere' }}>
                <strong>{file.name}</strong> ({formatBytes(file.size)})
              </Typography>
            ) : null}
            {fileError ? (
              <Typography id={fileErrorId} color="error" role="alert" sx={{ mt: 1 }}>
                {fileError}
              </Typography>
            ) : null}
          </Box>

          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
            <Button variant="contained" onClick={() => void onCheck()} disabled={!file || busy !== undefined}>
              {busy === 'checking' ? 'Checking…' : validated ? 'Check again' : 'Check the file'}
            </Button>
            {busy ? (
              <Button onClick={() => controller.current?.abort()} aria-label={busy === 'checking' ? 'Cancel the check' : 'Cancel the import'}>
                Cancel
              </Button>
            ) : null}
          </Stack>
          {busy ? (
            <Box sx={{ mt: 2 }} role="status">
              <Typography variant="body2" sx={{ mb: 1 }}>
                {busy === 'checking' ? 'Uploading and checking every row…' : 'Importing…'} This can take up to a minute for a large file.
              </Typography>
              <LinearProgress aria-label={busy === 'checking' ? 'Checking the file' : 'Importing'} />
            </Box>
          ) : null}
          {requestError ? (
            <Alert severity="error" role="alert" sx={{ mt: 2 }}>
              {requestError}
            </Alert>
          ) : null}

          {validated && checked ? (
            <Box sx={{ mt: 3 }}>
              <Typography ref={reportHeading} tabIndex={-1} component="h3" variant="h6" gutterBottom sx={{ outline: 'none' }}>
                {validated.summary.rejected === 0 ? 'The file is ready to import' : 'Some rows need changes'}
              </Typography>
              <Counts
                items={[
                  ['rows read', validated.summary.rows_read],
                  ['new products', validated.summary.valid],
                  ['already imported', validated.summary.unchanged],
                  ['products with problems', validated.summary.rejected],
                ]}
              />
              {validated.summary.rejected > 0 ? (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  {validated.summary.rows_with_errors} row{validated.summary.rows_with_errors === 1 ? ' has' : 's have'} problems. Fix them in your
                  spreadsheet and check it again, or import only the products without problems.
                </Alert>
              ) : null}
              {validated.ignored_columns.length > 0 ? (
                <Alert severity="info" sx={{ mb: 2 }}>
                  These columns are not part of the template and were ignored: {validated.ignored_columns.join(', ')}. If one is a misspelt
                  column name, correct it and check again.
                </Alert>
              ) : null}
              {validated.errors.length > 0 ? <ErrorsTable errors={validated.errors} truncated={validated.errors_truncated} fileName={checked.file.name} /> : null}
            </Box>
          ) : null}
        </Step>

        <Step number={3} title="Import" id="import-step-import">
          {!validated ? (
            <Typography color="text.secondary">Check your file first. The import is offered once the check is done.</Typography>
          ) : !importable ? (
            <Typography>There is nothing to import from this file yet. Fix the problems above and check it again.</Typography>
          ) : (
            <>
              <FormControl sx={{ mb: 2 }}>
                <FormLabel id="import-mode-label">How to import</FormLabel>
                <RadioGroup aria-labelledby="import-mode-label" value={mode} onChange={(event) => setMode(event.target.value as WriteMode)}>
                  <FormControlLabel
                    value="import"
                    control={<Radio />}
                    label="Import the products without problems. Any with problems are skipped and listed, so you can fix them and import the file again."
                  />
                  <FormControlLabel
                    value="all_or_nothing"
                    control={<Radio />}
                    label="All or nothing. If any row has a problem, nothing is imported at all."
                  />
                </RadioGroup>
              </FormControl>
              <Box>
                <Button variant="contained" onClick={() => void onImport()} disabled={busy !== undefined}>
                  {busy === 'importing' ? 'Importing…' : 'Import'}
                </Button>
              </Box>
            </>
          )}

          {result ? <ImportResult result={result} headingRef={resultHeading} /> : null}
        </Step>
      </Stack>
    </>
  )
}

function ImportResult({ result, headingRef }: { result: { file: File; mode: WriteMode; report: ImportReport }; headingRef: Ref<HTMLHeadingElement> }) {
  const { report } = result
  const created = report.products.filter((product) => product.status === 'created' && product.product_id)
  const nothingWritten = !report.committed
  // Every product in the file already exists: nothing to write, and nothing wrong either.
  const alreadyThere = nothingWritten && report.summary.rejected === 0 && report.summary.unchanged > 0
  return (
    <Box sx={{ mt: 3 }}>
      <Typography ref={headingRef} tabIndex={-1} component="h3" variant="h6" gutterBottom sx={{ outline: 'none' }}>
        {alreadyThere ? 'Already imported' : nothingWritten ? 'Nothing was imported' : 'Import finished'}
      </Typography>
      {alreadyThere ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          Every product in this file is already in your products list, so nothing changed.
        </Alert>
      ) : nothingWritten ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {result.mode === 'all_or_nothing'
            ? 'Some rows have problems, so nothing was imported. Fix them and check the file again.'
            : 'No product could be imported. Fix the problems and check the file again.'}
        </Alert>
      ) : null}
      <Counts
        items={[
          ['created', report.summary.created],
          ['already there, unchanged', report.summary.unchanged],
          ['with problems, not imported', report.summary.rejected],
        ]}
      />
      {created.length > 0 ? (
        <>
          <Typography variant="subtitle1" component="h4">
            New products (drafts)
          </Typography>
          <Box component="ul" sx={{ mt: 0.5, mb: 2 }}>
            {created.slice(0, LISTED_PRODUCTS).map((product) => (
              <li key={product.product_id}>
                <MuiLink component={Link} to={`/products/${product.product_id}`}>
                  {product.sku}
                </MuiLink>
              </li>
            ))}
          </Box>
          {created.length > LISTED_PRODUCTS ? (
            <Typography variant="body2" sx={{ mb: 2 }}>
              And {created.length - LISTED_PRODUCTS} more in{' '}
              <MuiLink component={Link} to="/products?status=draft">
                your drafts
              </MuiLink>
              .
            </Typography>
          ) : null}
          <Typography variant="body2" sx={{ mb: 2 }}>
            Add images to each one, then submit it for review.
          </Typography>
        </>
      ) : null}
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Importing this file again is safe: products that already exist are reported as unchanged, never duplicated or overwritten.
      </Typography>
      {report.errors.length > 0 ? <ErrorsTable errors={report.errors} truncated={report.errors_truncated} fileName={result.file.name} /> : null}
    </Box>
  )
}
