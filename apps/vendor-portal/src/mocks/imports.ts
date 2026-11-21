import type { Schemas } from '../api/client'
import { catalogCopy } from '../copy/catalog'
import {
  closestColour,
  closestProductType,
  IMPORT_COLUMNS,
  matchColour,
  matchGender,
  matchProductType,
  MAX_OTHER_COLOURS,
  OPTIONAL_IMPORT_COLUMNS,
  parseSizesStock,
  type ImportColumn,
} from '../lib/catalog'
import type { ImportRecord, ImportRow } from './db'

// Bulk import checks (V-08): the PDF §4 template, one row per product, sizes and stock in one cell.
// Photos are not in the sheet; the seller adds them by product name after the drafts exist.

const e = catalogCopy.errors.import
const labels = catalogCopy.importColumns
type ImportError = Schemas['ImportJob']['errors'][number]

export const IMPORT_TEMPLATE = [
  IMPORT_COLUMNS.join(','),
  // The first row matches the example on the template step (and the first test brand's linen shirts).
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

export function checkCsv(text: string, fileName: string, id: string): ImportRecord {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  const header = splitCsvLine(lines[0] ?? '').map(headerKey)
  const missingColumns = IMPORT_COLUMNS.filter((c) => !OPTIONAL_IMPORT_COLUMNS.includes(c) && !header.includes(c))
  const total = Math.max(0, lines.length - 1)
  if (missingColumns.length) {
    const errors = missingColumns.map((c): ImportError => ({ row: 1, product: null, column: labels[c], field: c, message: e.missingColumn }))
    return { id, status: 'failed', file_name: fileName, total_rows: total, ok_rows: 0, ok_products: 0, error_rows: total, errors, rows: [] }
  }

  const errors: ImportError[] = []
  const rows: ImportRow[] = []
  const firstRowFor = new Map<string, number>()
  lines.slice(1).forEach((line, i) => {
    const row = i + 2
    const cells = splitCsvLine(line)
    const cell = (c: ImportColumn) => cells[header.indexOf(c)] ?? ''
    const name = cell('product_name')
    const product = name || null
    const before = errors.length
    const problem = (field: ImportColumn, message: string) => errors.push({ row, product, column: labels[field], field, message })

    if (!name) problem('product_name', e.nameRequired)
    else {
      const key = name.toLowerCase().replace(/\s+/g, ' ')
      const first = firstRowFor.get(key)
      if (first) problem('product_name', e.nameRepeated(first))
      else firstRowFor.set(key, row)
    }

    const genderText = cell('gender')
    const gender = matchGender(genderText)
    if (!genderText) problem('gender', e.required(labels.gender))
    else if (!gender) problem('gender', e.gender(genderText))

    const typeText = cell('product_type')
    const category = matchProductType(typeText)
    if (!typeText) problem('product_type', e.required(labels.product_type))
    else if (!category) problem('product_type', e.productType(typeText, closestProductType(typeText)))

    const mainText = cell('main_colour')
    const main = matchColour(mainText)
    if (!mainText) problem('main_colour', e.required(labels.main_colour))
    else if (!main) problem('main_colour', e.colour(mainText, closestColour(mainText)))

    const otherParts = cell('other_colours').split(/[,/;|]/).map((c) => c.trim()).filter(Boolean)
    const others: string[] = []
    for (const part of otherParts) {
      const colour = matchColour(part)
      if (!colour) {
        problem('other_colours', e.colour(part, closestColour(part)))
        break
      }
      others.push(colour)
    }
    if (others.length === otherParts.length) {
      if (others.length > MAX_OTHER_COLOURS) problem('other_colours', e.otherColoursMax)
      else if (new Set(others).size < others.length || (main && others.includes(main))) problem('other_colours', e.otherColoursRepeat)
    }

    const priceText = cell('selling_price')
    const price = rupeesToPaise(priceText)
    if (!priceText) problem('selling_price', e.required(labels.selling_price))
    else if (price === null) problem('selling_price', e.price(priceText))

    const sizesText = cell('sizes_stock')
    const sizes = parseSizesStock(sizesText)
    if (!sizes.ok) {
      const message = sizes.problem === 'empty' ? e.sizesEmpty
        : sizes.problem === 'format' ? e.sizesFormat(sizes.value)
          : sizes.problem === 'size' ? e.sizesUnknown(sizes.value)
            : e.sizesRepeat(sizes.value)
      problem('sizes_stock', message)
    }

    const description = cell('description')
    if (!description) problem('description', e.required(labels.description))

    const material = cell('material')
    if (!material) problem('material', e.required(labels.material))

    const mrpText = cell('mrp')
    const mrp = mrpText ? rupeesToPaise(mrpText) : null
    if (mrpText && mrp === null) problem('mrp', e.price(mrpText))
    else if (mrp !== null && price !== null && mrp < price) problem('mrp', e.mrpBelowPrice)

    if (errors.length === before && gender && category && main && price !== null && sizes.ok) {
      rows.push({ row, name, gender, category, main_colour: main, other_colours: others, price_paise: price, mrp_paise: mrp, variants: sizes.sizes, description, material })
    }
  })
  return { id, status: 'ready', file_name: fileName, total_rows: total, ok_rows: rows.length, ok_products: rows.length, error_rows: total - rows.length, errors, rows }
}

// A spreadsheet the mock cannot read (.xlsx) gets the wireframe's example result (V-08).
export function exampleJob(fileName: string, id: string): ImportRecord {
  const bases: [string, Schemas['ProductType'], string, string][] = [
    ['Indigo Dabu Kurta', 'Kurtas', 'Indigo', 'Cotton'],
    ['Bagru Print Palazzo', 'Palazzos', 'Beige', 'Cotton'],
    ['Kala Cotton Jacket', 'Jackets', 'Brown', 'Kala cotton'],
    ['Mashru Silk Stole', 'Stoles', 'Mustard', 'Mashru silk'],
  ]
  const rows: ImportRow[] = Array.from({ length: 47 }, (_, i) => {
    const [base, category, main, material] = bases[i % 4]!
    const name = `${base} ${Math.floor(i / 4) + 1}`
    return {
      row: i + 2,
      name,
      gender: 'Women',
      category,
      main_colour: main,
      other_colours: [],
      price_paise: 149_900,
      mrp_paise: 169_900,
      variants: category === 'Stoles' ? [{ size: 'One size', stock: 6 }] : [{ size: 'S', stock: 4 }, { size: 'M', stock: 6 }],
      description: `${name}, hand block-printed in small batches.`,
      material,
    }
  })
  const err = (row: number, product: string | null, field: ImportColumn, message: string): ImportError => ({ row, product, column: labels[field], field, message })
  return {
    id,
    status: 'ready',
    file_name: fileName,
    total_rows: 52,
    ok_rows: 47,
    ok_products: 47,
    error_rows: 5,
    rows,
    errors: [
      err(12, 'Bagru Print Palazzo', 'selling_price', e.price('1,299/-')),
      err(19, 'Indigo Dabu Kurta', 'sizes_stock', e.sizesFormat('M 6')),
      err(27, 'Kala Cotton Jacket', 'main_colour', e.colour('Navy blue shade', closestColour('Navy blue shade'))),
      err(33, null, 'product_name', e.nameRequired),
      err(41, 'Mashru Silk Stole', 'product_type', e.productType('Shawls & wraps', closestProductType('Shawls & wraps'))),
    ],
  }
}
