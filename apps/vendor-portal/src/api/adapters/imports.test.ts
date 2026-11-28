import { describe, expect, it } from 'vitest'
import type { ImportReportOut } from '../wire'
import { importCommitFromReport, importJobFromReport, importReportFromApi } from './imports'

function report(overrides: Partial<ImportReportOut> = {}): ImportReportOut {
  return {
    mode: 'validate',
    file_format: 'csv',
    committed: false,
    summary: { products: 3, created: 0, unchanged: 0, valid: 2, rejected: 1, rows_read: 3, rows_with_errors: 1 },
    ignored_columns: [],
    products: [
      { product_id: null, sku: 'P-1', rows: [2], status: 'valid' },
      { product_id: null, sku: 'P-2', rows: [3], status: 'valid' },
      { product_id: null, sku: 'P-3', rows: [4], status: 'rejected' },
    ],
    errors: [
      { row: 4, column: 'sizes_stock', code: 'invalid_value', message: 'Write sizes like S:4, M:6.' },
      { row: 4, column: null, code: 'duplicate_row', message: 'This row repeats row 2.' },
    ],
    errors_truncated: false,
    ...overrides,
  }
}

describe('importJobFromReport', () => {
  it('reads a checked file as a job that is ready to import', () => {
    expect(importJobFromReport('job-1', 'products.csv', report())).toEqual({
      id: 'job-1',
      status: 'ready',
      file_name: 'products.csv',
      total_rows: 3,
      ok_rows: 2,
      ok_products: 2,
      unchanged: 0,
      error_rows: 1,
      errors: [
        { row: 4, product: null, column: 'Sizes and stock', field: 'sizes_stock', code: 'invalid_value', message: 'Write sizes like S:4, M:6.' },
        { row: 4, product: null, column: 'Whole row', field: null, code: 'duplicate_row', message: 'This row repeats row 2.' },
      ],
      ignored_columns: [],
      errors_truncated: false,
    })
  })

  it('says which products are already there, which columns were ignored and when the list of problems was cut short', () => {
    const job = importJobFromReport(
      'job-5',
      'x.csv',
      report({ summary: { products: 3, created: 0, unchanged: 1, valid: 1, rejected: 1, rows_read: 3, rows_with_errors: 1 }, ignored_columns: ['notes', 'Colour code'], errors_truncated: true }),
    )
    expect(job).toMatchObject({ unchanged: 1, ok_products: 1, ignored_columns: ['notes', 'Colour code'], errors_truncated: true })
  })

  it('calls a file with no readable row failed', () => {
    const job = importJobFromReport('job-2', 'x.csv', report({ summary: { products: 0, created: 0, unchanged: 0, valid: 0, rejected: 0, rows_read: 0, rows_with_errors: 0 }, products: [], errors: [{ row: 1, column: 'product_name', code: 'missing_column', message: 'Add the product_name column.' }] }))
    expect(job.status).toBe('failed')
  })

  it('shows a column it does not know by its own name', () => {
    const job = importJobFromReport('job-3', 'x.csv', report({ errors: [{ row: 2, column: 'colour_code', code: 'x', message: 'y' }] }))
    expect(job.errors[0]).toMatchObject({ column: 'colour_code', field: null })
  })

  it('a committed run is committed', () => {
    expect(importJobFromReport('job-4', 'x.csv', report({ mode: 'import', committed: true })).status).toBe('committed')
  })
})

describe('importCommitFromReport', () => {
  it('lists the drafts made, in file order, with their names', () => {
    const done = report({
      mode: 'import',
      committed: true,
      summary: { products: 3, created: 2, unchanged: 0, valid: 0, rejected: 1, rows_read: 3, rows_with_errors: 1 },
      products: [
        { product_id: 'id-2', sku: 'P-2', rows: [3], status: 'created' },
        { product_id: 'id-1', sku: 'P-1', rows: [2], status: 'created' },
        { product_id: null, sku: 'P-3', rows: [4], status: 'rejected' },
      ],
    })
    const titles = new Map([['id-1', 'Linen Shirt'], ['id-2', 'Ikat Dress']])
    expect(importCommitFromReport(done, titles)).toEqual({
      created: 2,
      products: [
        { id: 'id-1', title: 'Linen Shirt' },
        { id: 'id-2', title: 'Ikat Dress' },
      ],
    })
  })
})

describe('importReportFromApi', () => {
  it('keeps the whole report for main\'s validate-first screen', () => {
    const r = importReportFromApi(report({ errors_truncated: true, ignored_columns: ['notes'] }))
    expect(r.summary).toEqual({ products: 3, created: 0, unchanged: 0, valid: 2, rejected: 1, rowsRead: 3, rowsWithErrors: 1 })
    expect(r.errorsTruncated).toBe(true)
    expect(r.ignoredColumns).toEqual(['notes'])
    expect(r.products[0]).toEqual({ productId: null, code: 'P-1', rows: [2], status: 'valid' })
    expect(r.errors[1]).toEqual({ row: 4, column: null, code: 'duplicate_row', message: 'This row repeats row 2.' })
  })

  it('copes with a report that lost its lists', () => {
    const r = importReportFromApi({ mode: 'validate' } as ImportReportOut)
    expect(r).toMatchObject({ products: [], errors: [], ignoredColumns: [], committed: false })
    expect(r.summary.rowsRead).toBe(0)
  })
})
