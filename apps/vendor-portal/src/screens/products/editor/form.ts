import { z } from 'zod'
import type { Schemas } from '../../../api/client'
import { productEditorCopy } from '../../../copy/productEditor'
import { payout } from '../../../lib/format'

type Product = Schemas['Product']
type ProductInput = Schemas['ProductInput']

const SIZES: readonly string[] = productEditorCopy.options.sizes
const errors = productEditorCopy.price.errors

export type SizeRow = { size: string; stock: string }

// What the seller edits. Money stays as typed text ("2,499") until it is saved as paise.
export type EditorValues = {
  title: string
  description: string
  category: string
  gender: string
  fabric: string
  mrp: string
  price: string
  sizes: SizeRow[]
  returnsUseDefault: boolean
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

export const sizeIndex = (size: string) => {
  const i = SIZES.indexOf(size)
  return i === -1 ? SIZES.length : i
}

export const sortSizes = (rows: SizeRow[]) => [...rows].sort((a, b) => sizeIndex(a.size) - sizeIndex(b.size))

export const skuFor = (sku: string, size: string) => `${sku}-${size === 'One size' ? 'OS' : size}`

export const stockOf = (text: string) => Math.min(99_999, Number.parseInt(text, 10) || 0)

export function toValues(product: Product | null): EditorValues {
  return {
    title: product?.title ?? '',
    description: product?.description ?? '',
    category: product?.category ?? '',
    gender: product?.gender ?? '',
    fabric: product?.fabric ?? '',
    mrp: rupeesText(product?.mrp_paise),
    price: rupeesText(product?.price_paise),
    sizes: sortSizes((product?.variants ?? []).map((v) => ({ size: v.size, stock: String(v.stock) }))),
    returnsUseDefault: product?.returns_use_default ?? true,
  }
}

// One rule set for the inline errors and for what autosave may send.
export function priceIssues(values: Pick<EditorValues, 'mrp' | 'price'>, live: boolean): { mrp?: string; price?: string } {
  const issues: { mrp?: string; price?: string } = {}
  const mrp = parseRupees(values.mrp)
  const price = parseRupees(values.price)
  if (!mrp.ok) issues.mrp = errors.format
  else if (mrp.paise === null && live) issues.mrp = errors.liveNeedsMrp
  else if (mrp.paise !== null && mrp.paise <= 0) issues.mrp = errors.mrpZero
  if (!price.ok) issues.price = errors.format
  else if (price.paise === null && live) issues.price = errors.liveNeedsPrice
  else if (price.paise !== null && price.paise <= 0) issues.price = errors.sellingZero
  else if (price.paise !== null && mrp.ok && mrp.paise !== null && price.paise > mrp.paise) issues.price = errors.aboveMrp
  return issues
}

export function editorSchema(live: boolean) {
  return z
    .object({
      title: z.string(),
      description: z.string(),
      category: z.string(),
      gender: z.string(),
      fabric: z.string(),
      mrp: z.string(),
      price: z.string(),
      sizes: z.array(z.object({ size: z.string(), stock: z.string() })),
      returnsUseDefault: z.boolean(),
    })
    .superRefine((values, ctx) => {
      const issues = priceIssues(values, live)
      if (issues.mrp) ctx.addIssue({ code: 'custom', path: ['mrp'], message: issues.mrp })
      if (issues.price) ctx.addIssue({ code: 'custom', path: ['price'], message: issues.price })
    })
}

// What autosave sends. A price that fails the checks keeps the saved one, so a half-typed or
// wrong price never reaches the server (on a live product it would reach shoppers at once).
export function toInput(values: EditorValues, base: SavedBase): ProductInput {
  const issues = priceIssues(values, base.live)
  const ok = !issues.mrp && !issues.price
  const mrp = parseRupees(values.mrp)
  const price = parseRupees(values.price)
  return {
    title: values.title.trim(),
    description: values.description.trim(),
    category: values.category,
    gender: values.gender,
    fabric: values.fabric,
    mrp_paise: ok && mrp.ok ? mrp.paise : base.mrp,
    price_paise: ok && price.ok ? price.paise : base.price,
    variants: values.sizes.map((row) => ({ size: row.size, sku: base.sku ? skuFor(base.sku, row.size) : '', stock: stockOf(row.stock) })),
    returns_use_default: values.returnsUseDefault,
  }
}

// The card shows whole rupees: commission rounded to the rupee, and the seller's share is what
// is left, so the two always add up to the price.
export function payoutRupees(pricePaise: number, commissionBps: number): { commission: number; receive: number } {
  const commission = Math.round(payout(pricePaise, commissionBps).commission / 100) * 100
  return { commission, receive: pricePaise - commission }
}
