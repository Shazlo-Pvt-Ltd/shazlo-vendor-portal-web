import { ApiError, NetworkError, importContentType, type ImportReport } from '../../api'

export type RowError = ImportReport['errors'][number]

/**
 * vendor-api's default `import_max_bytes` (2 MB). The server checks it again; if it is configured
 * with another limit, change this to match.
 */
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024

/**
 * vendor-api's default `import_max_rows` (1,000 rows after the column names). Only the server can
 * count rows (an .xlsx must be unzipped); a longer file is its `422`. Change both together.
 */
export const IMPORT_MAX_ROWS = 1000

/** "2 MB", "512 KB". */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** Why a file cannot be sent, checked in the browser before any request; undefined when it can. */
export function checkImportFile(file: File, maxBytes = IMPORT_MAX_BYTES): string | undefined {
  if (importContentType(file) === undefined) return 'Choose a CSV (.csv) or Excel (.xlsx) file.'
  if (file.size === 0) return 'This file is empty. Choose the file with your products.'
  if (file.size > maxBytes) {
    return `This file is ${formatBytes(file.size)}; the limit is ${formatBytes(maxBytes)}. Split it into smaller files and import each one.`
  }
  return undefined
}

/** What to tell the vendor when the file as a whole could not be checked or imported. */
export function fileErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 413) return `This file is too large; the limit is ${formatBytes(IMPORT_MAX_BYTES)}. Split it into smaller files and import each one.`
    if (error.status === 415) return 'This is not a CSV or Excel file. Save it as .csv or .xlsx and try again.'
    if (error.status === 422) return `We could not read this file. ${sentence(error.message)} Compare it with the template.`
    if (error.status === 429) {
      const minutes = Math.max(1, Math.ceil((error.retryAfter ?? 60) / 60))
      return `You have checked or imported many files in the last hour. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`
    }
    if (error.status >= 500) return 'Something went wrong on our side. Nothing was imported. Please try again in a moment.'
    return sentence(error.message)
  }
  if (error instanceof NetworkError) {
    return error.kind === 'timeout'
      ? 'The file took too long to process. Check your products list before trying again: some may have been imported.'
      : 'We could not reach Shazlo. Check your connection and try again.'
  }
  return 'Something went wrong. Please try again.'
}

const sentence = (text: string) => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`)

/** Whether the import can be offered after a validation: there is something to create or confirm. */
export function canImport(report: ImportReport): boolean {
  return report.summary.valid + report.summary.unchanged > 0
}

export interface ErrorFilter {
  /** `''` is every column; `'-'` is errors about a whole row (no column). */
  column: string
  query: string
}

/** The errors that match a column and a search (row number, column, code or message). */
export function filterErrors(errors: readonly RowError[], filter: ErrorFilter): RowError[] {
  const query = filter.query.trim().toLowerCase()
  return errors.filter((error) => {
    if (filter.column === '-' ? error.column !== null : filter.column !== '' && error.column !== filter.column) return false
    if (query === '') return true
    return (
      String(error.row) === query ||
      (error.column ?? '').toLowerCase().includes(query) ||
      error.code.toLowerCase().includes(query) ||
      error.message.toLowerCase().includes(query)
    )
  })
}

/** The columns that have errors, in the template's order (then any others). */
export function errorColumns(errors: readonly RowError[]): string[] {
  const present = new Set(errors.map((error) => error.column).filter((column): column is string => column !== null))
  const known = TEMPLATE_COLUMNS.map((column) => column.name).filter((name) => present.has(name))
  const others = [...present].filter((name) => !known.includes(name)).sort()
  return [...known, ...others]
}

/**
 * A cell as CSV: quoted when needed, and made inert when a spreadsheet would run it as a formula
 * (a leading `=`, `+`, `-`, `@`, tab or carriage return gets an apostrophe), since a message may
 * quote what the vendor typed.
 */
export function csvCell(value: string | number | null): string {
  let text = value === null ? '' : String(value)
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** A byte order mark: Excel then opens the CSV as UTF-8. */
const BOM = String.fromCharCode(0xfeff)

/** The error report as a CSV a spreadsheet opens (UTF-8 with a byte order mark, CRLF lines). */
export function errorReportCsv(errors: readonly RowError[]): string {
  const lines = [['row', 'column', 'code', 'message'].join(',')]
  for (const error of errors) {
    lines.push([csvCell(error.row), csvCell(error.column), csvCell(error.code), csvCell(error.message)].join(','))
  }
  return `${BOM}${lines.join('\r\n')}\r\n`
}

/** "products-errors.csv" for "products.xlsx". */
export function errorReportName(fileName: string): string {
  const base = fileName.replace(/\.(csv|xlsx)$/i, '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'import'
  return `${base}-errors.csv`
}

export interface TemplateColumn {
  name: string
  required: 'always' | 'first' | 'no'
  help: string
}

/** The template's columns (vendor-api `COLUMNS`), explained on the page. */
export const TEMPLATE_COLUMNS: readonly TemplateColumn[] = [
  { name: 'sku', required: 'always', help: 'Your code for the product. Rows with the same sku are one product.' },
  { name: 'title', required: 'first', help: 'The product name shoppers see.' },
  { name: 'description', required: 'no', help: 'A few lines about the product.' },
  { name: 'category', required: 'first', help: 'For example kurtas.' },
  { name: 'subcategory', required: 'no', help: 'For example straight kurtas.' },
  { name: 'gender', required: 'first', help: 'women, men or unisex.' },
  { name: 'fabric', required: 'no', help: 'For example cotton.' },
  { name: 'weight_grams', required: 'no', help: 'Packed weight in whole grams.' },
  { name: 'returnable', required: 'no', help: 'yes or no.' },
  { name: 'return_window_days', required: 'no', help: 'Days to return it, 0 to 30. Needed when returnable is yes.' },
  { name: 'variant_sku', required: 'always', help: 'Your code for this size and colour. Unique across all your variants.' },
  { name: 'size', required: 'no', help: 'For example M or 32.' },
  { name: 'color', required: 'no', help: 'For example Indigo.' },
  { name: 'price', required: 'always', help: 'In rupees, like 1499 or 899.50. No ₹ sign or commas.' },
  { name: 'mrp', required: 'no', help: 'The printed price, not below the price. Empty means the same as the price.' },
  { name: 'is_active', required: 'no', help: 'yes or no: whether this variant is on sale.' },
]
