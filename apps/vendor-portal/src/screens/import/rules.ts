import { ApiError, NetworkError } from '../../api/errors'
import type { Schemas } from '../../api/model'
import { catalogCopy } from '../../copy/catalog'
import { importCopy } from '../../copy/import'
import { IMPORT_COLUMNS } from '../../lib/catalog'
import { formatCount } from '../../lib/format'

// Main's bulk import rules (once features/import/rules.ts) on Build 2's wizard: what the browser checks
// before sending a file, how vendor-api's refusals read, the list of rows to fix and its report.

type RowError = Schemas['ImportJob']['errors'][number]

/** vendor-api's default `import_max_bytes` (2 MB). The server checks it again; change both together. */
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024
/** vendor-api's default `import_max_rows`. Only the server can count rows (an .xlsx must be unzipped); a longer file is its 422. */
export const IMPORT_MAX_ROWS = 1000

const TYPES = { csv: 'text/csv', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } as const

/** "2 MB", "512 KB". */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function isSpreadsheet(file: File): boolean {
  if (file.type === TYPES.csv || file.type === TYPES.xlsx) return true
  return /\.(csv|xlsx)$/i.test(file.name)
}

/** Why a file cannot be sent, checked before any request; undefined when it can. */
export function checkImportFile(file: File, maxBytes = IMPORT_MAX_BYTES): string | undefined {
  const c = importCopy.upload
  if (!isSpreadsheet(file)) return c.notSpreadsheet
  if (file.size === 0) return c.empty
  if (file.size > maxBytes) return c.tooBig(formatBytes(file.size), formatBytes(maxBytes))
  return undefined
}

const sentence = (text: string) => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`)

/** A file vendor-api could not read at all (its 422 with a code), in plain words. */
export function failedFileMessage({ code, message }: { code: string; message: string }): string {
  const r = importCopy.upload.refused
  if (code === 'too_many_rows') return r.tooManyRows(formatCount(IMPORT_MAX_ROWS))
  return r.unreadable(sentence(message))
}

/** What to tell the seller when the whole file could not be checked or saved. */
export function fileErrorMessage(error: unknown, { saving = false }: { saving?: boolean } = {}): string {
  const r = importCopy.upload.refused
  if (error instanceof ApiError) {
    if (error.status === 413) return r.tooLarge(formatBytes(IMPORT_MAX_BYTES))
    if (error.status === 415) return r.notSpreadsheet
    if (error.status === 422) return failedFileMessage(error)
    if (error.status === 429) return r.wait(Math.max(1, Math.ceil((error.retryAfter ?? 60) / 60)))
    if (error.status >= 500) return r.server
    return sentence(error.message)
  }
  if (error instanceof NetworkError) {
    if (error.kind === 'timeout') return saving ? r.slowSave : r.slowCheck
    return r.offline
  }
  return r.other
}

export interface ErrorFilter {
  /** A column in the seller's words; '' is every column. */
  column: string
  query: string
}

/** The problems that match a column and a search (row number, product, column, code or words). */
export function filterErrors(errors: readonly RowError[], filter: ErrorFilter): RowError[] {
  const query = filter.query.trim().toLowerCase()
  return errors.filter((error) => {
    if (filter.column !== '' && error.column !== filter.column) return false
    if (query === '') return true
    return (
      String(error.row) === query ||
      (error.product ?? '').toLowerCase().includes(query) ||
      error.column.toLowerCase().includes(query) ||
      error.code.toLowerCase().includes(query) ||
      error.message.toLowerCase().includes(query)
    )
  })
}

/** The columns that have problems, in the template's order, then whole-row problems and any others. */
export function errorColumns(errors: readonly RowError[]): string[] {
  const present = new Set(errors.map((e) => e.column))
  const known = IMPORT_COLUMNS.map((c) => catalogCopy.importColumns[c]).filter((label) => present.has(label))
  const whole = present.has(importCopy.review.wholeRow) ? [importCopy.review.wholeRow] : []
  const others = [...present].filter((label) => !known.includes(label) && label !== importCopy.review.wholeRow).sort()
  return [...known, ...whole, ...others]
}

/**
 * A cell as CSV: quoted when needed, and made inert when a spreadsheet would run it as a formula
 * (a leading `=`, `+`, `-`, `@`, tab or carriage return gets an apostrophe), since a problem may
 * quote what the seller typed.
 */
export function csvCell(value: string | number | null): string {
  let text = value === null ? '' : String(value)
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** A byte order mark: Excel then opens the CSV as UTF-8 (₹, Devanagari). */
const BOM = String.fromCharCode(0xfeff)

/** The rows to fix as a CSV a spreadsheet opens: every problem, not just the ones on screen. */
export function errorReportCsv(errors: readonly RowError[]): string {
  const lines = [importCopy.review.reportHeader.join(',')]
  for (const e of errors) lines.push([csvCell(e.row), csvCell(e.product), csvCell(e.column), csvCell(e.message)].join(','))
  return `${BOM}${lines.join('\r\n')}\r\n`
}

/** "products-fixes.csv" for "products.xlsx". */
export function errorReportName(fileName: string): string {
  const base =
    fileName
      .replace(/\.(csv|xlsx)$/i, '')
      .replace(/[^A-Za-z0-9_]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'import'
  return importCopy.review.reportFileName(base)
}

// ---- product names for the rows of a CSV ---------------------------------------------------------

// "Product name", "product_name (optional)" → "product_name", as vendor-api reads a header.
const headerKey = (cell: string) =>
  cell.toLowerCase().replace(/\(optional\)/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

/** Every record of a CSV, numbered as vendor-api numbers rows (the header is row 1; blank rows count). */
function csvRecords(text: string): string[][] {
  const body = text.replace(/^\uFEFF/, '')
  const firstLine = body.split('\n', 1)[0] ?? ''
  const delimiter = [',', ';', '\t'].reduce((best, d) => (firstLine.split(d).length > firstLine.split(best).length ? d : best), ',')
  const records: string[][] = []
  let record: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') {
        cell += '"'
        i += 1
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === delimiter) {
      record.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && body[i + 1] === '\n') i += 1
      record.push(cell)
      records.push(record)
      record = []
      cell = ''
    } else cell += ch
  }
  if (cell !== '' || record.length > 0) {
    record.push(cell)
    records.push(record)
  }
  return records
}

/**
 * The product name on each row of a CSV, so the list of rows to fix can say which product each
 * problem is about (vendor-api's report gives the row only). An .xlsx cannot be read here.
 */
export function rowNames(text: string): Map<number, string> {
  const records = csvRecords(text)
  const column = (records[0] ?? []).map(headerKey).indexOf('product_name')
  const names = new Map<number, string>()
  if (column === -1) return names
  records.forEach((cells, i) => {
    const name = (cells[column] ?? '').trim()
    if (i > 0 && name) names.set(i + 1, name)
  })
  return names
}

/** The problems with their product's name, where the sheet has one. */
export function withRowNames(errors: readonly RowError[], names: ReadonlyMap<number, string>): RowError[] {
  return errors.map((e) => (e.product === null && names.has(e.row) ? { ...e, product: names.get(e.row)! } : e))
}
