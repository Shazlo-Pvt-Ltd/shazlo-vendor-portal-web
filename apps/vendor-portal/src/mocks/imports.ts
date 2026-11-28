import { catalogCopy } from '../copy/catalog'
import {
  checkColours,
  closestProductType,
  colourProblemText,
  IMPORT_COLUMNS,
  matchGender,
  matchProductType,
  MAX_OTHER_COLOURS,
  OPTIONAL_IMPORT_COLUMNS,
  parseColour,
  parseSizesStock,
  type ImportColumn,
} from '../lib/catalog'
import type { Gender, ProductType } from '../api/model'

// The bulk import as the proposal describes it: the requirements PDF's columns, one row per
// product, sizes and stock in one cell, prices in rupees. Photos are not in the sheet; the seller
// adds them by product name once the drafts exist.

const e = catalogCopy.errors.import
const labels = catalogCopy.importColumns

/** A row problem, as vendor-api's `RowErrorOut`; `column` is null for the whole row. */
export interface RowProblem {
  row: number
  column: ImportColumn | null
  code: string
  message: string
}

/** One ready row: one product with all its sizes. */
export interface ImportRow {
  row: number
  name: string
  gender: Gender
  category: ProductType
  main_colour: string
  other_colours: string[]
  price_paise: number
  mrp_paise: number | null
  variants: { size: string; stock: number }[]
  description: string
  material: string
}

export interface CheckedSheet {
  rowsRead: number
  rows: ImportRow[]
  problems: RowProblem[]
  /** Header cells that are not template columns. */
  ignored: string[]
}

export const IMPORT_TEMPLATE = [
  IMPORT_COLUMNS.join(','),
  // The first row matches the example on the template step.
  'Relaxed Linen Shirt,Men,Shirts,Beige,White,1899,"S:4, M:6, L:3, XL:0",Relaxed shirt in washed linen with a camp collar. Machine wash cold.,100% linen,2499',
  'Linen Wide-Leg Trousers,Women,Trousers,Beige,,1899,"28:3, 30:5, 32:4",Relaxed trousers in washed linen with an elastic back.,100% linen,',
  '',
].join('\n')

export function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cell += '"'
        i += 1
      } else quoted = !quoted
    } else if (ch === ',' && !quoted) {
      out.push(cell)
      cell = ''
    } else cell += ch
  }
  out.push(cell)
  return out.map((c) => c.trim())
}

// "Product name", "MRP (optional)", "sizes & stock" → the template's column keys.
const headerKey = (cell: string) =>
  cell.toLowerCase().replace(/\(optional\)/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_')

const RUPEES = /^\d{1,7}(\.\d{1,2})?$/

function rupeesToPaise(text: string): number | null {
  return RUPEES.test(text) && Number(text) > 0 ? Math.round(Number(text) * 100) : null
}

/** Checks a CSV file: every ready row, and every problem with its row and column. */
export function checkCsv(text: string): CheckedSheet {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim())
  const headerCells = splitCsvLine(lines[0] ?? '')
  const header = headerCells.map(headerKey)
  const ignored = headerCells.filter((_, i) => !(IMPORT_COLUMNS as readonly string[]).includes(header[i] ?? ''))
  const missingColumns = IMPORT_COLUMNS.filter((c) => !OPTIONAL_IMPORT_COLUMNS.includes(c) && !header.includes(c))
  if (missingColumns.length) {
    return { rowsRead: 0, rows: [], ignored, problems: missingColumns.map((c) => ({ row: 1, column: c, code: 'missing_column', message: e.missingColumn })) }
  }

  const problems: RowProblem[] = []
  const rows: ImportRow[] = []
  const firstRowFor = new Map<string, number>()
  const body = lines.slice(1)
  body.forEach((line, i) => {
    const row = i + 2
    const cells = splitCsvLine(line)
    const cell = (c: ImportColumn) => cells[header.indexOf(c)] ?? ''
    const before = problems.length
    const problem = (column: ImportColumn | null, code: string, message: string) => problems.push({ row, column, code, message })

    const name = cell('product_name')
    if (!name) problem('product_name', 'required', e.nameRequired)
    else {
      const key = name.toLowerCase().replace(/\s+/g, ' ')
      const first = firstRowFor.get(key)
      if (first) problem('product_name', 'duplicate_product', e.nameRepeated(first))
      else firstRowFor.set(key, row)
    }

    const genderText = cell('gender')
    const gender = matchGender(genderText)
    if (!genderText) problem('gender', 'required', e.required(labels.gender))
    else if (!gender) problem('gender', 'invalid_value', e.gender(genderText))

    const typeText = cell('product_type')
    const category = matchProductType(typeText)
    if (!typeText) problem('product_type', 'required', e.required(labels.product_type))
    else if (!category) problem('product_type', 'invalid_value', e.productType(typeText, closestProductType(typeText)))

    // Any colour name or hex code, as in the editor (the listed colours are suggestions).
    const mainText = cell('main_colour')
    const parsedMain = parseColour(mainText)
    const main = parsedMain?.ok ? parsedMain.value : null
    if (!parsedMain) problem('main_colour', 'required', e.required(labels.main_colour))
    else if (!parsedMain.ok) problem('main_colour', 'invalid_value', e.colour(mainText, colourProblemText(parsedMain.problem)))

    const otherParts = cell('other_colours').split(/[,/;|]/).map((c) => c.trim()).filter(Boolean)
    const others: string[] = []
    for (const part of otherParts) {
      const parsed = parseColour(part)
      if (!parsed?.ok) {
        problem('other_colours', 'invalid_value', e.colour(part, colourProblemText(parsed?.problem ?? 'name')))
        break
      }
      others.push(parsed.value)
    }
    if (others.length === otherParts.length) {
      if (others.length > MAX_OTHER_COLOURS) problem('other_colours', 'too_many', e.otherColoursMax)
      else if (checkColours(main ?? '', others).other_colours) problem('other_colours', 'invalid_value', e.otherColoursRepeat)
    }

    const priceText = cell('selling_price')
    const price = rupeesToPaise(priceText)
    if (!priceText) problem('selling_price', 'required', e.required(labels.selling_price))
    else if (price === null) problem('selling_price', 'invalid_number', e.price(priceText))

    const sizesText = cell('sizes_stock')
    const sizes = parseSizesStock(sizesText)
    if (!sizes.ok) {
      const message = sizes.problem === 'empty' ? e.sizesEmpty
        : sizes.problem === 'format' ? e.sizesFormat(sizes.value)
          : sizes.problem === 'size' ? e.sizesUnknown(sizes.value)
            : e.sizesRepeat(sizes.value)
      problem('sizes_stock', 'invalid_value', message)
    }

    const description = cell('description')
    if (!description) problem('description', 'required', e.required(labels.description))

    const material = cell('material')
    if (!material) problem('material', 'required', e.required(labels.material))

    const mrpText = cell('mrp')
    const mrp = mrpText ? rupeesToPaise(mrpText) : null
    if (mrpText && mrp === null) problem('mrp', 'invalid_number', e.price(mrpText))
    else if (mrp !== null && price !== null && mrp < price) problem('mrp', 'invalid_value', e.mrpBelowPrice)

    if (problems.length === before && name && gender && category && main && price !== null && sizes.ok) {
      rows.push({ row, name, gender, category, main_colour: main, other_colours: others, price_paise: price, mrp_paise: mrp, variants: sizes.sizes, description, material })
    }
  })
  return { rowsRead: body.length, rows, problems, ignored }
}
