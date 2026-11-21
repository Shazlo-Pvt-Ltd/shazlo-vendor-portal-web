import type { Schemas } from '../api/client'
import { sizeCode } from '../lib/catalog'
import { swatch } from './swatch'

// In-memory stand-in for vendor-api, seeded with the wireframe's seller (Kalki Studio).
// Delete with src/mocks once vendor-api serves these routes.
//
// Demo facts the screens and tests rely on:
// - Store details are complete except payouts: missing = ['payout'], so setup.store_details is
//   false and no product can be sent for review until a payout is saved.
// - Commission is agreed at 12% (1200 bps); nothing is proposed.
// - Live, in-review and the sent-back jacket have all 4 named photos and 5 try-on photos. The
//   sent-back Ajrakh kurta (p_001) has no back photo and only 2 try-on photos. Drafts are incomplete.
// - A size chart is saved for 'dresses' (kurtas, kurtis, dresses, co-ords and lehengas).

export const DEMO_LOGIN = { identifier: 'kiran@kalkistudio.in', password: 'ajrakh-indigo-26' }
export const DEMO_INVITE = 'invite-kalki-demo'

type Product = Schemas['Product']
type BrandProfile = Schemas['BrandProfile']

export interface ProductRecord extends Product {
  thumbnail_url: string | null
  submitted_at: string | null
  decided_at: string | null
  publishing: boolean
  edit_submitted_at: string | null
}

export type ImportRecord = Schemas['ImportJob'] & { rows: ImportRow[] }

// One ready spreadsheet row: one product with all its sizes.
export interface ImportRow {
  row: number
  name: string
  gender: Schemas['Gender']
  category: Schemas['ProductType']
  main_colour: string
  other_colours: string[]
  price_paise: number
  mrp_paise: number | null
  variants: { size: string; stock: number }[]
  description: string
  material: string
}

// The server's own copy of the store details: the payout keeps the full account number, which the
// API only ever returns masked.
export interface StoreRecord {
  sells: Schemas['Sells'] | null
  city: string | null
  instagram_or_website: string | null
  contact: Schemas['Contact'] | null
  delivery: Schemas['Delivery'] | null
  returns: Schemas['Returns'] | null
  pay_on_delivery: Schemas['PayOnDelivery'] | null
  payout: Schemas['PayoutInput'] | null
  business: Schemas['BusinessDetails']
  updated_at: string | null
}

export type SizeChartRecord = Omit<Schemas['SizeChart'], 'group'>

export interface MockDb {
  now: () => Date
  vendor: Omit<Schemas['Me']['vendor'], 'commission_bps' | 'commission'>
  user: Schemas['Me']['user'] & { password: string }
  passwordSet: boolean
  // `cookie` stands in for the browser's HttpOnly vendor_refresh cookie: the refresh token the
  // mock set last. It stays on the mock's side, so portal code never sees a refresh token.
  sessions: { access: Map<string, number>; refresh: Set<string>; cookie: string | null }
  invites: Map<string, { email: string; brand_name: string; owner_name: string }>
  applications: (Schemas['VendorApplication'] & { id: string })[]
  store: StoreRecord
  commission: Schemas['Commission']
  sizeCharts: Partial<Record<Schemas['SizeChartGroup'], SizeChartRecord>>
  products: ProductRecord[]
  brand: { live: BrandProfile | null; live_since: string | null; draft: BrandProfile | null; draft_saved_at: string | null; review: Schemas['ReviewState']; submitted_at: string | null }
  uploads: Map<string, string>
  imports: Map<string, ImportRecord>
  seq: number
  failNext: { path: string; status: number; code: string; message: string } | null
}

const H = 3_600_000
const D = 24 * H

type Seed = [title: string, sku: string, category: Schemas['ProductType'], rupees: number | null, mrp: number | null, stock: number[] | null, status: Product['status'], ageHours: number]

// Wireframe rows first (V-04, V-06, V-09), then the rest of the 27-product catalogue.
const CATALOGUE: Seed[] = [
  ['Ajrakh Block-Print Kurta', 'KS-AJR-014', 'Kurtas', 2499, 2999, [4, 8, 10, 6, 0], 'rejected', 2],
  ['Kutch Mirror-Work Jacket', 'KS-KMJ-007', 'Jackets', 3999, 3999, [2, 2, 2], 'rejected', 10 * 24 + 4],
  ['Bandhani Silk Dupatta', 'KS-BDN-022', 'Dupattas', 1850, 2200, [14], 'approved', 26],
  ['Handloom Cotton Shirt — Rust', 'KS-HCS-003', 'Shirts', 1299, 1499, [4, 6, 6, 6], 'approved', 27],
  ['Linen Co-ord Set — Indigo', 'KS-LCS-031', 'Co-ords', 2999, 3499, [2, 3, 3, 1], 'approved', 11 * 24],
  ['Chikankari Kurti — Ivory', 'KS-CHK-018', 'Kurtis', 1699, 1999, [0, 0, 0, 0], 'approved', 12 * 24],
  ['Dabu Print Wrap Skirt', 'KS-DAB-040', 'Skirts', 1450, 1650, [3, 4, 3, 2], 'pending_review', 19],
  ['Kala Cotton Overshirt', 'KS-KAL-011', 'Shirts', null, null, null, 'draft', 15 * 24],
  ['Pochampally Ikat Kurta', 'KS-PIK-027', 'Kurtas', 2299, 2599, [3, 5, 5, 2], 'pending_review', 6],
  ['Leheriya Cotton Dupatta', 'KS-LHR-019', 'Dupattas', 1150, 1350, [20], 'pending_review', 9],
  ['Bagru Print Palazzo', 'KS-BGR-033', 'Palazzos', 1350, 1600, [4, 6, 6, 4], 'pending_review', 30],
  ['Sanganeri Floral Kurta Set', 'KS-SNG-008', 'Kurtas', 2799, 3199, [2, 4, 4, 2], 'approved', 14 * 24],
  ['Mashru Silk Stole', 'KS-MSH-041', 'Stoles', 1999, 2299, [9], 'approved', 15 * 24],
  ['Kalamkari Cotton Saree', 'KS-KLM-002', 'Sarees', 4499, 4999, [5], 'approved', 16 * 24],
  ['Shibori Indigo Scarf', 'KS-SHB-036', 'Stoles', 899, 999, [31], 'approved', 16 * 24],
  ['Kantha Stitch Jacket', 'KS-KNT-012', 'Jackets', 3499, 3999, [1, 2, 2, 1], 'approved', 17 * 24],
  ['Jamdani Cotton Saree', 'KS-JMD-005', 'Sarees', 5999, 6499, [3], 'approved', 18 * 24],
  ['Phulkari Dupatta', 'KS-PHK-021', 'Dupattas', 2499, 2799, [7], 'approved', 19 * 24],
  ['Khadi Nehru Jacket', 'KS-KHD-015', 'Jackets', 2199, 2499, [2, 3, 3, 2, 1], 'approved', 20 * 24],
  ['Ajrakh Mul Dupatta', 'KS-AJR-020', 'Dupattas', 1599, 1799, [12], 'approved', 21 * 24],
  ['Ikat Cotton Wrap Dress', 'KS-IKT-029', 'Dresses', 2899, 3299, [2, 3, 3, 2], 'approved', 22 * 24],
  ['Chanderi Kurta — Sage', 'KS-CHN-010', 'Kurtas', 2399, 2699, [3, 4, 4, 3], 'approved', 23 * 24],
  ['Dabu Print Kurti', 'KS-DAB-016', 'Kurtis', 1299, 1499, [5, 6, 6, 4], 'approved', 24 * 24],
  ['Bandhej Anarkali', 'KS-BDJ-024', 'Kurtas', 3299, 3699, [1, 2, 2, 1], 'approved', 25 * 24],
  ['Batik Cotton Tunic', 'KS-BTK-037', 'Kurtis', 1199, 1399, [4, 4, 4, 2], 'approved', 26 * 24],
  ['Maheshwari Silk Stole', 'KS-MHS-038', 'Stoles', null, null, null, 'draft', 3 * 24],
  ['Indigo Dabu Co-ord', 'KS-DAB-042', 'Co-ords', 2699, 2999, [2, 2, 2], 'draft', 2 * 24],
]

// Main colour, other colours and material, as the seller wrote them.
const LOOKS: Record<string, [main: string | null, others: string[], material: string]> = {
  'KS-AJR-014': ['Indigo', ['Red', 'Black'], 'Cotton mul'],
  'KS-KMJ-007': ['Black', ['Red', 'Mustard'], 'Cotton with mirror work'],
  'KS-BDN-022': ['Red', ['Yellow'], 'Gajji silk'],
  'KS-HCS-003': ['Rust', [], 'Handloom cotton'],
  'KS-LCS-031': ['Indigo', [], '100% linen'],
  'KS-CHK-018': ['Ivory', [], 'Cotton mul'],
  'KS-DAB-040': ['Indigo', ['Beige'], 'Cotton'],
  'KS-KAL-011': [null, [], ''],
  'KS-PIK-027': ['Maroon', ['Ivory', 'Black'], 'Handloom ikat cotton'],
  'KS-LHR-019': ['Pink', ['Orange'], 'Cotton voile'],
  'KS-BGR-033': ['Beige', ['Black'], 'Cotton'],
  'KS-SNG-008': ['White', ['Pink', 'Green'], 'Cotton cambric'],
  'KS-MSH-041': ['Mustard', ['Maroon'], 'Mashru silk'],
  'KS-KLM-002': ['Multicolour', [], 'Cotton'],
  'KS-SHB-036': ['Indigo', ['White'], 'Cotton mul'],
  'KS-KNT-012': ['Multicolour', [], 'Upcycled cotton with kantha stitching'],
  'KS-JMD-005': ['White', ['Gold'], 'Handloom Jamdani cotton'],
  'KS-PHK-021': ['Orange', ['Pink', 'Yellow'], 'Cotton with silk-thread embroidery'],
  'KS-KHD-015': ['Grey', [], 'Khadi cotton'],
  'KS-AJR-020': ['Indigo', ['Red'], 'Cotton mul'],
  'KS-IKT-029': ['Teal', ['Ivory'], 'Handloom ikat cotton'],
  'KS-CHN-010': ['Sage', [], 'Chanderi silk-cotton'],
  'KS-DAB-016': ['Indigo', ['Ivory'], 'Cotton'],
  'KS-BDJ-024': ['Green', ['Red'], 'Modal silk'],
  'KS-BTK-037': ['Rust', ['Black'], 'Cotton'],
  'KS-MHS-038': ['Purple', [], 'Maheshwari silk-cotton'],
  'KS-DAB-042': ['Indigo', [], 'Cotton'],
}

// The overshirt draft has no gender yet; everything else follows its product type.
const GENDER: Record<string, Schemas['Gender'] | null> = { 'KS-KAL-011': null }

const REASONS: Record<string, string> = {
  'KS-AJR-014': 'Back photo is missing, and there are only 2 try-on photos. Add the back photo and 3 more try-on photos so shoppers can see the print and the fit.',
  'KS-KMJ-007': 'Price ₹3,999 does not match the MRP on the tag (₹3,499).',
}

const DEFAULT_SIZES = ['XS', 'S', 'M', 'L', 'XL']

type Image = Product['images'][number]

function photos(sku: string, angles: readonly ('front' | 'back' | 'detail' | 'worn' | 'extra')[], tryons: number): Image[] {
  const named = angles.map((angle) => ({ id: `${sku}-${angle}`, url: swatch(sku, angle), angle }))
  const tryon = Array.from({ length: tryons }, (_, i) => ({ id: `${sku}-tryon-${i + 1}`, url: swatch(sku, 'tryon', i + 1), angle: 'tryon' as const }))
  return [...named, ...tryon]
}

// Drafts stay incomplete: the overshirt has only a name and type, the Maheshwari stole a front
// photo and no price, the co-ord everything but its try-on photos.
function seedImages(sku: string, status: Product['status']): Image[] {
  if (sku === 'KS-AJR-014') return photos(sku, ['front', 'detail', 'worn', 'extra'], 2)
  if (sku === 'KS-KAL-011') return []
  if (sku === 'KS-MHS-038') return photos(sku, ['front'], 0)
  if (status === 'draft') return photos(sku, ['front', 'back', 'detail', 'worn'], 0)
  return photos(sku, ['front', 'back', 'detail', 'worn'], 5)
}

function seedProduct([title, sku, category, rupees, mrp, stock, status, ageHours]: Seed, now: number, index: number): ProductRecord {
  const at = (ms: number) => new Date(now - ms).toISOString()
  const updated = at(ageHours * H)
  const created = at(ageHours * H + 9 * D)
  const sizes = stock?.length === 1 ? ['One size'] : DEFAULT_SIZES
  const variants = (stock ?? []).map((n, i) => ({ size: sizes[i]!, sku: sizeCode(sku, sizes[i]!), stock: n }))
  const images = seedImages(sku, status)
  const [main_colour, other_colours, material] = LOOKS[sku] ?? [null, [], '']
  const gender = GENDER[sku]

  const submitted = status === 'draft' ? null : at(ageHours * H + (status === 'pending_review' ? 0 : 2 * H + 28 * 60_000))
  const decided = status === 'approved' || status === 'rejected' ? updated : null
  const history: Product['history'] = [{ at: created, event: 'created' }]
  if (submitted) history.unshift({ at: submitted, event: 'submitted' })
  if (status === 'rejected') history.unshift({ at: updated, event: 'rejected', note: REASONS[sku] ?? 'Photos need a plain background.' })
  if (status === 'approved') history.unshift({ at: updated, event: 'approved' })

  return {
    id: `p_${String(index + 1).padStart(3, '0')}`,
    title,
    description: rupees === null ? '' : `${title} in ${material.toLowerCase()}, hand block-printed and dyed with indigo and madder. Hand wash cold.`,
    category,
    gender: gender !== undefined ? gender : category === 'Shirts' || category === 'Jackets' ? 'Unisex' : 'Women',
    material,
    main_colour,
    other_colours,
    sku,
    status,
    price_paise: rupees === null ? null : rupees * 100,
    mrp_paise: mrp === null ? null : mrp * 100,
    images,
    variants,
    review: status === 'rejected'
      ? { state: 'rejected', reason: REASONS[sku] ?? 'Photos need a plain background.', at: updated }
      : status === 'approved'
        ? { state: 'approved', at: updated }
        : status === 'pending_review'
          ? { state: 'waiting', at: submitted ?? updated }
          : { state: 'none' },
    history,
    updated_at: updated,
    edit_in_review: sku === 'KS-HCS-003',
    thumbnail_url: images.find((i) => i.angle === 'front')?.url ?? null,
    submitted_at: submitted,
    decided_at: decided,
    publishing: sku === 'KS-LCS-031',
    edit_submitted_at: sku === 'KS-HCS-003' ? at(20 * H) : null,
  }
}

const LIVE_BRAND: BrandProfile = {
  brand_name: 'Kalki Studio',
  based_in: 'Ahmedabad, Gujarat',
  tagline: 'Hand block-printed, naturally dyed.',
  story: 'We work with Ajrakh printers in Kutch and dye every metre with indigo, madder and pomegranate rind.',
  logo_url: null,
  cover_url: swatch('kalki-cover-live', 'detail'),
  return_policy: '7_day',
  dispatch_time: '2_3_days',
  instagram: '@kalki.studio',
  website: 'kalkistudio.in',
}

// GSTIN 24AAKFK1234L1ZD: Gujarat (24), a firm's PAN, check character D.
export const KALKI_GSTIN = '24AAKFK1234L1ZD'

function seedStore(updatedAt: string): StoreRecord {
  return {
    sells: 'women',
    city: 'Ahmedabad, Gujarat',
    instagram_or_website: '@kalki.studio',
    contact: { name: 'Kiran Shah', phone: '9825012345', email: DEMO_LOGIN.identifier },
    delivery: { mode: 'shazlo', pickup_address: { line1: '14 Sahjanand Society, near Polytechnic', area: 'Ambawadi', city: 'Ahmedabad', pin: '380015' } },
    returns: { window_days: 7, condition: 'unworn_with_tags', refund_days: 5 },
    pay_on_delivery: { cash: true, upi: true },
    payout: null,
    business: { legal_name: 'Kalki Studio LLP', gstin: KALKI_GSTIN },
    updated_at: updatedAt,
  }
}

export function createDb({ now = () => new Date() }: { now?: () => Date } = {}): MockDb {
  const t = now().getTime()
  const at = (ms: number) => new Date(t - ms).toISOString()
  return {
    now,
    vendor: { id: 'v_kalki', brand_name: 'Kalki Studio', status: 'approved', approved_at: at(17 * D) },
    user: { id: 'u_kiran', name: 'Kiran Shah', email: DEMO_LOGIN.identifier, password: DEMO_LOGIN.password },
    passwordSet: true,
    sessions: { access: new Map(), refresh: new Set(), cookie: null },
    invites: new Map([[DEMO_INVITE, { email: DEMO_LOGIN.identifier, brand_name: 'Kalki Studio', owner_name: 'Kiran Shah' }]]),
    applications: [],
    store: seedStore(at(17 * D)),
    commission: { state: 'agreed', agreed_bps: 1200, proposed_bps: null, note: null, updated_at: at(17 * D) },
    sizeCharts: {
      dresses: {
        measurements: {
          S: { bust: 86, waist: 72, hip: 94, length: 112 },
          M: { bust: 91, waist: 77, hip: 99, length: 113 },
          L: { bust: 96, waist: 82, hip: 104, length: 114 },
        },
        photo_url: null,
        updated_at: at(9 * D),
      },
    },
    products: CATALOGUE.map((s, i) => seedProduct(s, t, i)),
    brand: {
      live: LIVE_BRAND,
      live_since: at(11 * D),
      draft: {
        ...LIVE_BRAND,
        cover_url: swatch('kalki-cover-draft', 'detail'),
        story: `${LIVE_BRAND.story} Small batches, made to last.`,
      },
      draft_saved_at: at(40 * 60_000),
      review: { state: 'approved', at: at(26 * H) },
      submitted_at: null,
    },
    uploads: new Map(),
    imports: new Map(),
    seq: 100,
    failNext: null,
  }
}

export function nextId(db: MockDb, prefix: string): string {
  db.seq += 1
  return `${prefix}_${db.seq}`
}
