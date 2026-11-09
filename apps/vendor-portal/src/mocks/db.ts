import type { Schemas } from '../api/client'
import { swatch } from './swatch'

// In-memory stand-in for vendor-api, seeded with the wireframe's seller (Kalki Studio).
// Delete with src/mocks once vendor-api serves these routes.

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

export interface ImportRow {
  product_id: string
  name: string
  category: string
  description: string
  price_paise: number
  mrp_paise: number
  stock: number
  size: string
  gender: string
  fabric: string
}

export interface MockDb {
  now: () => Date
  vendor: Schemas['Me']['vendor']
  user: Schemas['Me']['user'] & { password: string }
  passwordSet: boolean
  sessions: { access: Map<string, number>; refresh: Set<string> }
  invites: Map<string, { email: string; brand_name: string; owner_name: string }>
  applications: (Schemas['VendorApplication'] & { id: string })[]
  products: ProductRecord[]
  brand: { live: BrandProfile | null; live_since: string | null; draft: BrandProfile | null; draft_saved_at: string | null; review: Schemas['ReviewState']; submitted_at: string | null }
  uploads: Map<string, string>
  imports: Map<string, ImportRecord>
  seq: number
  failNext: { path: string; status: number; code: string; message: string } | null
}

export const CATEGORIES = ['Kurtas', 'Kurtis', 'Sarees', 'Dupattas', 'Stoles', 'Jackets', 'Shirts', 'Skirts', 'Co-ords', 'Dresses', 'Palazzos']
export const GENDERS = ['Women', 'Men', 'Unisex']
export const FABRICS = ['Cotton (mul)', 'Cotton', 'Linen', 'Silk', 'Mashru silk', 'Kala cotton', 'Khadi', 'Chanderi']
export const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'One size']

const H = 3_600_000
const D = 24 * H

type Seed = [title: string, sku: string, category: string, rupees: number | null, mrp: number | null, stock: number[] | null, status: Product['status'], ageHours: number]

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

const REASONS: Record<string, string> = {
  'KS-AJR-014': 'Back photo is missing. Add front, back and a fabric close-up so shoppers can see the print.',
  'KS-KMJ-007': 'Price ₹3,999 does not match the MRP on the tag (₹3,499).',
}

const DEFAULT_SIZES = ['XS', 'S', 'M', 'L', 'XL']

function seedProduct([title, sku, category, rupees, mrp, stock, status, ageHours]: Seed, now: number, index: number): ProductRecord {
  const at = (ms: number) => new Date(now - ms).toISOString()
  const updated = at(ageHours * H)
  const created = at(ageHours * H + 9 * D)
  const sizes = stock?.length === 1 ? ['One size'] : DEFAULT_SIZES
  const variants = (stock ?? []).map((n, i) => ({ size: sizes[i]!, sku: `${sku}-${sizes[i] === 'One size' ? 'OS' : sizes[i]}`, stock: n }))
  const missingBack = sku === 'KS-AJR-014'
  const images: Product['images'] = status === 'draft' && rupees === null
    ? []
    : (['front', 'back', 'closeup'] as const)
        .filter((angle) => !(missingBack && angle === 'back'))
        .map((angle) => ({ id: `${sku}-${angle}`, url: swatch(sku, angle), angle }))
  if (missingBack) images.push({ id: `${sku}-extra`, url: swatch(sku, 'extra'), angle: 'extra' as const })

  const submitted = status === 'draft' ? null : at(ageHours * H + (status === 'pending_review' ? 0 : 2 * H + 28 * 60_000))
  const decided = status === 'approved' || status === 'rejected' ? updated : null
  const history: Product['history'] = [{ at: created, event: 'created' }]
  if (submitted) history.unshift({ at: submitted, event: 'submitted' })
  if (status === 'rejected') history.unshift({ at: updated, event: 'rejected', note: REASONS[sku] ?? 'Photos need a plain background.' })
  if (status === 'approved') history.unshift({ at: updated, event: 'approved' })

  return {
    id: `p_${String(index + 1).padStart(3, '0')}`,
    title,
    description: status === 'draft' && rupees === null ? '' : `${title} in hand block-printed cotton, dyed with indigo and madder. Hand wash cold.`,
    category,
    gender: category === 'Shirts' || category === 'Jackets' ? 'Unisex' : 'Women',
    fabric: category === 'Sarees' || category === 'Stoles' ? 'Silk' : 'Cotton (mul)',
    sku,
    status,
    price_paise: rupees === null ? null : rupees * 100,
    mrp_paise: mrp === null ? null : mrp * 100,
    images,
    variants,
    returns_use_default: true,
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
    thumbnail_url: images[0]?.url ?? null,
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
  cover_url: swatch('kalki-cover-live', 'closeup'),
  return_policy: '7_day',
  dispatch_time: '2_3_days',
  instagram: '@kalki.studio',
  website: 'kalkistudio.in',
}

export function createDb({ now = () => new Date() }: { now?: () => Date } = {}): MockDb {
  const t = now().getTime()
  const at = (ms: number) => new Date(t - ms).toISOString()
  return {
    now,
    vendor: { id: 'v_kalki', brand_name: 'Kalki Studio', status: 'approved', approved_at: at(17 * D), commission_bps: 1500 },
    user: { id: 'u_kiran', name: 'Kiran Shah', email: DEMO_LOGIN.identifier, password: DEMO_LOGIN.password },
    passwordSet: true,
    sessions: { access: new Map(), refresh: new Set() },
    invites: new Map([[DEMO_INVITE, { email: DEMO_LOGIN.identifier, brand_name: 'Kalki Studio', owner_name: 'Kiran Shah' }]]),
    applications: [],
    products: CATALOGUE.map((s, i) => seedProduct(s, t, i)),
    brand: {
      live: LIVE_BRAND,
      live_since: at(11 * D),
      draft: {
        ...LIVE_BRAND,
        cover_url: swatch('kalki-cover-draft', 'closeup'),
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
