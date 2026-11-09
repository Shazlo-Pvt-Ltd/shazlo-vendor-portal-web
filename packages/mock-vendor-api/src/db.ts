import type { components } from './schema'
import { swatch } from './swatch'

// Seed data for the admin side of vendor-api: vendors, applications, products waiting for review,
// brand-page drafts and outbox events. Kalki Studio matches the seller portal's seed.
type S = components['schemas']
export type Version = S['ProductVersion']

export interface ProductRecord {
  id: string
  sku: string
  vendorId: string
  status: 'pending_review' | 'approved' | 'rejected'
  submittedAt: string
  resubmission: number
  change: 'new' | 'edit'
  submitted: Version
  compareTo: Version | null
  compareLabel: 'sent_back' | 'live' | null
  history: S['History']
}

export interface BrandRecord {
  vendorId: string
  status: 'pending_review' | 'approved' | 'rejected'
  submittedAt: string
  live: S['BrandProfile'] | null
  draft: S['BrandProfile']
  history: S['History']
}

export interface VendorRecord {
  id: string
  brand_name: string
  owner_name: string
  email: string
  phone: string
  city: string
  sells: string[]
  status: S['VendorStatus']
  live_products: number
  since: string
  commission_bps: number | null
  application: S['VendorDetail']['application']
  checks: S['VendorDetail']['checks']
  history: S['History']
}

export interface Decision {
  id: string
  subjectId: string
  kind: S['ItemKind']
  title: string
  vendorId: string
  decision: 'approved' | 'rejected'
  at: string
  reviewer: string
}

export interface MockVendorApi {
  now: () => Date
  vendors: VendorRecord[]
  products: ProductRecord[]
  brands: BrandRecord[]
  outbox: S['OutboxEvent'][]
  decisions: Decision[]
  seq: number
}

const H = 3_600_000
const D = 24 * H
const SIZES = ['XS', 'S', 'M', 'L', 'XL']

function version(sku: string, title: string, rupees: number, mrp: number, category: string, opts: Partial<Version> & { angles?: ('front' | 'back' | 'closeup' | 'extra')[]; stock?: number[] } = {}): Version {
  const angles = opts.angles ?? ['front', 'back', 'closeup']
  const stock = opts.stock ?? [3, 5, 6, 4, 2]
  const sizes = stock.length === 1 ? ['One size'] : SIZES.slice(0, stock.length)
  return {
    title,
    description: opts.description ?? `${title} in hand block-printed cotton, dyed with natural colours. Hand wash cold.`,
    category,
    gender: opts.gender ?? 'Women',
    fabric: opts.fabric ?? 'Cotton (mul)',
    price_paise: rupees * 100,
    mrp_paise: mrp * 100,
    variants: sizes.map((size, i) => ({ size, sku: `${sku}-${size === 'One size' ? 'OS' : size}`, stock: stock[i]! })),
    images: angles.map((angle) => ({ id: `${sku}-${angle}`, url: swatch(sku, angle), angle })),
  }
}

const brand = (tagline: string, story: string, basedIn: string, seed: string, extra: Partial<S['BrandProfile']> = {}): S['BrandProfile'] => ({
  tagline,
  story,
  based_in: basedIn,
  cover_url: swatch(seed, 'closeup'),
  logo_url: null,
  return_policy: '7_day',
  dispatch_time: '2_3_days',
  instagram: `@${seed}`,
  website: `${seed}.in`,
  ...extra,
})

type VendorSeed = [id: string, name: string, owner: string, city: string, sells: string[], status: S['VendorStatus'], live: number, ageDays: number, commission: number | null]
const VENDORS: VendorSeed[] = [
  ['v_kalki', 'Kalki Studio', 'Kiran Shah', 'Ahmedabad, Gujarat', ['Kurtas', 'Dupattas', 'Co-ords'], 'approved', 18, 26, 1500],
  ['v_nila', 'Nila Handloom', 'Ananya Rao', 'Bengaluru, Karnataka', ['Sarees', 'Dupattas'], 'approved', 24, 60, 1500],
  ['v_morpankh', 'Mor Pankh Clothing', 'Devansh Patel', 'Jaipur, Rajasthan', ['Kurtas', 'Dresses'], 'approved', 0, 3, 1500],
  ['v_kesariya', 'Kesariya Prints', 'Meera Joshi', 'Jaipur, Rajasthan', ['Kurtas', 'Palazzos'], 'approved', 31, 90, 1500],
  ['v_indigo', 'Indigo Loom', 'Arjun Mehta', 'Bagru, Rajasthan', ['Kurtas', 'Co-ords'], 'approved', 12, 45, 1500],
  ['v_bandhej', 'Bandhej House', 'Farah Khan', 'Bhuj, Gujarat', ['Sarees', 'Dupattas'], 'approved', 9, 38, 1200],
  ['v_sutra', 'Sutra Collective', 'Ishita Bose', 'Kolkata, West Bengal', ['Kurtis', 'Sarees'], 'approved', 15, 70, 1500],
  ['v_kutch', 'Kutch Kala', 'Ravi Ahir', 'Bhuj, Gujarat', ['Bags', 'Jackets'], 'approved', 7, 33, 1500],
  ['v_ambar', 'Ambar Textiles', 'Nikhil Shah', 'Surat, Gujarat', ['Stoles', 'Sarees'], 'approved', 11, 52, 1500],
  ['v_rangrez', 'Rangrez Studio', 'Zoya Ali', 'Lucknow, Uttar Pradesh', ['Kurtas', 'Kurtis'], 'approved', 20, 80, 1500],
  ['v_saanjh', 'Saanjh Label', 'Mehak Gill', 'Amritsar, Punjab', ['Dupattas', 'Kurtas'], 'applied', 0, 1, null],
  ['v_rann', 'Rann Weaves', 'Aarti Chauhan', 'Bhuj, Gujarat', ['Shawls', 'Stoles'], 'applied', 0, 2, null],
  ['v_kaaya', 'Kaaya Ethnic', 'Sana Mirza', 'Hyderabad, Telangana', ['Kurtas', 'Lehengas'], 'under_review', 0, 4, null],
  ['v_quick', 'QuickFashion Hub', 'Rohit Verma', 'Delhi', ['Kurtas'], 'rejected', 0, 20, null],
  ['v_trendz', 'Trendz Outlet', 'Karan Malhotra', 'Mumbai, Maharashtra', ['Kurtas', 'Dresses'], 'suspended', 0, 120, 1500],
]

const ABOUT: Record<string, string> = {
  v_saanjh: 'Phulkari embroidered by a collective of 40 women in villages around Amritsar. Each dupatta takes two to three weeks.',
  v_rann: 'Hand-woven Kala cotton and wool shawls from weavers in the Rann of Kutch, dyed with natural indigo.',
  v_kaaya: 'Hand-embroidered kurtas and lehengas from our workshop in the old city. We also resell some pieces from other labels.',
  v_quick: 'Trendy kurtas at the best prices, sourced from multiple factories.',
}

export function createMockVendorApi({ now = () => new Date() }: { now?: () => Date } = {}): MockVendorApi {
  const t = now().getTime()
  const at = (ms: number) => new Date(t - ms).toISOString()

  const vendors: VendorRecord[] = VENDORS.map(([id, name, owner, city, sells, status, live, ageDays, commission]) => {
    const slug = name.toLowerCase().replace(/[^a-z]+/g, '')
    const applied = at(ageDays * D)
    const application = {
      instagram_or_website: `instagram.com/${slug}`,
      product_types: sells,
      price_min_paise: 99_900,
      price_max_paise: 6_49_900,
      about: ABOUT[id] ?? `${name} makes ${sells.join(' and ').toLowerCase()} with artisans in ${city.split(',')[0]}.`,
      applied_at: applied,
    }
    const resells = id === 'v_kaaya' || id === 'v_quick'
    const checks = [
      { label: 'No other vendor uses this email or phone', ok: true, note: 'Checked against 36 vendors' },
      { label: 'City is inside the launch area', ok: true, note: `${city.split(',')[0]} ships with our courier partner` },
      { label: 'Instagram or website shows their own work', ok: !resells, note: resells ? 'Several posts are stock photos from other labels' : '120+ posts of their own pieces' },
      { label: 'Not on the blocked-sellers list', ok: true, note: 'No match' },
    ]
    const history: S['History'] = [{ at: applied, event: 'applied', by: owner }]
    if (status === 'approved' || status === 'suspended') history.unshift({ at: at((ageDays - 1) * D), event: 'invited', by: 'Priya Mehta', note: 'Commission 15%' })
    if (status === 'under_review') history.unshift({ at: at(2 * D), event: 'info_requested', by: 'Rahul Desai', note: 'Which pieces do you make yourselves, and which do you resell?' })
    if (status === 'rejected') history.unshift({ at: at(18 * D), event: 'rejected', by: 'Priya Mehta', note: 'Shazlo lists independent labels that make their own pieces.' })
    if (status === 'suspended') history.unshift({ at: at(6 * D), event: 'suspended', by: 'Naman Sinha', note: 'Three orders shipped with different products than listed.' })
    return { id, brand_name: name, owner_name: owner, email: `${owner.split(' ')[0]!.toLowerCase()}@${slug}.in`, phone: `+91 98${String(2500000 + ageDays * 7919).slice(0, 3)} ${String(10000 + ageDays * 313).slice(0, 5)}`, city, sells, status, live_products: live, since: applied, commission_bps: commission, application, checks, history }
  })

  type ProductSeed = [id: string, sku: string, vendor: string, title: string, rupees: number, mrp: number, category: string, ageHours: number, kind: 'new' | 'edit' | 'resubmission']
  const SEEDS: ProductSeed[] = [
    ['p_ajrakh', 'KS-AJR-014', 'v_kalki', 'Ajrakh Block-Print Kurta', 2499, 2999, 'Kurtas', 2, 'resubmission'],
    ['p_dabu_skirt', 'KS-DAB-040', 'v_kalki', 'Dabu Print Wrap Skirt', 1450, 1650, 'Skirts', 19, 'new'],
    ['p_handloom', 'KS-HCS-003', 'v_kalki', 'Handloom Cotton Shirt — Rust', 1199, 1499, 'Shirts', 20, 'edit'],
    ['p_pochampally', 'KS-PIK-027', 'v_kalki', 'Pochampally Ikat Kurta', 2299, 2599, 'Kurtas', 6, 'new'],
    ['p_phulkari', 'NH-PHK-008', 'v_nila', 'Phulkari Dupatta — Mustard', 2799, 3199, 'Dupattas', 27, 'new'],
    ['p_bandhej_saree', 'BH-SAR-112', 'v_bandhej', 'Bandhej Cotton Saree — Rani', 3499, 3999, 'Sarees', 30, 'new'],
    ['p_potli', 'KK-POT-021', 'v_kutch', 'Mirror-Work Potli Bag', 899, 999, 'Bags', 9, 'new'],
    ['p_dabu_set', 'IL-DAB-045', 'v_indigo', 'Indigo Dabu Kurta Set', 2899, 3299, 'Co-ords', 3, 'new'],
    ['p_patola', 'AT-PAT-007', 'v_ambar', 'Patola Silk Stole', 4999, 5499, 'Stoles', 34, 'resubmission'],
  ]
  const products: ProductRecord[] = SEEDS.map(([id, sku, vendorId, title, rupees, mrp, category, ageHours, kind]) => {
    const submitted = version(sku, title, rupees, mrp, category, sku === 'KS-AJR-014' ? { angles: ['front', 'back', 'closeup', 'extra'], stock: [4, 8, 10, 6, 3] } : category === 'Bags' || category === 'Stoles' || category === 'Dupattas' || category === 'Sarees' ? { stock: [8] } : {})
    let compareTo: Version | null = null
    let compareLabel: ProductRecord['compareLabel'] = null
    const history: S['History'] = [{ at: at(ageHours * H), event: 'submitted', by: vendors.find((v) => v.id === vendorId)!.owner_name }]
    if (kind === 'resubmission') {
      compareLabel = 'sent_back'
      if (sku === 'KS-AJR-014') {
        compareTo = { ...version(sku, title, rupees, mrp, category, { angles: ['front', 'closeup', 'extra'], stock: [4, 8, 10, 6, 0] }) }
        history.push({ at: at((ageHours + 8) * H), event: 'rejected', by: 'Priya Mehta', note: 'Back photo is missing. Add front, back and a fabric close-up so shoppers can see the print.' }, { at: at((ageHours + 10) * H), event: 'submitted', by: 'Kiran Shah' })
      } else {
        compareTo = { ...submitted, price_paise: 5999_00, description: 'Silk stole.' }
        history.push({ at: at((ageHours + 30) * H), event: 'rejected', by: 'Rahul Desai', note: 'Price ₹5,999 is above the MRP on the tag (₹5,499). Write a fuller description: weave, size and care.' }, { at: at((ageHours + 32) * H), event: 'submitted', by: 'Nikhil Shah' })
      }
    }
    if (kind === 'edit') {
      compareLabel = 'live'
      compareTo = { ...submitted, price_paise: 1299_00, description: 'Handloom cotton shirt in rust.' }
      history.push({ at: at(12 * D), event: 'approved', by: 'Priya Mehta' }, { at: at(12 * D + 2 * H), event: 'submitted', by: 'Kiran Shah' })
    }
    return { id, sku, vendorId, status: 'pending_review', submittedAt: at(ageHours * H), resubmission: kind === 'resubmission' ? 1 : 0, change: kind === 'edit' ? 'edit' : 'new', submitted, compareTo, compareLabel, history }
  })

  const brands: BrandRecord[] = [
    {
      vendorId: 'v_nila',
      status: 'pending_review',
      submittedAt: at(5 * H),
      live: brand('Handloom from Karnataka.', 'We work with weavers in Ilkal and Molakalmuru.', 'Bengaluru, Karnataka', 'nilahandloom'),
      draft: brand('Handloom sarees from the Deccan, woven to order.', 'We work with 22 weaving families in Ilkal and Molakalmuru. Every saree carries the weaver’s name on its tag, and takes 6 to 9 days on the loom.', 'Bengaluru, Karnataka', 'nilahandloom-new', { dispatch_time: '3_5_days' }),
      history: [{ at: at(5 * H), event: 'submitted', by: 'Ananya Rao' }, { at: at(40 * D), event: 'approved', by: 'Priya Mehta' }],
    },
    {
      vendorId: 'v_morpankh',
      status: 'pending_review',
      submittedAt: at(26 * H),
      live: null,
      draft: brand('Peacock-blue block prints from Jaipur.', 'Mor Pankh started in 2021 in a two-table workshop in Sanganer. We print with wooden blocks carved by Kishan ji, and dye with indigo and pomegranate. Call us on 98290 11111 for custom orders.', 'Jaipur, Rajasthan', 'morpankh'),
      history: [{ at: at(26 * H), event: 'submitted', by: 'Devansh Patel' }],
    },
  ]

  const EVENTS: [S['OutboxEvent']['event'], string, string, S['OutboxStatus'], number, string | null][] = [
    ['product.published', 'Phulkari Dupatta — Mustard', 'v_nila', 'failed', 6, 'HTTP 500 from central app: embedding service timed out'],
    ['product.published', 'Linen Co-ord Set — Indigo', 'v_kalki', 'retrying', 2, 'HTTP 503 from central app: try again shortly'],
    ['product.updated', 'Handloom Cotton Shirt — Rust', 'v_kalki', 'waiting', 0, null],
    ['brand_profile.published', 'Nila Handloom', 'v_nila', 'waiting', 0, null],
    ['product.published', 'Bandhani Silk Dupatta', 'v_kalki', 'delivered', 1, null],
    ['brand_profile.published', 'Kalki Studio', 'v_kalki', 'delivered', 1, null],
    ['product.published', 'Chikankari Kurti — Ivory', 'v_sutra', 'delivered', 1, null],
    ['product.unpublished', 'Kala Cotton Jacket', 'v_kesariya', 'delivered', 1, null],
    ['vendor.status_changed', 'Trendz Outlet', 'v_trendz', 'delivered', 1, null],
    ['product.published', 'Leheriya Cotton Dupatta', 'v_bandhej', 'delivered', 1, null],
    ['product.updated', 'Bagru Print Palazzo', 'v_kesariya', 'delivered', 2, null],
    ['product.published', 'Ikat Cotton Wrap Dress', 'v_rangrez', 'delivered', 1, null],
    ['product.published', 'Kantha Stitch Jacket', 'v_kutch', 'delivered', 1, null],
    ['brand_profile.published', 'Sutra Collective', 'v_sutra', 'delivered', 1, null],
    ['product.published', 'Shibori Indigo Scarf', 'v_indigo', 'delivered', 1, null],
    ['product.published', 'Jamdani Cotton Saree', 'v_sutra', 'delivered', 1, null],
  ]
  const outbox: S['OutboxEvent'][] = EVENTS.map(([event, subject, vendorId, status, tries, error], i) => {
    const created = at((i * 3 + 1) * H)
    const vendor = vendors.find((v) => v.id === vendorId)!
    return {
      id: `evt_${String(i + 1).padStart(4, '0')}`,
      event,
      subject,
      vendor: { id: vendor.id, name: vendor.brand_name },
      status,
      tries,
      created_at: created,
      last_attempt_at: tries ? at((i * 3 + 1) * H - 2 * 60_000) : null,
      next_attempt_at: status === 'retrying' ? new Date(t + 4 * 60_000).toISOString() : status === 'waiting' ? new Date(t + 30_000).toISOString() : null,
      last_error: error,
      payload: { event, idempotency_key: `idem_${i + 1}`, vendor_id: vendor.id, subject, occurred_at: created, schema: 'docs/adr/0003-contract' },
    }
  })

  const decisions: Decision[] = [
    { id: 'd1', subjectId: 'p_bandhani', kind: 'product', title: 'Bandhani Silk Dupatta', vendorId: 'v_kalki', decision: 'approved', at: at(3 * H), reviewer: 'Priya Mehta' },
    { id: 'd2', subjectId: 'p_ajrakh', kind: 'product', title: 'Ajrakh Block-Print Kurta', vendorId: 'v_kalki', decision: 'rejected', at: at(10 * H), reviewer: 'Priya Mehta' },
    { id: 'd3', subjectId: 'v_kalki', kind: 'brand_page', title: 'Kalki Studio brand page', vendorId: 'v_kalki', decision: 'approved', at: at(26 * H), reviewer: 'Naman Sinha' },
    { id: 'd4', subjectId: 'v_morpankh', kind: 'application', title: 'Mor Pankh Clothing', vendorId: 'v_morpankh', decision: 'approved', at: at(3 * D), reviewer: 'Rahul Desai' },
  ]

  return { now, vendors, products, brands, outbox, decisions, seq: 100 }
}
