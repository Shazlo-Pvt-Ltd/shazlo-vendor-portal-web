import { describe, expect, it } from 'vitest'
import { ApiError, NetworkError } from '../../api/errors'
import type { Schemas } from '../../api/model'
import {
  checkImportFile,
  csvCell,
  errorColumns,
  errorReportCsv,
  errorReportName,
  failedFileMessage,
  fileErrorMessage,
  filterErrors,
  formatBytes,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  rowNames,
  withRowNames,
} from './rules'

// Main's import rules (once features/import/rules.ts) on Build 2's wizard: what is checked in the
// browser before anything is sent, how failures read, and the error report.

type RowError = Schemas['ImportJob']['errors'][number]

const file = (name: string, size: number, type = '') => {
  const f = new File(['x'], name, { type })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

const errors: RowError[] = [
  { row: 2, product: null, column: 'Selling price', field: 'selling_price', code: 'invalid_number', message: 'Must be a number above 0, like 999.' },
  { row: 3, product: null, column: 'Gender', field: 'gender', code: 'invalid_value', message: 'Use Women, Men or Unisex.' },
  { row: 3, product: null, column: 'Whole row', field: null, code: 'duplicate_product', message: 'This product is on row 2 too.' },
  { row: 12, product: null, column: 'Selling price', field: 'selling_price', code: 'required', message: 'Required. Add the selling price.' },
  { row: 14, product: null, column: 'colour_code', field: null, code: 'x', message: 'Unknown.' },
]

describe('checking a file before sending it', () => {
  it('accepts a CSV or an Excel file within the limit', () => {
    expect(checkImportFile(file('products.csv', 10))).toBeUndefined()
    expect(checkImportFile(file('PRODUCTS.XLSX', IMPORT_MAX_BYTES))).toBeUndefined()
    expect(checkImportFile(file('export', 10, 'text/csv'))).toBeUndefined()
  })

  it('refuses another type (old .xls too), an empty file and one over the limit', () => {
    expect(checkImportFile(file('notes.txt', 10, 'text/plain'))).toBe('Upload the template as .xlsx or .csv.')
    expect(checkImportFile(file('old.xls', 10, 'application/vnd.ms-excel'))).toBe('Upload the template as .xlsx or .csv.')
    expect(checkImportFile(file('products.csv', 0))).toBe('This file is empty. Choose the file with your products.')
    expect(checkImportFile(file('products.csv', IMPORT_MAX_BYTES + 1))).toBe('This file is 2 MB; files can be up to 2 MB. Split it into smaller files and upload each one.')
  })

  it('states sizes in plain units', () => {
    expect(formatBytes(2 * 1024 * 1024)).toBe('2 MB')
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.5 MB')
    expect(formatBytes(300)).toBe('1 KB')
    expect(formatBytes(512 * 1024)).toBe('512 KB')
  })

  it('matches vendor-api\'s defaults', () => {
    expect(IMPORT_MAX_BYTES).toBe(2 * 1024 * 1024)
    expect(IMPORT_MAX_ROWS).toBe(1000)
  })
})

describe('when the whole file is refused', () => {
  const api = (status: number, code = 'c', message = 'x', retryAfter?: number) => new ApiError({ status, code, message, retryAfter })

  it('words 413, 415 and 422 for a seller', () => {
    expect(fileErrorMessage(api(413))).toBe('This file is too large; files can be up to 2 MB. Split it into smaller files and upload each one.')
    expect(fileErrorMessage(api(415))).toBe('This is not a .csv or .xlsx file. Save it as .xlsx or .csv and upload it again.')
    expect(fileErrorMessage(api(422, 'too_many_rows'))).toBe('This file has more than 1,000 rows. Split it into smaller files and upload each one.')
    expect(fileErrorMessage(api(422, 'missing_columns', 'The file has no column named mrp, sizes_stock'))).toBe(
      'We could not read this file. The file has no column named mrp, sizes_stock. Compare it with the template.',
    )
  })

  it('says how long to wait after too many imports', () => {
    expect(fileErrorMessage(api(429, 'rate_limited', 'x', 125))).toMatch(/in 3 minutes\.$/)
    expect(fileErrorMessage(api(429, 'rate_limited', 'x', 30))).toMatch(/in 1 minute\.$/)
  })

  it('says nothing was saved after a server failure or while only checking', () => {
    expect(fileErrorMessage(api(503))).toBe('Something went wrong on our side. Nothing was saved. Try again in a moment.')
    expect(fileErrorMessage(new NetworkError('network'))).toBe('We could not reach Shazlo. Check your connection and try again.')
    expect(fileErrorMessage(new NetworkError('timeout'))).toBe('The check took too long. Nothing was saved. Try again in a moment.')
  })

  it('warns that a timed-out save may have made some drafts', () => {
    expect(fileErrorMessage(new NetworkError('timeout'), { saving: true })).toBe('Saving took too long. Some drafts may have been made: check your drafts before trying again.')
  })

  it('words a file the check could not read', () => {
    expect(failedFileMessage({ code: 'too_many_rows', message: 'The file has more than 1000 rows.' })).toBe('This file has more than 1,000 rows. Split it into smaller files and upload each one.')
    expect(failedFileMessage({ code: 'missing_columns', message: 'The file has no column named mrp' })).toBe('We could not read this file. The file has no column named mrp. Compare it with the template.')
  })
})

describe('the list of rows to fix', () => {
  it('filters by column, by whole-row problems and by a search', () => {
    expect(filterErrors(errors, { column: 'Selling price', query: '' })).toHaveLength(2)
    expect(filterErrors(errors, { column: 'Whole row', query: '' }).map((e) => e.code)).toEqual(['duplicate_product'])
    expect(filterErrors(errors, { column: '', query: '12' }).map((e) => e.row)).toEqual([12])
    expect(filterErrors(errors, { column: '', query: 'UNISEX' }).map((e) => e.row)).toEqual([3])
    expect(filterErrors(errors, { column: 'Selling price', query: 'required' }).map((e) => e.row)).toEqual([12])
    expect(filterErrors([{ ...errors[0]!, product: 'Bagru Palazzo' }], { column: '', query: 'bagru' })).toHaveLength(1)
  })

  it('lists the columns with problems in the template\'s order, then the rest', () => {
    expect(errorColumns(errors)).toEqual(['Gender', 'Selling price', 'Whole row', 'colour_code'])
  })
})

describe('the error report', () => {
  it('has a header, one line per problem, a byte order mark and CRLF lines', () => {
    const csv = errorReportCsv([{ ...errors[0]!, product: 'Bagru Palazzo' }, errors[2]!])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv.slice(1).split('\r\n')).toEqual([
      'Row,Product,Column,What to fix',
      '2,Bagru Palazzo,Selling price,"Must be a number above 0, like 999."',
      '3,,Whole row,This product is on row 2 too.',
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
    // Only a leading character makes a formula; one inside the text is harmless, and a number is a number.
    expect(csvCell('a=b')).toBe('a=b')
    expect(csvCell(12)).toBe('12')
    expect(csvCell(null)).toBe('')
  })

  it('names the report after the file', () => {
    expect(errorReportName('Spring catalog.xlsx')).toBe('Spring-catalog-fixes.csv')
    expect(errorReportName('.csv')).toBe('import-fixes.csv')
    expect(errorReportName('../../etc/passwd.csv')).toBe('etc-passwd-fixes.csv')
  })
})

describe('naming the rows of a CSV', () => {
  const sheet = [
    'Product name,gender,selling_price',
    'Relaxed Linen Shirt,Men,1899',
    '"Kurta, ""Indigo""",Women,1499',
    '',
    '"Two',
    'line name",Women,999',
    '=cmd,Women,1',
  ].join('\r\n')

  it('numbers records as vendor-api does (header is row 1; blank rows count) and reads quoted cells', () => {
    expect([...rowNames(sheet).entries()]).toEqual([
      [2, 'Relaxed Linen Shirt'],
      [3, 'Kurta, "Indigo"'],
      // A quoted cell keeps its line break as written.
      [5, 'Two\r\nline name'],
      [6, '=cmd'],
    ])
  })

  it('reads a sheet saved with semicolons, and one with a byte order mark', () => {
    expect(rowNames('\uFEFFproduct_name;gender\nShirt;Men').get(2)).toBe('Shirt')
  })

  it('names nothing when there is no product name column', () => {
    expect(rowNames('title,gender\nShirt,Men').size).toBe(0)
  })

  it('puts the names on the problems', () => {
    const named = withRowNames(errors, new Map([[2, 'Bagru Palazzo']]))
    expect(named[0]!.product).toBe('Bagru Palazzo')
    expect(named[1]!.product).toBeNull()
  })
})
