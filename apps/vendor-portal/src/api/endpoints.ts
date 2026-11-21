import type { components } from './schema'
import { getApiClient } from './instance'

const IMPORT_TYPES = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const

/** The spreadsheet types the bulk import accepts. */
export type ImportContentType = (typeof IMPORT_TYPES)[keyof typeof IMPORT_TYPES]

/** The import's content type for a file, or undefined when it is neither CSV nor XLSX. */
export function importContentType(file: File): ImportContentType | undefined {
  if (file.type === IMPORT_TYPES.csv || file.type === IMPORT_TYPES.xlsx) {
    return file.type
  }
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv')) return IMPORT_TYPES.csv
  if (name.endsWith('.xlsx')) return IMPORT_TYPES.xlsx
  return undefined
}

/** `validate` writes nothing; `import` creates every valid product; `all_or_nothing` creates nothing unless the whole file is valid. */
export type ImportMode = components['schemas']['ImportMode']
export type ImportReport = components['schemas']['ImportReportOut']

/**
 * Posts the spreadsheet as the raw request body (the endpoint is not a multipart form). The mode
 * is required: the API's default is `import`, and the portal never writes by accident.
 */
export async function importProducts(file: File, options: { mode: ImportMode; signal?: AbortSignal }): Promise<ImportReport> {
  const contentType = importContentType(file)
  if (contentType === undefined) {
    throw new TypeError('The import takes a .csv or .xlsx file.')
  }
  const { data } = await getApiClient().POST('/v1/vendor/products/import', {
    // Application-type bodies are not JSON: send the file itself.
    body: file as never,
    bodySerializer: (body: unknown) => body as BodyInit,
    params: { query: { mode: options.mode } },
    headers: { 'Content-Type': contentType },
    signal: options.signal,
  })
  return data as ImportReport
}

/** The template for the bulk import (CSV unless asked for `xlsx`), as a Blob the caller can save. */
export async function downloadImportTemplate(
  options: { format?: 'csv' | 'xlsx'; signal?: AbortSignal } = {},
): Promise<Blob> {
  const { data } = await getApiClient().GET('/v1/vendor/products/import/template', {
    params: { query: { format: options.format ?? 'csv' } },
    parseAs: 'blob',
    signal: options.signal,
  })
  return data as Blob
}
