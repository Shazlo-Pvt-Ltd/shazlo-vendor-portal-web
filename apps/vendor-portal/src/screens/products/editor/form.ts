import type { FieldErrors, Resolver } from 'react-hook-form'
import type { Schemas } from '../../../api/client'
import { productEditorCopy } from '../../../copy/productEditor'
import { sizeCode, sortSizes, type Gender, type ProductForSubmit, type ProductType } from '../../../lib/catalog'

type Product = Schemas['Product']
type ProductInput = Schemas['ProductInput']

const errors = productEditorCopy.price.errors
export const MAX_STOCK = 99_999

export type SizeRow = { size: string; stock: string }

// What the seller edits. Money and stock stay as typed text ("2,499") until they are saved.
export type EditorValues = {
  title: string
  gender: Gender | ''
  category: ProductType | ''
  mainColour: string
  otherColours: string[]
  material: string
  description: string
  sizes: SizeRow[]
  price: string
  mrp: string
}

// The last values the server holds, used where the form's own value is not safe to save.
export type SavedBase = { sku: string | null; price: number | null; mrp: number | null; live: boolean }

export function baseOf(product: Product | null): SavedBase {
  return { sku: product?.sku ?? null, price: product?.price_paise ?? null, mrp: product?.mrp_paise ?? null, live: product?.status === 'approved' }
}

const amount = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 })

export function rupeesText(paise: number | null | undefined): string {
  return paise == null ? '' : amount.format(paise / 100)
}

// "2,499", "2499", "₹ 2,499.50" → paise. Empty is null; anything else is not a price.
export function parseRupees(text: string): { ok: true; paise: number | null } | { ok: false } {
  const clean = text.replace(/[₹,\s]/g, '')
  if (!clean) return { ok: true, paise: null }
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(clean)) return { ok: false }
  return { ok: true, paise: Math.round(Number(clean) * 100) }
}

export const stockOf = (text: string) => Math.min(MAX_STOCK, Number.parseInt(text, 10) || 0)

export const sortRows = (rows: SizeRow[]) => sortSizes(rows, (r) => r.size)

export function toValues(product: Product | null): EditorValues {
  return {
    title: product?.title ?? '',
    gender: product?.gender ?? '',
    category: product?.category ?? '',
    mainColour: product?.main_colour ?? '',
    otherColours: product?.other_colours ?? [],
    material: product?.material ?? '',
    description: product?.description ?? '',
    sizes: sortRows((product?.variants ?? []).map((v) => ({ size: v.size, stock: String(v.stock) }))),
    price: rupeesText(product?.price_paise),
    mrp: rupeesText(product?.mrp_paise),
  }
}

// Format checks for the two prices, shown when the seller presses Next or Send. Whether a price is
// there at all is a send-for-review check (productProblems in src/lib/catalog.ts).
export function priceIssues(values: Pick<EditorValues, 'mrp' | 'price'>, live: boolean): { mrp?: string; price?: string } {
  const issues: { mrp?: string; price?: string } = {}
  const mrp = parseRupees(values.mrp)
  const price = parseRupees(values.price)
  if (!mrp.ok) issues.mrp = errors.format
  else if (mrp.paise !== null && mrp.paise <= 0) issues.mrp = errors.mrpZero
  if (!price.ok) issues.price = errors.format
  else if (price.paise === null && live) issues.price = errors.liveNeedsPrice
  else if (price.paise !== null && price.paise <= 0) issues.price = errors.sellingZero
  else if (price.paise !== null && mrp.ok && mrp.paise !== null && price.paise > mrp.paise) issues.price = errors.aboveMrp
  return issues
}

// The form's own checks: only the two price formats. Everything a product needs before review is
// checked when it is sent (productProblems), not while the seller types.
export function editorResolver(live: boolean): Resolver<EditorValues> {
  return (values) => {
    const issues = priceIssues(values, live)
    const errors: FieldErrors<EditorValues> = {}
    if (issues.mrp) errors.mrp = { type: 'custom', message: issues.mrp }
    if (issues.price) errors.price = { type: 'custom', message: issues.price }
    return Object.keys(errors).length ? { values: {}, errors } : { values, errors: {} }
  }
}

// Other colours never repeat the main colour (the API refuses that), so a new main colour drops
// itself from the others.
export const otherColoursFor = (values: Pick<EditorValues, 'mainColour' | 'otherColours'>) => values.otherColours.filter((c) => c !== values.mainColour)

// What autosave sends. A price that fails the checks keeps the saved one, so a half-typed or
// wrong price never reaches the server (on a live product it would reach shoppers at once).
export function toInput(values: EditorValues, base: SavedBase): ProductInput {
  const issues = priceIssues(values, base.live)
  const ok = !issues.mrp && !issues.price
  const mrp = parseRupees(values.mrp)
  const price = parseRupees(values.price)
  return {
    title: values.title.trim(),
    gender: values.gender || null,
    category: values.category || null,
    main_colour: values.mainColour || null,
    other_colours: otherColoursFor(values),
    material: values.material.trim(),
    description: values.description.trim(),
    mrp_paise: ok && mrp.ok ? mrp.paise : base.mrp,
    price_paise: ok && price.ok ? price.paise : base.price,
    variants: values.sizes.map((row) => ({ size: row.size, sku: base.sku ? sizeCode(base.sku, row.size) : '', stock: stockOf(row.stock) })),
  }
}

// The product as it stands on screen, for the send-for-review checks.
export function forSubmit(values: EditorValues, images: Product['images']): ProductForSubmit {
  const price = parseRupees(values.price)
  const mrp = parseRupees(values.mrp)
  return {
    title: values.title,
    gender: values.gender || null,
    category: values.category || null,
    main_colour: values.mainColour || null,
    material: values.material,
    description: values.description,
    images,
    variants: values.sizes.map((row) => ({ size: row.size, sku: '', stock: stockOf(row.stock) })),
    price_paise: price.ok ? price.paise : null,
    mrp_paise: mrp.ok ? mrp.paise : null,
  }
}

// Whole rupees for the "You receive" line: the commission rounded to the rupee, and the seller's
// share is what is left, so the two always add up to the price.
export function wholeRupees(split: { commission: number; receive: number }): { commission: number; receive: number } {
  const total = split.commission + split.receive
  const commission = Math.round(split.commission / 100) * 100
  return { commission, receive: total - commission }
}
