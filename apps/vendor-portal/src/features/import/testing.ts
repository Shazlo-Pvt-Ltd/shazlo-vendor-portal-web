import type { ImportReport } from '../../api'

type Summary = ImportReport['summary']

/** An import report as vendor-api returns it; the summary's counts can be given in part. */
export function report(overrides: Partial<Omit<ImportReport, 'summary'>> & { summary?: Partial<Summary> } = {}): ImportReport {
  const { summary, ...rest } = overrides
  return {
    mode: 'validate',
    file_format: 'csv',
    committed: false,
    ignored_columns: [],
    products: [],
    errors: [],
    errors_truncated: false,
    ...rest,
    summary: { products: 0, created: 0, unchanged: 0, valid: 0, rejected: 0, rows_read: 0, rows_with_errors: 0, ...summary },
  }
}
