/**
 * Products: vendor-api keeps a product's content in revisions (`live` is what shoppers see,
 * `working` the one being edited or reviewed) with the price on every variant and images as assets
 * in positions. Build 2's screens see one product with a status, "changes in review", one price,
 * sizes with stock and photos in named slots.
 */
import { isNamedAngle, MAX_OTHER_COLOURS, sizeCode, sortSizes } from '../../lib/catalog'
import { remapFieldErrors } from '../errors'
import type { PhotoAngle, Product, ProductHistoryEntry, ProductInput, ProductSummary, ProductVersion, ReviewState, SubmitRequirement, Variant, WorkingVersion } from '../model'
import type { CreateProductBody, ImageBody, ImageOut, ProductContentBody, ProductOut, ProductSummaryIn, RevisionOut, VariantBody, VariantOut } from '../wire'
import {
  asArray,
  genderFromApi,
  genderToApi,
  isoOrNull,
  oneOf,
  productStatusFromApi,
  productTypeFromApi,
  productTypeToApi,
  textOrNull,
} from './common'

export const PHOTO_ANGLES = ['front', 'back', 'detail', 'worn', 'extra', 'tryon'] as const satisfies readonly PhotoAngle[]

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const positiveInt = (value: unknown): number | null => (Number.isInteger(value) && (value as number) > 0 ? (value as number) : null)
const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/** The revision the seller works on: the one being edited or reviewed, else the live one. */
export function sourceRevision(out: Pick<ProductOut, 'live' | 'working'>): RevisionOut | null {
  return (isObject(out.working) ? out.working : null) ?? (isObject(out.live) ? out.live : null)
}

function activeVariants(revision: RevisionOut | null): VariantOut[] {
  return asArray(revision?.variants).filter((v): v is VariantOut => isObject(v) && v.is_active !== false)
}

function imagesOf(revision: RevisionOut | null): ImageOut[] {
  return asArray(revision?.images)
    .filter((i): i is ImageOut => isObject(i) && typeof i.asset_id === 'string')
    .sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0))
}

function reviewOf(out: ProductOut): ReviewState {
  const working = isObject(out.working) ? out.working : null
  const live = isObject(out.live) ? out.live : null
  if (working?.state === 'in_review') {
    const at = isoOrNull(working.submitted_at)
    return at ? { state: 'waiting', at } : { state: 'waiting' }
  }
  if (working?.state === 'rejected') {
    const reason = textOrNull(working.review?.reason)
    const at = isoOrNull(working.review?.decided_at)
    return { state: 'rejected', ...(reason ? { reason } : {}), ...(at ? { at } : {}) }
  }
  if (live) {
    const at = isoOrNull(live.review?.decided_at) ?? isoOrNull(live.submitted_at)
    return at ? { state: 'approved', at } : { state: 'approved' }
  }
  return { state: 'none' }
}

function historyOf(out: ProductOut): ProductHistoryEntry[] {
  const entries: ProductHistoryEntry[] = []
  const created = isoOrNull(out.created_at)
  if (created) entries.push({ at: created, event: 'created' })
  for (const revision of [out.live, out.working]) {
    if (!isObject(revision)) continue
    const submitted = isoOrNull(revision.submitted_at)
    if (submitted) entries.push({ at: submitted, event: 'submitted' })
    const decided = isoOrNull(revision.review?.decided_at)
    if (decided && revision.review?.status === 'approved') entries.push({ at: decided, event: 'approved' })
    if (decided && revision.review?.status === 'rejected') {
      const note = textOrNull(revision.review.reason)
      entries.push({ at: decided, event: 'rejected', ...(note ? { note } : {}) })
    }
  }
  const updated = isoOrNull(out.updated_at)
  if (out.status === 'archived' && updated) entries.push({ at: updated, event: 'archived' })
  const seen = new Set<string>()
  return entries
    .filter((entry) => {
      const key = `${entry.event}@${entry.at}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
}

/** A revision's content as the screens show it: one price, sizes with stock, photos in slot order. */
function versionOf(revision: RevisionOut | null): ProductVersion {
  const variants = activeVariants(revision)
  const priced = variants.find((v) => positiveInt(v.price_paise) !== null)
  return {
    version: positiveInt(revision?.version) ?? 1,
    title: text(revision?.title),
    description: text(revision?.description),
    category: productTypeFromApi(revision?.category),
    gender: genderFromApi(revision?.gender),
    material: text(revision?.fabric),
    main_colour: textOrNull(revision?.main_colour),
    other_colours: asArray(revision?.other_colours).filter((c): c is string => typeof c === 'string').slice(0, MAX_OTHER_COLOURS),
    price_paise: priced ? positiveInt(priced.price_paise) : null,
    mrp_paise: priced ? positiveInt(priced.mrp_paise) : null,
    images: imagesOf(revision).map((image) => ({ id: image.asset_id, url: text(image.url), angle: oneOf(PHOTO_ANGLES, image.angle) ?? 'extra' })),
    variants: sortSizes(
      variants.map((v): Variant => ({ size: text(v.size), sku: text(v.sku), stock: Math.max(0, Math.trunc(Number(v.stock) || 0)) })),
      (v) => v.size,
    ),
  }
}

const WORKING_STATES = ['editing', 'in_review', 'rejected', 'withdrawn'] as const satisfies readonly WorkingVersion['state'][]

/** vendor-api's product (both revisions) as the editor's product. */
export function productFromApi(out: ProductOut): Product {
  const working = isObject(out.working) ? out.working : null
  const live = isObject(out.live) ? out.live : null
  const { version: _version, ...content } = versionOf(sourceRevision(out))
  return {
    id: text(out.id),
    ...content,
    sku: text(out.sku),
    status: productStatusFromApi(out.status),
    review: reviewOf(out),
    history: historyOf(out),
    updated_at: text(out.updated_at),
    edit_in_review: live !== null && working?.state === 'in_review',
    live: live ? versionOf(live) : null,
    working: working
      ? { version: positiveInt(working.version) ?? 1, state: oneOf(WORKING_STATES, working.state) ?? 'editing', submitted_at: isoOrNull(working.submitted_at) }
      : null,
  }
}

/** The list row for a product the portal has read in full. */
export function summaryFromProduct(p: Product): ProductSummary {
  const front = p.images.find((i) => i.angle === 'front') ?? p.images[0]
  return {
    id: p.id,
    title: p.title,
    sku: p.sku,
    category: p.category,
    main_colour: p.main_colour,
    status: p.status,
    price_paise: p.price_paise,
    mrp_paise: p.mrp_paise,
    stock: p.variants.length > 0 ? p.variants.reduce((sum, v) => sum + v.stock, 0) : null,
    thumbnail_url: front?.url ?? null,
    updated_at: p.updated_at,
    edit_in_review: p.edit_in_review,
    publishing: false,
  }
}

const SUMMARY_FIELDS = ['price_paise', 'mrp_paise', 'stock', 'thumbnail_url', 'main_colour', 'gender', 'working_state'] as const

/** True when a list row has the proposed fields (vendor-api with the proposal), so no product need be read in full. */
export function hasSummaryFields(row: object): boolean {
  return SUMMARY_FIELDS.every((field) => field in row)
}

/** A list row that carries its own fields (proposed `ProposedProductSummaryOut`) as the list shows it. */
export function summaryFromApi(row: ProductSummaryIn): ProductSummary {
  const status = productStatusFromApi(row.status)
  const stock = typeof row.stock === 'number' && Number.isFinite(row.stock) ? Math.max(0, Math.trunc(row.stock)) : null
  return {
    id: text(row.id),
    title: text(row.title),
    sku: text(row.sku),
    category: productTypeFromApi(row.category),
    main_colour: textOrNull(row.main_colour),
    status,
    price_paise: positiveInt(row.price_paise),
    mrp_paise: positiveInt(row.mrp_paise),
    stock,
    thumbnail_url: textOrNull(row.thumbnail_url),
    updated_at: text(row.updated_at),
    edit_in_review: status === 'approved' && row.working_state === 'in_review',
    publishing: false,
  }
}

// ---- writing -------------------------------------------------------------------------------------

function imageBodies(revision: RevisionOut | null): ImageBody[] {
  return imagesOf(revision).map((image) => ({
    asset_id: image.asset_id,
    alt_text: image.alt_text ?? null,
    angle: oneOf(PHOTO_ANGLES, image.angle) ?? 'extra',
  }))
}

function variantBodies(input: ProductInput, revision: RevisionOut | null, productCode: string): VariantBody[] {
  const existing = activeVariants(revision)
  const priced = existing.find((v) => positiveInt(v.price_paise) !== null)
  // An MRP can be there before any price is (a draft): keep it when only the price is sent.
  const withMrp = priced ?? existing.find((v) => positiveInt(v.mrp_paise) !== null)
  const price = input.price_paise !== undefined ? input.price_paise : (priced?.price_paise ?? null)
  const mrp = input.mrp_paise !== undefined ? input.mrp_paise : (withMrp?.mrp_paise ?? null)
  const sizes =
    input.variants ??
    existing.map((v): Variant => ({ size: text(v.size), sku: text(v.sku), stock: Math.max(0, Math.trunc(Number(v.stock) || 0)) }))
  return sizes.map((v) => {
    const same = existing.find((e) => e.size === v.size)
    return {
      sku: v.sku || same?.sku || sizeCode(productCode, v.size),
      size: v.size,
      color: same?.color ?? '',
      is_active: true,
      price_paise: price ?? null,
      mrp_paise: mrp ?? null,
      stock: Math.max(0, Math.trunc(Number(v.stock) || 0)),
    }
  })
}

/**
 * The PUT body for `input` applied to the product as the server has it. A PUT replaces the whole
 * revision, so everything the screens do not edit (weight, returns, subcategory, photos) is copied
 * from the revision being edited. Blank text is sent as null; the one price goes on every size.
 */
export function contentFromInput(input: ProductInput, base: ProductOut | null, newCode: () => string): ProductContentBody {
  const revision = base ? sourceRevision(base) : null
  const productCode = text(base?.sku) || newCode()
  const pick = <K extends keyof ProductInput>(key: K) => key in input && input[key] !== undefined
  const body: ProductContentBody = {
    title: pick('title') ? text(input.title).trim() : text(revision?.title),
    category: pick('category') ? productTypeToApi(input.category) : textOrNull(revision?.category),
    gender: pick('gender') ? genderToApi(input.gender) : genderToApi(genderFromApi(revision?.gender)),
    description: pick('description') ? textOrNull(input.description) : textOrNull(revision?.description),
    fabric: pick('material') ? textOrNull(input.material) : textOrNull(revision?.fabric),
    main_colour: pick('main_colour') ? textOrNull(input.main_colour) : textOrNull(revision?.main_colour),
    other_colours: (pick('other_colours') ? asArray(input.other_colours) : asArray(revision?.other_colours)).filter((c): c is string => typeof c === 'string').slice(0, MAX_OTHER_COLOURS),
    variants: variantBodies(input, revision, productCode),
    images: imageBodies(revision),
  }
  if (revision) {
    body.subcategory = revision.subcategory ?? null
    body.weight_grams = revision.weight_grams ?? null
    body.returnable = revision.returnable === true
    body.return_window_days = revision.return_window_days ?? null
  }
  return body
}

/** The POST body for a new product: `input` from nothing, with a portal-made code. */
export function createBodyFromInput(input: ProductInput, newCode: () => string): CreateProductBody {
  const sku = newCode()
  const body = contentFromInput(input, null, () => sku)
  return { sku, ...body }
}

// ---- photo slots (all go through the whole-content PUT) ------------------------------------------

export function addImage(content: ProductContentBody, image: { assetId: string; angle: PhotoAngle }): ProductContentBody {
  const images = asArray(content.images)
  const kept = isNamedAngle(image.angle) ? images.filter((i) => i.angle !== image.angle) : images
  return { ...content, images: [...kept, { asset_id: image.assetId, alt_text: null, angle: image.angle }] }
}

/** Moves a photo to another slot; a taken named slot swaps the two ("Make main photo" = front). */
export function moveImage(content: ProductContentBody, assetId: string, angle: PhotoAngle): ProductContentBody {
  const images = asArray(content.images)
  const moving = images.find((i) => i.asset_id === assetId)
  if (!moving) return content
  const from = moving.angle ?? 'extra'
  const taken = isNamedAngle(angle) ? images.find((i) => i.angle === angle && i.asset_id !== assetId) : undefined
  return {
    ...content,
    images: images.map((i) => {
      if (i.asset_id === assetId) return { ...i, angle }
      if (taken && i.asset_id === taken.asset_id) return { ...i, angle: from }
      return i
    }),
  }
}

export function removeImage(content: ProductContentBody, assetId: string): ProductContentBody {
  return { ...content, images: asArray(content.images).filter((i) => i.asset_id !== assetId) }
}

// ---- errors --------------------------------------------------------------------------------------

/** The editor's name for a field vendor-api names in a 422, or null when the editor has none. */
export function productInputField(key: string): string | null {
  const [head, , tail] = key.split('.')
  switch (head) {
    case 'title':
    case 'description':
    case 'category':
    case 'gender':
    case 'main_colour':
    case 'other_colours':
    case 'store_details':
    case 'price_paise':
      return head
    case 'fabric':
      return 'material'
    case 'images':
    case 'photos':
      return 'photos'
    case 'tryon_photos':
      return 'tryon'
    case 'variants':
      if (tail === 'price_paise' || tail === 'mrp_paise') return tail
      return 'variants'
    default:
      return null
  }
}

/** A refused save or submit, with its messages under the editor's names (SubmitRequirement keys). */
export function submitErrors(error: unknown): unknown {
  return remapFieldErrors(error, productInputField)
}

export const SUBMIT_REQUIREMENT_KEYS: readonly SubmitRequirement[] = [
  'title', 'gender', 'category', 'main_colour', 'material', 'description', 'photos', 'tryon', 'variants', 'price_paise', 'store_details',
]
