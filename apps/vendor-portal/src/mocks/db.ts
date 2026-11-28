import { garmentColour } from '@shazlo/ui'
import type { BusinessDetails, Contact, Delivery, PayOnDelivery, PayoutInput, ProductType, Returns } from '../api/model'
import type { ApiPhotoAngle, ApiSizeChartGroup } from '../api/wire'
import { sizeCode } from '../lib/catalog'
import { swatch, type SwatchVariant } from './swatch'

// An in-memory stand-in for vendor-api, in vendor-api's own records (revisions, assets,
// submissions), seeded with Build 2's demo seller, Kalki Studio. It serves the tests and the demo
// mode (VITE_MOCK_API=on). Nothing is kept in web storage: a reload starts again from the seed.
//
// Demo facts the screens and tests rely on:
// - Kiran (owner) signs in with DEMO_LOGIN; Meera (staff) with DEMO_STAFF; Asha is invited and has
//   no password yet. Ruchi Prints is suspended: DEMO_BLOCKED gets 403 vendor_not_allowed.
// - Store details are complete except payouts: missing = ['payout'], so no product can be
//   submitted until a payout is saved.
// - Commission is agreed at 12% (1200 bps); nothing is proposed.
// - 27 products: live, in review, drafts and two sent back. The sent-back Ajrakh kurta has no back
//   photo and only 2 try-on photos. The rust shirt is live with a change in review.
// - The brand page is live (version 1) with a saved draft (version 2) that changes the story and cover.
// - A size chart is saved for 'dresses' (kurtas, kurtis, dresses, co-ords and lehengas).

export const DEMO_LOGIN = { email: 'kiran@kalkistudio.in', password: 'ajrakh-indigo-26' }
export const DEMO_STAFF = { email: 'meera@kalkistudio.in', password: 'block-print-staff-26' }
export const DEMO_INVITED = 'asha@kalkistudio.in'
export const DEMO_BLOCKED = { email: 'ruchi@ruchiprints.in', password: 'suspended-shop-26' }
export const CLOUD_NAME = 'shazlo-demo'
export const ACCESS_TTL_SECONDS = 900

export type VendorStatus = 'pending' | 'approved' | 'rejected' | 'suspended'
export type UserStatus = 'active' | 'invited' | 'disabled'

export interface VendorRecord {
  id: string
  name: string
  slug: string
  status: VendorStatus
  created_at: string
}

export interface UserRecord {
  id: string
  vendor_id: string
  email: string
  password: string | null
  role: 'owner' | 'staff'
  status: UserStatus
  verified: boolean
  last_login_at: string | null
  created_at: string
}

export interface VariantRecord {
  id: string
  sku: string
  size: string
  color: string
  price_paise: number | null
  mrp_paise: number | null
  is_active: boolean
  stock: number
}

export interface ImageRecord {
  asset_id: string
  alt_text: string | null
  angle: ApiPhotoAngle
}

export interface ContentRecord {
  title: string
  description: string | null
  category: string | null
  subcategory: string | null
  gender: 'women' | 'men' | 'unisex' | null
  fabric: string | null
  weight_grams: number | null
  returnable: boolean
  return_window_days: number | null
  main_colour: string | null
  other_colours: string[]
  variants: VariantRecord[]
  images: ImageRecord[]
}

export type RevisionState = 'live' | 'editing' | 'in_review' | 'rejected' | 'withdrawn'

export interface RevisionRecord {
  id: string
  version: number
  state: RevisionState
  content: ContentRecord
  submitted_at: string | null
  review: { status: 'pending' | 'approved' | 'rejected'; reason: string | null; reason_code: string | null; decided_at: string | null } | null
  updated_at: string
}

export type ProductStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'archived'

export interface ProductRecord {
  id: string
  vendor_id: string
  sku: string
  status: ProductStatus
  version: number
  created_at: string
  updated_at: string
  live: RevisionRecord | null
  working: RevisionRecord | null
  ever_submitted: boolean
}

export interface AssetRecord {
  id: string
  vendor_id: string
  kind: 'brand_logo' | 'brand_banner' | 'product_image' | 'size_chart'
  public_id: string
  url: string
  status: 'pending' | 'ready'
  bytes: number | null
  format: string | null
  width: number | null
  height: number | null
  created_at: string
}

export interface SubmissionRecord {
  id: string
  vendor_id: string
  subject: 'brand_profile' | 'product'
  product_id: string | null
  /** Whether the product had a live version when this one was sent (proposed `was_live`). */
  was_live: boolean
  sku: string | null
  title: string | null
  version: number
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn'
  reason: string | null
  /** What kind of problem the reviewer picked, beside the reason; absent is none. */
  reason_code?: string | null
  submitted_at: string
  decided_at: string | null
}

export interface BrandContent {
  brand_name: string
  based_in: string | null
  tagline: string | null
  about: string | null
  logo_asset_id: string | null
  banner_asset_id: string | null
  website_url: string | null
  instagram_handle: string | null
  categories: string[]
  price_min_paise: number
  price_max_paise: number
}

export interface BrandVersion {
  id: string
  version: number
  state: 'draft' | 'pending_review' | 'published' | 'rejected' | 'superseded'
  content: BrandContent
  submitted_at: string | null
  published_at: string | null
  updated_at: string
}

/** The server's copy of the store details: the payout keeps the full account number. */
export interface StoreRecord {
  sells: 'women' | 'men' | 'both' | null
  city: string | null
  instagram_or_website: string | null
  contact: Contact | null
  delivery: Delivery | null
  returns: Returns | null
  payment: PayOnDelivery | null
  payout: PayoutInput | null
  business: BusinessDetails
  updated_at: string | null
}

/** The brand's commission as vendor-api stores it (`updated_at` set by every change). */
export interface CommissionRecord {
  state: 'not_set' | 'proposed' | 'sent_back' | 'agreed'
  agreed_bps: number | null
  proposed_bps: number | null
  note: string | null
  updated_at?: string | null
}

export interface SizeChartRecord {
  measurements: Record<string, Record<string, number | null>>
  photo_asset_id: string | null
  updated_at: string | null
}

/** A failure the next matching request gets instead of its answer (for error states and the break-it tests). */
export interface Fault {
  method?: string
  /** Matched against the path's end, like `/v1/vendor/me`. */
  path: string
  status?: number
  code?: string
  message?: string
  details?: unknown
  /** No answer at all: the request fails like a dropped connection. */
  network?: boolean
}

export interface MockDb {
  now: () => Date
  seq: number
  vendors: VendorRecord[]
  users: UserRecord[]
  sessions: { access: Map<string, { userId: string; expires: number }>; refresh: Map<string, string> }
  /** The browser's `vendor_refresh` cookie (HttpOnly: the app can never read it, only send it). */
  cookie: { vendor_refresh: string | null }
  /** One-time links vendor-api would email: verify-email, reset or invite. */
  tokens: Map<string, { kind: 'verify' | 'reset' | 'invite'; userId: string }>
  emails: { to: string; kind: 'verify' | 'reset' | 'invite' | 'exists'; token: string | null }[]
  stores: Map<string, StoreRecord>
  commissions: Map<string, CommissionRecord>
  brands: Map<string, BrandVersion[]>
  sizeCharts: Map<string, Partial<Record<ApiSizeChartGroup, SizeChartRecord>>>
  products: ProductRecord[]
  assets: Map<string, AssetRecord>
  /** What the stand-in Cloudinary received, by public id: the URL it serves the file at. */
  uploads: Map<string, { url: string; bytes: number; format: string }>
  submissions: SubmissionRecord[]
  faults: Fault[]
  /**
   * The proposals made after the first review, each on by default. Turn one off to answer as
   * vendor-api does today: plain list rows and no list filters, no `product_id` on submissions, no
   * version check on a product save.
   */
  proposals: { productSummaries: boolean; submissionProductIds: boolean; productVersions: boolean }
}

// ---- ids -----------------------------------------------------------------------------------------

/** A version-4-shaped UUID from a counter, so ids are stable between runs. */
export function uuidFrom(n: number): string {
  const hex = n.toString(16).padStart(12, '0')
  return `00000000-0000-4000-8000-${hex}`
}

export function nextId(db: MockDb): string {
  db.seq += 1
  return uuidFrom(db.seq)
}

export function nextToken(db: MockDb, prefix: string): string {
  db.seq += 1
  return `${prefix}_${db.seq.toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

// ---- the demo catalogue --------------------------------------------------------------------------

const H = 3_600_000
const D = 24 * H

type Seed = [title: string, sku: string, category: ProductType, rupees: number | null, mrp: number | null, stock: number[] | null, status: ProductStatus, ageHours: number]

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
  // Colours in the seller's own words, and a shade picked with the colour picker (its hex code).
  'KS-BTK-037': ['Madder red', ['Black'], 'Cotton'],
  'KS-MHS-038': [garmentColour.Purple, [], 'Maheshwari silk-cotton'],
  'KS-DAB-042': ['Indigo', [], 'Cotton'],
}

/** The reviewer's reasons for the two sent-back products. */
export const REASONS: Record<string, string> = {
  'KS-AJR-014': 'Back photo is missing, and there are only 2 try-on photos. Add the back photo and 3 more try-on photos so shoppers can see the print and the fit.',
  'KS-KMJ-007': 'Price ₹3,999 does not match the MRP on the tag (₹3,499).',
}

const DEFAULT_SIZES = ['XS', 'S', 'M', 'L', 'XL']

function seedImages(db: MockDb, vendorId: string, sku: string, status: ProductStatus, at: string): ImageRecord[] {
  const named = (angles: readonly SwatchVariant[], tryons: number) => [
    ...angles.map((angle) => ({ angle: angle as ApiPhotoAngle, url: swatch(sku, angle) })),
    ...Array.from({ length: tryons }, (_, i) => ({ angle: 'tryon' as const, url: swatch(sku, 'tryon', i + 1) })),
  ]
  let photos: { angle: ApiPhotoAngle; url: string }[]
  if (sku === 'KS-AJR-014') photos = named(['front', 'detail', 'worn', 'extra'], 2)
  else if (sku === 'KS-KAL-011') photos = []
  else if (sku === 'KS-MHS-038') photos = named(['front'], 0)
  else if (status === 'draft') photos = named(['front', 'back', 'detail', 'worn'], 0)
  else photos = named(['front', 'back', 'detail', 'worn'], 5)
  return photos.map(({ angle, url }) => ({ asset_id: addAsset(db, vendorId, 'product_image', url, at).id, alt_text: null, angle }))
}

export function addAsset(db: MockDb, vendorId: string, kind: AssetRecord['kind'], url: string, at: string): AssetRecord {
  const id = nextId(db)
  const asset: AssetRecord = {
    id,
    vendor_id: vendorId,
    kind,
    public_id: `shazlo/vendors/${vendorId}/${kind}/${id}`,
    url,
    status: 'ready',
    bytes: 48_000,
    format: 'svg',
    width: 160,
    height: 200,
    created_at: at,
  }
  db.assets.set(id, asset)
  return asset
}

function seedProduct(db: MockDb, vendorId: string, [title, sku, category, rupees, mrp, stock, status, ageHours]: Seed, now: number): void {
  const at = (ms: number) => new Date(now - ms).toISOString()
  const updated = at(ageHours * H)
  const created = at(ageHours * H + 9 * D)
  const sizes = stock?.length === 1 ? ['One size'] : DEFAULT_SIZES
  const [main, others, material] = LOOKS[sku] ?? [null, [], '']
  const gender = sku === 'KS-KAL-011' ? null : category === 'Shirts' || category === 'Jackets' ? 'unisex' : 'women'
  const content = (price: number | null): ContentRecord => ({
    title,
    description: rupees === null ? null : `${title} in ${material.toLowerCase()}, hand block-printed and dyed with indigo and madder. Hand wash cold.`,
    category: category.toLowerCase(),
    subcategory: null,
    gender,
    fabric: material || null,
    weight_grams: null,
    returnable: false,
    return_window_days: null,
    main_colour: main,
    other_colours: others,
    variants: (stock ?? []).map((n, i) => ({
      id: nextId(db),
      sku: sizeCode(sku, sizes[i]!),
      size: sizes[i]!,
      color: '',
      price_paise: price,
      mrp_paise: mrp === null ? null : mrp * 100,
      is_active: true,
      stock: n,
    })),
    images: seedImages(db, vendorId, sku, status, created),
  })
  const submitted = status === 'draft' ? null : at(ageHours * H + (status === 'pending_review' ? 0 : 2 * H + 28 * 60_000))
  const decided = status === 'approved' || status === 'rejected' ? updated : null
  const id = nextId(db)
  const revision = (version: number, state: RevisionState, c: ContentRecord): RevisionRecord => ({
    id: nextId(db),
    version,
    state,
    content: c,
    submitted_at: state === 'editing' ? null : submitted,
    review:
      state === 'live'
        ? { status: 'approved', reason: null, reason_code: null, decided_at: decided }
        : state === 'rejected'
          ? { status: 'rejected', reason: REASONS[sku] ?? 'Photos need a plain background.', reason_code: 'photos', decided_at: decided }
          : state === 'in_review'
            ? { status: 'pending', reason: null, reason_code: null, decided_at: null }
            : null,
    updated_at: updated,
  })
  const price = rupees === null ? null : rupees * 100
  const record: ProductRecord = { id, vendor_id: vendorId, sku, status, version: 1, created_at: created, updated_at: updated, live: null, working: null, ever_submitted: status !== 'draft' }
  if (status === 'approved') record.live = revision(1, 'live', content(price))
  else if (status === 'rejected') record.working = revision(1, 'rejected', content(price))
  else if (status === 'pending_review') record.working = revision(1, 'in_review', content(price))
  else record.working = revision(1, 'editing', content(price))
  db.products.push(record)

  if (submitted) {
    db.submissions.push({
      id: nextId(db),
      vendor_id: vendorId,
      subject: 'product',
      product_id: id,
      was_live: false,
      sku,
      title,
      version: 1,
      status: status === 'approved' ? 'approved' : status === 'rejected' ? 'rejected' : 'pending',
      reason: status === 'rejected' ? (REASONS[sku] ?? 'Photos need a plain background.') : null,
      reason_code: status === 'rejected' ? 'photos' : null,
      submitted_at: submitted,
      decided_at: decided,
    })
  }

  // The rust shirt is live, with a new price waiting for review (V-06 "changes in review").
  if (sku === 'KS-HCS-003' && record.live) {
    const changeAt = at(20 * H)
    const changed = structuredClone(record.live.content)
    changed.variants = changed.variants.map((v) => ({ ...v, price_paise: 1199 * 100 }))
    record.working = { id: nextId(db), version: 2, state: 'in_review', content: changed, submitted_at: changeAt, review: { status: 'pending', reason: null, reason_code: null, decided_at: null }, updated_at: changeAt }
    db.submissions.push({ id: nextId(db), vendor_id: vendorId, subject: 'product', product_id: id, was_live: true, sku, title, version: 2, status: 'pending', reason: null, reason_code: null, submitted_at: changeAt, decided_at: null })
  }
}

// GSTIN 24AAKFK1234L1ZD: Gujarat (24), a firm's PAN, check character D.
export const KALKI_GSTIN = '24AAKFK1234L1ZD'

function seedStore(updatedAt: string): StoreRecord {
  return {
    sells: 'women',
    city: 'Ahmedabad, Gujarat',
    instagram_or_website: '@kalki.studio',
    contact: { name: 'Kiran Shah', phone: '9825012345', email: DEMO_LOGIN.email },
    delivery: { mode: 'shazlo', pickup_address: { line1: '14 Sahjanand Society, near Polytechnic', area: 'Ambawadi', city: 'Ahmedabad', pin: '380015' } },
    returns: { window_days: 7, condition: 'unworn_with_tags', refund_days: 5 },
    payment: { cash: true, upi: true },
    payout: null,
    business: { legal_name: 'Kalki Studio LLP', gstin: KALKI_GSTIN },
    updated_at: updatedAt,
  }
}

export function emptyStore(): StoreRecord {
  return { sells: null, city: null, instagram_or_website: null, contact: null, delivery: null, returns: null, payment: null, payout: null, business: { legal_name: null, gstin: null }, updated_at: null }
}

export const NOT_SET: CommissionRecord = { state: 'not_set', agreed_bps: null, proposed_bps: null, note: null, updated_at: null }

export function createDb({ now = () => new Date() }: { now?: () => Date } = {}): MockDb {
  const t = now().getTime()
  const at = (ms: number) => new Date(t - ms).toISOString()
  const db: MockDb = {
    now,
    seq: 0,
    vendors: [],
    users: [],
    sessions: { access: new Map(), refresh: new Map() },
    cookie: { vendor_refresh: null },
    tokens: new Map(),
    emails: [],
    stores: new Map(),
    commissions: new Map(),
    brands: new Map(),
    sizeCharts: new Map(),
    products: [],
    assets: new Map(),
    uploads: new Map(),
    submissions: [],
    faults: [],
    proposals: { productSummaries: true, submissionProductIds: true, productVersions: true },
  }

  const kalki: VendorRecord = { id: nextId(db), name: 'Kalki Studio', slug: 'kalki-studio', status: 'approved', created_at: at(30 * D) }
  const ruchi: VendorRecord = { id: nextId(db), name: 'Ruchi Prints', slug: 'ruchi-prints', status: 'suspended', created_at: at(60 * D) }
  db.vendors.push(kalki, ruchi)
  const user = (vendor: VendorRecord, email: string, password: string | null, role: 'owner' | 'staff', status: UserStatus, lastLogin: string | null): UserRecord => ({
    id: nextId(db), vendor_id: vendor.id, email, password, role, status, verified: status !== 'invited', last_login_at: lastLogin, created_at: at(29 * D),
  })
  db.users.push(
    user(kalki, DEMO_LOGIN.email, DEMO_LOGIN.password, 'owner', 'active', at(D)),
    user(kalki, DEMO_STAFF.email, DEMO_STAFF.password, 'staff', 'active', at(3 * D)),
    user(kalki, DEMO_INVITED, null, 'staff', 'invited', null),
    user(ruchi, DEMO_BLOCKED.email, DEMO_BLOCKED.password, 'owner', 'active', at(40 * D)),
  )
  const invited = db.users.find((u) => u.email === DEMO_INVITED)!
  db.tokens.set('invite-kalki-demo', { kind: 'invite', userId: invited.id })

  db.stores.set(kalki.id, seedStore(at(17 * D)))
  db.stores.set(ruchi.id, emptyStore())
  db.commissions.set(kalki.id, { state: 'agreed', agreed_bps: 1200, proposed_bps: null, note: null, updated_at: at(17 * D) })
  db.commissions.set(ruchi.id, NOT_SET)

  for (const seed of CATALOGUE) seedProduct(db, kalki.id, seed, t)

  const coverLive = addAsset(db, kalki.id, 'brand_banner', swatch('kalki-cover-live', 'detail'), at(12 * D))
  const coverDraft = addAsset(db, kalki.id, 'brand_banner', swatch('kalki-cover-draft', 'detail'), at(D))
  const live: BrandContent = {
    brand_name: 'Kalki Studio',
    based_in: 'Ahmedabad, Gujarat',
    // From before the brand page dropped its tagline: vendor-api still has the field, the portal
    // never shows it and clears it on save (BrandEditor.test.tsx relies on this old value).
    tagline: 'Hand block-printed, naturally dyed.',
    about: 'We work with Ajrakh printers in Kutch and dye every metre with indigo, madder and pomegranate rind.',
    logo_asset_id: null,
    banner_asset_id: coverLive.id,
    website_url: 'https://kalkistudio.in',
    instagram_handle: 'kalki.studio',
    categories: ['kurtas', 'dupattas', 'sarees'],
    price_min_paise: 89_900,
    price_max_paise: 599_900,
  }
  db.brands.set(kalki.id, [
    { id: nextId(db), version: 1, state: 'published', content: live, submitted_at: at(12 * D), published_at: at(11 * D), updated_at: at(11 * D) },
    { id: nextId(db), version: 2, state: 'draft', content: { ...live, banner_asset_id: coverDraft.id, about: `${live.about} Small batches, made to last.` }, submitted_at: null, published_at: null, updated_at: at(40 * 60_000) },
  ])
  db.submissions.push({ id: nextId(db), vendor_id: kalki.id, subject: 'brand_profile', product_id: null, was_live: false, sku: null, title: null, version: 1, status: 'approved', reason: null, reason_code: null, submitted_at: at(12 * D), decided_at: at(11 * D) })

  db.sizeCharts.set(kalki.id, {
    dresses: {
      measurements: {
        S: { bust: 86, waist: 72, hip: 94, length: 112 },
        M: { bust: 91, waist: 77, hip: 99, length: 113 },
        L: { bust: 96, waist: 82, hip: 104, length: 114 },
      },
      photo_asset_id: null,
      updated_at: at(9 * D),
    },
  })
  return db
}

