/**
 * Bulk import: vendor-api checks or imports a whole file in one call and answers with a report
 * (`ImportReportOut`). Build 2's wizard sees a job (checked → ready → committed) and then the list
 * of drafts made, to match photos to them by name; main's screen sees the report itself.
 */
import { catalogCopy } from '../../copy/catalog'
import { IMPORT_COLUMNS } from '../../lib/catalog'
import type { ImportCommit, ImportJob, ImportReport } from '../model'
import type { ImportReportOut } from '../wire'
import { asArray, oneOf } from './common'

/** What the wizard shows for a problem with a whole row rather than one cell. */
export const WHOLE_ROW = 'Whole row'

const count = (value: unknown): number => (Number.isInteger(value) && (value as number) >= 0 ? (value as number) : 0)

export function importReportFromApi(r: ImportReportOut): ImportReport {
  const s = (typeof r.summary === 'object' && r.summary !== null ? r.summary : {}) as Partial<ImportReportOut['summary']>
  const statuses = ['created', 'unchanged', 'valid', 'rejected'] as const
  return {
    mode: String(r.mode ?? ''),
    fileFormat: String(r.file_format ?? ''),
    committed: r.committed === true,
    summary: {
      products: count(s.products),
      created: count(s.created),
      unchanged: count(s.unchanged),
      valid: count(s.valid),
      rejected: count(s.rejected),
      rowsRead: count(s.rows_read),
      rowsWithErrors: count(s.rows_with_errors),
    },
    ignoredColumns: asArray(r.ignored_columns).filter((c): c is string => typeof c === 'string'),
    products: asArray(r.products).map((p) => ({
      productId: typeof p?.product_id === 'string' ? p.product_id : null,
      code: String(p?.sku ?? ''),
      rows: asArray(p?.rows).filter((n): n is number => Number.isInteger(n)),
      status: oneOf(statuses, p?.status) ?? 'unknown',
    })),
    errors: asArray(r.errors).map((e) => ({
      row: count(e?.row),
      column: typeof e?.column === 'string' ? e.column : null,
      code: String(e?.code ?? ''),
      message: String(e?.message ?? ''),
    })),
    errorsTruncated: r.errors_truncated === true,
  }
}

/** A checked (or imported) file as Build 2's import job. */
export function importJobFromReport(id: string, fileName: string, r: ImportReportOut): ImportJob {
  const report = importReportFromApi(r)
  const { rowsRead, rowsWithErrors, valid, created, unchanged } = report.summary
  const status: ImportJob['status'] = report.committed ? 'committed' : rowsRead === 0 && report.errors.length > 0 ? 'failed' : 'ready'
  return {
    id,
    status,
    file_name: fileName,
    total_rows: rowsRead,
    ok_rows: Math.max(0, rowsRead - rowsWithErrors),
    ok_products: valid + created,
    unchanged,
    error_rows: rowsWithErrors,
    errors: report.errors.map((e) => {
      const field = oneOf(IMPORT_COLUMNS, e.column) ?? null
      return {
        row: e.row,
        product: null,
        column: field ? catalogCopy.importColumns[field] : (e.column ?? WHOLE_ROW),
        field,
        code: e.code,
        message: e.message,
      }
    }),
    ignored_columns: report.ignoredColumns,
    errors_truncated: report.errorsTruncated,
  }
}

/** The drafts an import made, in file order, named so photos can be matched to them. */
export function importCommitFromReport(r: ImportReportOut, titles: ReadonlyMap<string, string>): ImportCommit {
  const report = importReportFromApi(r)
  const made = report.products
    .filter((p): p is typeof p & { productId: string } => p.status === 'created' && p.productId !== null)
    .sort((a, b) => (a.rows[0] ?? 0) - (b.rows[0] ?? 0))
  return {
    created: report.summary.created,
    products: made.map((p) => ({ id: p.productId, title: titles.get(p.productId) ?? p.code })),
  }
}
