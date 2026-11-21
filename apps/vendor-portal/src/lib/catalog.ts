import { garmentColour, multicolourSwatch, type GarmentColourName } from '@shazlo/ui'
import type { Schemas } from '../api/model'
import { catalogCopy } from '../copy/catalog'

// The option lists and product rules of the seller portal, in one place. Screens and the mock API
// (src/mocks) both import from here, so a chip list, an import check and a submit check never
// disagree. Labels for every value are in src/copy/catalog.ts; format checks in ./validators.ts;
// store-details checks in ./storeDetails.ts. Spec: docs/ui-plan/vendor-requirements-and-phone-ux.md.

export type Gender = Schemas['Gender']
export type ProductType = Schemas['ProductType']
export type SizeChartGroup = Schemas['SizeChartGroup']
export type PhotoAngle = Schemas['PhotoAngle']
export type Sells = Schemas['Sells']
export type DeliveryDays = Schemas['DeliveryDays']
export type ReturnWindowDays = Schemas['ReturnWindowDays']
export type ReturnCondition = Schemas['ReturnCondition']
export type RefundDays = Schemas['RefundDays']
export type SubmitRequirement = Schemas['SubmitRequirement']
export type ImportColumn = Schemas['ImportColumn']

// ---- who it is for ----------------------------------------------------------------------------

export const GENDERS = ['Women', 'Men', 'Unisex'] as const satisfies readonly Gender[]
export const SELLS = ['women', 'men', 'both'] as const satisfies readonly Sells[]

export function isGender(value: unknown): value is Gender {
  return (GENDERS as readonly unknown[]).includes(value)
}

// ---- product types and size charts ------------------------------------------------------------

// Chip order: ethnic wear first, then western tops, dresses, bottoms and layers.
export const PRODUCT_TYPES = [
  'Kurtas', 'Kurtis', 'Sarees', 'Lehengas', 'Dupattas', 'Stoles',
  'Shirts', 'T-shirts', 'Tops', 'Dresses', 'Co-ords',
  'Skirts', 'Jeans', 'Trousers', 'Palazzos',
  'Jackets', 'Blazers',
] as const satisfies readonly ProductType[]

export function isProductType(value: unknown): value is ProductType {
  return (PRODUCT_TYPES as readonly unknown[]).includes(value)
}

export const SIZE_CHART_GROUPS = ['bottoms', 'tops', 'dresses', 'jackets'] as const satisfies readonly SizeChartGroup[]

export function isSizeChartGroup(value: unknown): value is SizeChartGroup {
  return (SIZE_CHART_GROUPS as readonly unknown[]).includes(value)
}

// Which brand size chart a product type uses (PDF §3). Kurtas, kurtis, co-ords and lehengas are
// measured like dresses (bust, waist, hip, length). Unstitched pieces have no chart.
export const SIZE_CHART_GROUP: Record<ProductType, SizeChartGroup | null> = {
  Kurtas: 'dresses',
  Kurtis: 'dresses',
  Sarees: null,
  Lehengas: 'dresses',
  Dupattas: null,
  Stoles: null,
  Shirts: 'tops',
  'T-shirts': 'tops',
  Tops: 'tops',
  Dresses: 'dresses',
  'Co-ords': 'dresses',
  Skirts: 'bottoms',
  Jeans: 'bottoms',
  Trousers: 'bottoms',
  Palazzos: 'bottoms',
  Jackets: 'jackets',
  Blazers: 'jackets',
}

export function sizeChartGroupFor(type: ProductType | null | undefined): SizeChartGroup | null {
  return type ? SIZE_CHART_GROUP[type] : null
}

// The product types that share a group's chart, for "Used for all your kurtas, kurtis…".
export function productTypesInGroup(group: SizeChartGroup): ProductType[] {
  return PRODUCT_TYPES.filter((t) => SIZE_CHART_GROUP[t] === group)
}

export const MEASUREMENTS = {
  bottoms: ['waist', 'hip', 'inseam', 'length'],
  tops: ['chest', 'shoulder', 'sleeve', 'length'],
  dresses: ['bust', 'waist', 'hip', 'length'],
  jackets: ['chest', 'shoulder', 'sleeve', 'length'],
} as const satisfies Record<SizeChartGroup, readonly string[]>

export type Measurement = (typeof MEASUREMENTS)[SizeChartGroup][number]

export function isMeasurementOf(group: SizeChartGroup, value: string): value is Measurement {
  return (MEASUREMENTS[group] as readonly string[]).includes(value)
}

// Size-chart values are centimetres above 0 and at most 300, with up to one decimal place.
export const MEASUREMENT_MAX_CM = 300

export function isValidMeasurement(value: unknown): value is number {
  // Whole tenths, at least one: 1e-12 is above 0 but is no tenth of a centimetre (vendor-api's rule).
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MEASUREMENT_MAX_CM && Math.round(value * 10) >= 1 && Math.abs(value * 10 - Math.round(value * 10)) < 1e-9
}

// ---- sizes ------------------------------------------------------------------------------------

export const LETTER_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'] as const
export const ONE_SIZE = 'One size'
export const WAIST_SIZES = Array.from({ length: 15 }, (_, i) => String(26 + i)) as readonly string[]
// Every size the API accepts, in the order sizes are listed everywhere.
export const ALL_SIZES: readonly string[] = [...LETTER_SIZES, ONE_SIZE, ...WAIST_SIZES]

const WAIST_SIZED: readonly ProductType[] = ['Jeans', 'Trousers']
const ONE_SIZE_ONLY: readonly ProductType[] = ['Sarees', 'Dupattas', 'Stoles']

export function isSize(value: unknown): value is string {
  return typeof value === 'string' && ALL_SIZES.includes(value)
}

// The size chips to offer for a product type. Jeans and trousers add waist sizes 26–40; sarees,
// dupattas and stoles come in one size. With no type chosen yet, every size.
export function sizesForType(type: ProductType | null | undefined): readonly string[] {
  if (!type) return ALL_SIZES
  if (ONE_SIZE_ONLY.includes(type)) return [ONE_SIZE]
  if (WAIST_SIZED.includes(type)) return [...LETTER_SIZES, ...WAIST_SIZES]
  return [...LETTER_SIZES, ONE_SIZE]
}

export function sizeRank(size: string): number {
  const i = ALL_SIZES.indexOf(size)
  return i === -1 ? ALL_SIZES.length : i
}

export function sortSizes<T>(items: readonly T[], sizeOf: (item: T) => string): T[] {
  return [...items].sort((a, b) => sizeRank(sizeOf(a)) - sizeRank(sizeOf(b)))
}

// The automatic product code for one size: KS-AJR-014 + M → KS-AJR-014-M.
export function sizeCode(productCode: string, size: string): string {
  return `${productCode}-${size === ONE_SIZE ? 'OS' : size}`
}

// ---- colours ----------------------------------------------------------------------------------

export interface Colour {
  name: string
  // Solid colour for a swatch; null for Multicolour, which uses `swatch`.
  hex: string | null
  // CSS background for the swatch (the hex, or a gradient for Multicolour).
  swatch: string
  // Light colours need a 1px border to show on a white or cream surface (WCAG 1.4.11).
  border: boolean
}

// The hex values are named tokens in @shazlo/ui (garmentColour), like every colour in the app.
const solid = (name: GarmentColourName, border = false): Colour => ({ name, hex: garmentColour[name], swatch: garmentColour[name], border })

export const COLOURS: readonly Colour[] = [
  solid('Black'),
  solid('White', true),
  solid('Ivory', true),
  solid('Beige', true),
  solid('Brown'),
  solid('Rust'),
  solid('Maroon'),
  solid('Red'),
  solid('Pink'),
  solid('Peach', true),
  solid('Orange'),
  solid('Mustard'),
  solid('Yellow', true),
  solid('Olive'),
  solid('Green'),
  solid('Sage'),
  solid('Teal'),
  solid('Blue'),
  solid('Indigo'),
  solid('Navy'),
  solid('Purple'),
  solid('Lavender', true),
  solid('Grey'),
  solid('Gold'),
  solid('Silver', true),
  {
    name: 'Multicolour',
    hex: null,
    swatch: multicolourSwatch,
    border: false,
  },
]

export const COLOUR_NAMES: readonly string[] = COLOURS.map((c) => c.name)
export const MAX_OTHER_COLOURS = 2

export function colourByName(name: string | null | undefined): Colour | null {
  return COLOURS.find((c) => c.name === name) ?? null
}

export function isColour(value: unknown): value is string {
  return typeof value === 'string' && COLOUR_NAMES.includes(value)
}

// ---- photos -----------------------------------------------------------------------------------

// The 4 required product photos, one each, in slot order. Then up to 4 extras, and 5 try-on
// photos of real people wearing it.
export const NAMED_PHOTO_ANGLES = ['front', 'back', 'detail', 'worn'] as const satisfies readonly PhotoAngle[]
export type NamedPhotoAngle = (typeof NAMED_PHOTO_ANGLES)[number]
export const MAX_EXTRA_PHOTOS = 4
export const TRYON_REQUIRED = 5
export const MAX_TRYON_PHOTOS = 5

export function isNamedAngle(angle: string): angle is NamedPhotoAngle {
  return (NAMED_PHOTO_ANGLES as readonly string[]).includes(angle)
}

type ImageLike = { angle: PhotoAngle }

export function missingNamedPhotos(images: readonly ImageLike[]): NamedPhotoAngle[] {
  return NAMED_PHOTO_ANGLES.filter((a) => !images.some((i) => i.angle === a))
}

export function tryonCount(images: readonly ImageLike[]): number {
  return images.filter((i) => i.angle === 'tryon').length
}

// ---- what a product needs before it can be sent for review ------------------------------------

export const SUBMIT_REQUIREMENTS = [
  'title', 'gender', 'category', 'main_colour', 'material', 'description',
  'photos', 'tryon', 'variants', 'price_paise', 'store_details',
] as const satisfies readonly SubmitRequirement[]

export type ProductForSubmit = Pick<
  Schemas['Product'],
  'title' | 'gender' | 'category' | 'main_colour' | 'material' | 'description' | 'images' | 'variants' | 'price_paise' | 'mrp_paise'
>

// Every missing requirement, keyed and ordered as the submit 422 lists them, with what to do in
// plain words. Empty when the product can be sent. MRP is optional; a selling price above it is
// still a problem.
export function productProblems(p: ProductForSubmit, { storeDetailsComplete }: { storeDetailsComplete: boolean }): Partial<Record<SubmitRequirement, string>> {
  const e = catalogCopy.errors.product
  const out: Partial<Record<SubmitRequirement, string>> = {}
  if (!p.title.trim()) out.title = e.titleRequired
  if (!p.gender) out.gender = e.genderRequired
  if (!p.category) out.category = e.categoryRequired
  if (!p.main_colour) out.main_colour = e.mainColourRequired
  if (!p.material.trim()) out.material = e.materialRequired
  if (!p.description.trim()) out.description = e.descriptionRequired
  const missing = missingNamedPhotos(p.images)
  if (missing.length) out.photos = e.photosMissing(missing.map((a) => catalogCopy.photoSlots[a]))
  const tryons = tryonCount(p.images)
  if (tryons < TRYON_REQUIRED) out.tryon = e.tryonMissing(TRYON_REQUIRED - tryons)
  if (p.variants.length === 0) out.variants = e.variantsRequired
  if (!p.price_paise) out.price_paise = e.priceRequired
  else if (p.mrp_paise && p.price_paise > p.mrp_paise) out.price_paise = e.priceAboveMrp
  if (!storeDetailsComplete) out.store_details = e.storeDetailsIncomplete
  return out
}

// ---- matching typed text to the lists (bulk import) -------------------------------------------

const simplify = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim()
const singular = (word: string) => word.replace(/s$/, '')

const TYPE_ALIASES: Record<string, ProductType> = {
  kurta: 'Kurtas', 'kurta set': 'Kurtas', anarkali: 'Kurtas', kurti: 'Kurtis', tunic: 'Kurtis',
  saree: 'Sarees', sari: 'Sarees', lehenga: 'Lehengas', 'lehenga choli': 'Lehengas', ghagra: 'Lehengas',
  dupatta: 'Dupattas', stole: 'Stoles', scarf: 'Stoles', shawl: 'Stoles',
  shirt: 'Shirts', overshirt: 'Shirts', tshirt: 'T-shirts', 't shirt': 'T-shirts', tee: 'T-shirts', top: 'Tops', blouse: 'Tops',
  dress: 'Dresses', 'co ord': 'Co-ords', coord: 'Co-ords', 'co ord set': 'Co-ords',
  skirt: 'Skirts', jean: 'Jeans', denim: 'Jeans', trouser: 'Trousers', pant: 'Trousers', pants: 'Trousers', palazzo: 'Palazzos',
  jacket: 'Jackets', 'nehru jacket': 'Jackets', blazer: 'Blazers',
}

// "kurta", "KURTAS", "T shirt", "co-ord set" → the product type; null when nothing matches.
export function matchProductType(text: string): ProductType | null {
  const v = simplify(text)
  if (!v) return null
  const exact = PRODUCT_TYPES.find((t) => simplify(t) === v)
  if (exact) return exact
  return TYPE_ALIASES[v] ?? TYPE_ALIASES[singular(v)] ?? PRODUCT_TYPES.find((t) => singular(simplify(t)) === singular(v)) ?? null
}

// A suggestion for text that is not a product type: the first type sharing a word with it.
export function closestProductType(text: string): ProductType | null {
  const words = simplify(text).split(' ').filter(Boolean).map(singular)
  for (const word of words) {
    const hit = matchProductType(word)
    if (hit) return hit
  }
  return null
}

const COLOUR_ALIASES: Record<string, string> = {
  multi: 'Multicolour', multicolor: 'Multicolour', 'multi colour': 'Multicolour', 'multi color': 'Multicolour', multicoloured: 'Multicolour',
  'off white': 'Ivory', cream: 'Ivory', offwhite: 'Ivory', gray: 'Grey', 'navy blue': 'Navy', golden: 'Gold',
  'mustard yellow': 'Mustard', wine: 'Maroon', 'sky blue': 'Blue', 'olive green': 'Olive', 'sage green': 'Sage',
}

// "indigo", "Off-white", "multicolor" → the named colour; null when nothing matches.
export function matchColour(text: string): string | null {
  const v = simplify(text)
  if (!v) return null
  return COLOURS.find((c) => simplify(c.name) === v)?.name ?? COLOUR_ALIASES[v] ?? null
}

// A suggestion for text that is not one of the colours: a colour named inside it ("dark green").
export function closestColour(text: string): string | null {
  for (const word of simplify(text).split(' ')) {
    const hit = matchColour(word)
    if (hit) return hit
  }
  return null
}

const GENDER_ALIASES: Record<string, Gender> = {
  women: 'Women', woman: 'Women', female: 'Women', ladies: 'Women', womens: 'Women',
  men: 'Men', man: 'Men', male: 'Men', gents: 'Men', mens: 'Men',
  unisex: 'Unisex', all: 'Unisex', both: 'Unisex',
}

export function matchGender(text: string): Gender | null {
  return GENDER_ALIASES[simplify(text).replace(/ /g, '')] ?? null
}

// Size text as sellers type it: "s", "xxl", "2XL", "free size", "30".
export function matchSize(text: string): string | null {
  const v = text.trim().toUpperCase().replace(/\s+/g, ' ')
  if (ALL_SIZES.includes(v)) return v
  if (v === '2XL') return 'XXL'
  if (v === 'XXXL') return '3XL'
  if (['ONE SIZE', 'ONESIZE', 'FREE SIZE', 'FREESIZE', 'OS'].includes(v)) return ONE_SIZE
  return null
}

export type SizesStockResult =
  | { ok: true; sizes: { size: string; stock: number }[] }
  | { ok: false; problem: 'empty' | 'format' | 'size' | 'duplicate'; value: string }

// "S:4, M:6, L:3, XL:0" → sizes with stock. Commas or semicolons between sizes; a colon, "=" or
// "-" between size and stock. Sold-out sizes are kept with 0.
export function parseSizesStock(text: string): SizesStockResult {
  const parts = text.split(/[,;]/).map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) return { ok: false, problem: 'empty', value: text }
  const sizes: { size: string; stock: number }[] = []
  for (const part of parts) {
    const m = /^(.+?)\s*[:=-]\s*(\d{1,5})$/.exec(part)
    if (!m) return { ok: false, problem: 'format', value: part }
    const size = matchSize(m[1]!)
    if (!size) return { ok: false, problem: 'size', value: m[1]!.trim() }
    if (sizes.some((s) => s.size === size)) return { ok: false, problem: 'duplicate', value: size }
    sizes.push({ size, stock: Number(m[2]) })
  }
  return { ok: true, sizes: sortSizes(sizes, (s) => s.size) }
}

// The template's columns, in order (PDF §4). Labels are in catalogCopy.importColumns.
export const IMPORT_COLUMNS = [
  'product_name', 'gender', 'product_type', 'main_colour', 'other_colours',
  'selling_price', 'sizes_stock', 'description', 'material', 'mrp',
] as const satisfies readonly ImportColumn[]

export const OPTIONAL_IMPORT_COLUMNS: readonly ImportColumn[] = ['other_colours', 'mrp']

// ---- photos picked after an import, matched to products by name -------------------------------

const ANGLE_WORDS: Record<string, PhotoAngle> = {
  front: 'front', back: 'back', detail: 'detail', closeup: 'detail', 'close up': 'detail', worn: 'worn', model: 'worn',
  extra: 'extra', tryon: 'tryon', 'try on': 'tryon',
}

// "Ajrakh Cotton Kurta - back.jpg" → the product named "Ajrakh Cotton Kurta" and the back slot.
// A trailing number is ignored ("…_tryon2.jpg", "… front 1.png"); with no slot word the angle is
// null and the screen fills the next empty slot. Null when no product has that name.
export function matchPhotoFile<P extends { id: string; title: string }>(fileName: string, products: readonly P[]): { product: P; angle: PhotoAngle | null } | null {
  const full = simplify(fileName.replace(/\.[a-z0-9]{2,5}$/i, ''))
  const byName = (name: string) => products.find((p) => simplify(p.title) === name)
  const base = full.replace(/ \d{1,2}$/, '').replace(/(tryon|extra|front|back|detail|worn)\d{1,2}$/, '$1')
  for (const [word, slot] of Object.entries(ANGLE_WORDS)) {
    if (base.endsWith(` ${word}`)) {
      const product = byName(base.slice(0, base.length - word.length).trim())
      if (product) return { product, angle: slot }
      break
    }
  }
  // No slot word, or the "slot word" is part of the name ("Tie Back.jpg").
  const product = byName(full) ?? byName(base)
  return product ? { product, angle: null } : null
}
