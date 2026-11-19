import { describe, expect, it } from 'vitest'
import { ApiError, NetworkError } from '../../api'
import {
  IMPORT_MAX_BYTES,
  TEMPLATE_COLUMNS,
  canImport,
  checkImportFile,
  csvCell,
  errorColumns,
  errorReportCsv,
  errorReportName,
  fileErrorMessage,
  filterErrors,
  formatBytes,
  type RowError,
} from './rules'
import { report } from './testing'

const file = (name: string, size: number, type = '') => {
  const f = new File(['x'], name, { type })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

const errors: RowError[] = [
  { row: 2, column: 'price', code: 'invalid_number', message: 'Use an amount in rupees such as 999' },
  { row: 3, column: 'gender', code: 'invalid_choice', message: 'Use women, men or unisex' },
  { row: 3, column: null, code: 'duplicate_variant', message: 'This size and colour appear twice' },
  { row: 12, column: 'price', code: 'required', message: 'Enter a price' },
]

describe('checking a file before sending it', () => {
  it('accepts a CSV or an Excel file within the limit', () => {
    expect(checkImportFile(file('products.csv', 10))).toBeUndefined()
    expect(checkImportFile(file('PRODUCTS.XLSX', IMPORT_MAX_BYTES))).toBeUndefined()
  })

  it('refuses another type, an empty file and one over the limit', () => {
    expect(checkImportFile(file('notes.txt', 10, 'text/plain'))).toMatch(/CSV \(\.csv\) or Excel \(\.xlsx\)/)
    expect(checkImportFile(file('old.xls', 10))).toMatch(/CSV/)
    expect(checkImportFile(file('products.csv', 0))).toMatch(/empty/)
    expect(checkImportFile(file('products.csv', IMPORT_MAX_BYTES + 1))).toMatch(/the limit is 2 MB/)
  })

  it('states sizes in plain units', () => {
    expect(formatBytes(2 * 1024 * 1024)).toBe('2 MB')
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.5 MB')
    expect(formatBytes(300)).toBe('1 KB')
    expect(formatBytes(512 * 1024)).toBe('512 KB')
  })
})

describe('file-level errors', () => {
  const api = (status: number, message = 'x', retryAfter?: number) => new ApiError({ status, code: 'c', message, retryAfter })

  it('words 413, 415 and 422 for a vendor', () => {
    expect(fileErrorMessage(api(413))).toMatch(/too large; the limit is 2 MB/)
    expect(fileErrorMessage(api(415))).toMatch(/not a CSV or Excel file/)
    expect(fileErrorMessage(api(422, 'The file is missing the columns: price, sku'))).toBe(
      'We could not read this file. The file is missing the columns: price, sku. Compare it with the template.',
    )
  })

  it('says how long to wait after too many imports', () => {
    expect(fileErrorMessage(api(429, 'x', 125))).toMatch(/in 3 minutes/)
    expect(fileErrorMessage(api(429, 'x', 30))).toMatch(/in 1 minute\./)
  })

  it('warns that a timed-out import may have written something', () => {
    expect(fileErrorMessage(new NetworkError('timeout'))).toMatch(/some may have been imported/)
  })
})

describe('the errors table', () => {
  it('filters by column, by whole-row problems and by search', () => {
    expect(filterErrors(errors, { column: 'price', query: '' })).toHaveLength(2)
    expect(filterErrors(errors, { column: '-', query: '' }).map((e) => e.code)).toEqual(['duplicate_variant'])
    expect(filterErrors(errors, { column: '', query: '12' }).map((e) => e.row)).toEqual([12])
    expect(filterErrors(errors, { column: '', query: 'UNISEX' }).map((e) => e.row)).toEqual([3])
    expect(filterErrors(errors, { column: 'price', query: 'enter' }).map((e) => e.row)).toEqual([12])
  })

  it("lists the columns with errors in the template's order", () => {
    expect(errorColumns([...errors, { row: 4, column: 'zzz', code: 'c', message: 'm' }])).toEqual(['gender', 'price', 'zzz'])
    expect(TEMPLATE_COLUMNS.map((c) => c.name)).toContain('variant_sku')
  })
})

describe('the error report CSV', () => {
  it('has a header, one line per error, a byte order mark and CRLF lines', () => {
    const csv = errorReportCsv(errors.slice(0, 2))
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv.slice(1).split('\r\n')).toEqual([
      'row,column,code,message',
      '2,price,invalid_number,Use an amount in rupees such as 999',
      '3,gender,invalid_choice,"Use women, men or unisex"',
      '',
    ])
  })

  it('quotes cells that need it and defuses formulas', () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('two\nlines')).toBe('"two\nlines"')
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`)
    expect(csvCell('+1')).toBe("'+1")
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(csvCell('-2')).toBe("'-2")
    expect(csvCell('\t=1+1')).toBe("'\t=1+1")
    expect(csvCell('\r=1+1')).toBe(`"'\r=1+1"`)
    expect(csvCell('=A1,"x"\n')).toBe(`"'=A1,""x""\n"`)
    // Only a leading character makes a formula; one inside the text is harmless.
    expect(csvCell('a=b')).toBe('a=b')
    expect(csvCell(12)).toBe('12')
    expect(csvCell(null)).toBe('')
  })

  it('names the report after the file', () => {
    expect(errorReportName('Spring catalog.xlsx')).toBe('Spring-catalog-errors.csv')
    expect(errorReportName('.csv')).toBe('import-errors.csv')
  })
})

describe('canImport', () => {
  it('offers the import when there is something to create or confirm', () => {
    expect(canImport(report({ summary: { valid: 1, rejected: 3 } }))).toBe(true)
    expect(canImport(report({ summary: { valid: 0, unchanged: 2 } }))).toBe(true)
    expect(canImport(report({ summary: { valid: 0, unchanged: 0, rejected: 2 } }))).toBe(false)
  })
})
