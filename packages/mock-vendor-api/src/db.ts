import type { components } from './schema'
import { chartPhoto, swatch } from './swatch'

// Seed data for the admin side of vendor-api: vendors with their sign-up details and commission,
// products waiting for review, brand-page drafts and outbox events. Kalki Studio matches the seller
// portal's seed.
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

// The vendor as the mock keeps it. `commission_bps` in responses is read from `commission.agreed_bps`.
export interface VendorRecord {
  id: string
  brand_name: string
  owner_name: string
  email: string
  phone: string
  city: string
  sells: S['Sells']
  status: S['VendorStatus']
  live_products: number
  since: string
  commission: S['Commission']
  application: S['Application']
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

// 15 characters: state code, PAN, entity number, Z, check character.
export const GST_FORMAT = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

export const percent = (bps: number) => `${(bps / 100).toLocaleString('en-IN')}%`

// ---- Products ----------------------------------------------------------------------------------

const colour = (name: string, hex: string | null): S['Colour'] => ({ name, hex })
const C = {
  indigo: colour('Indigo', '#2E3F6E'),
  madder: colour('Madder red', '#8C2F25'),
  rust: colour('Rust', '#A4502B'),
  ivory: colour('Ivory', '#EFE6D2'),
  mustard: colour('Mustard', '#C99A2E'),
  black: colour('Black', '#2B2522'),
  olive: colour('Olive', '#5C6B4E'),
  rani: colour('Rani pink', '#B0306A'),
  maroon: colour('Maroon', '#6B1F2A'),
  multi: colour('Multicolour', null),
}

// Kalki Studio's charts: a table for kurtas, a photo of their own chart for shirts.
const KALKI_KURTAS: S['SizeChart'] = {
  kind: 'table',
  product_type: 'Kurtas',
  measurements: ['Chest', 'Waist', 'Length', 'Shoulder'],
  rows: [
    { size: 'XS', cm: [86, 76, 104, null] },
    { size: 'S', cm: [91, 81, 105, 35] },
    { size: 'M', cm: [96, 86, 106, 36.5] },
    { size: 'L', cm: [102, 92, 107, 38] },
    { size: 'XL', cm: [108, 98, 108, 39.5] },
  ],
}
const KALKI_SHIRTS: S['SizeChart'] = {
  kind: 'photo',
  product_type: 'Shirts',
  url: chartPhoto([
    ['Size', 'Chest', 'Length'],
    ['S', '96', '72'],
    ['M', '101', '74'],
    ['L', '106', '76'],
    ['XL', '112', '78'],
  ]),
}

type Slot = S['ProductPhoto']['slot']
type VersionOptions = {
  gender?: Version['gender']
  colour?: S['Colour']
  others?: S['Colour'][]
  material?: string
  description?: string
  slots?: Slot[]
  tryOn?: number
  stock?: number[]
  chart?: S['SizeChart'] | null
}

function version(sku: string, title: string, rupees: number, mrp: number | null, type: string, opts: VersionOptions = {}): Version {
  const slots = opts.slots ?? ['front', 'back', 'detail', 'worn']
  const stock = opts.stock ?? [3, 5, 6, 4, 2]
  const sizes = stock.length === 1 ? ['One size'] : SIZES.slice(0, stock.length)
  return {
    title,
    description: opts.description ?? `${title} in hand block-printed cotton, dyed with natural colours. Hand wash cold.`,
    gender: opts.gender ?? 'women',
    product_type: type,
    main_colour: opts.colour ?? C.indigo,
    other_colours: opts.others ?? [],
    material: opts.material ?? 'Cotton (mul)',
    price_paise: rupees * 100,
    mrp_paise: mrp == null ? null : mrp * 100,
    variants: sizes.map((size, i) => ({ size, sku: `${sku}-${size === 'One size' ? 'OS' : size}`, stock: stock[i]! })),
    photos: slots.map((slot) => ({ id: `${sku}-${slot}`, url: swatch(sku, slot), slot })),
    try_on_photos: Array.from({ length: opts.tryOn ?? 5 }, (_, n) => ({ id: `${sku}-tryon-${n + 1}`, url: swatch(sku, 'tryon', n) })),
    size_chart: opts.chart ?? null,
  }
}

const brand = (tagline: string, story: string, basedIn: string, seed: string, extra: Partial<S['BrandProfile']> = {}): S['BrandProfile'] => ({
  tagline,
  story,
  based_in: basedIn,
  cover_url: swatch(seed, 'detail'),
  logo_url: null,
  return_policy: '7_day',
  dispatch_time: '2_3_days',
  instagram: `@${seed}`,
  website: `${seed}.in`,
  ...extra,
})

// ---- Vendors -----------------------------------------------------------------------------------

const shazlo = (line: string, area: string, city: string, pin: string): S['Delivery'] => ({ by: 'shazlo', pickup_address: { line, area, city, pin } })
const own = (places: string[] | 'all', days: '1_2' | '2_3' | '3_5' | '5_7'): S['Delivery'] => ({ by: 'own', all_india: places === 'all', places: places === 'all' ? [] : places, days })
const bank = (holder: string, last4: string, ifsc: string, name: string): S['Payout'] => ({ method: 'bank', account_holder: holder, account_last4: last4, ifsc, bank_name: name })
const upi = (masked: string): S['Payout'] => ({ method: 'upi', upi_masked: masked })

// Commission as the seed starts it: [state, agreed %, proposed %, days since it changed, Shazlo's note].
type CommissionSeed = [state: S['CommissionState'], agreed: number | null, proposed: number | null, days: number, note?: string]

interface VendorSeed {
  id: string
  name: string
  owner: string
  city: string
  sells: S['Sells']
  status: S['VendorStatus']
  live: number
  ageDays: number
  commission: CommissionSeed
  // What the brand proposed at sign-up, in %.
  signupProposal: number | null
  link: string | null
  delivery: S['Delivery']
  returns: [window: 0 | 7 | 14 | 30, condition: S['Returns']['condition'], refund: S['Returns']['refund_days']]
  cod: [cash: boolean, upi: boolean]
  payout: S['Payout']
  legal: string | null
  gst: string | null
}

const VENDORS: VendorSeed[] = [
  {
    id: 'v_kalki', name: 'Kalki Studio', owner: 'Kiran Shah', city: 'Ahmedabad, Gujarat', sells: 'women', status: 'approved', live: 18, ageDays: 26,
    commission: ['agreed', 12, null, 25], signupProposal: null, link: 'instagram.com/kalkistudio',
    delivery: shazlo('14 Pol Road, near Manek Chowk', 'Khadia', 'Ahmedabad', '380001'), returns: [7, 'unworn_with_tags', 5], cod: [true, true],
    payout: bank('Kalki Studio LLP', '4821', 'HDFC0000146', 'HDFC Bank'), legal: 'Kalki Studio LLP', gst: '24AAQFK3912M1Z6',
  },
  {
    id: 'v_nila', name: 'Nila Handloom', owner: 'Ananya Rao', city: 'Bengaluru, Karnataka', sells: 'women', status: 'approved', live: 24, ageDays: 60,
    commission: ['agreed', 10, null, 59], signupProposal: 10, link: 'instagram.com/nilahandloom',
    delivery: own(['Bengaluru', 'Mysuru', 'Hubballi', '560001'], '2_3'), returns: [14, 'any_reason', 7], cod: [false, true],
    payout: upi('nila••••@okaxis'), legal: 'Nila Handloom Pvt Ltd', gst: '29AAFCN4821K1Z3',
  },
  {
    id: 'v_morpankh', name: 'Mor Pankh Clothing', owner: 'Devansh Patel', city: 'Jaipur, Rajasthan', sells: 'both', status: 'approved', live: 0, ageDays: 3,
    commission: ['agreed', 18, null, 2], signupProposal: 15, link: 'morpankh.in',
    delivery: shazlo('B-42, Sanganer Industrial Area', 'Sanganer', 'Jaipur', '302029'), returns: [7, 'damaged_or_wrong', 5], cod: [true, false],
    payout: bank('Devansh Patel', '0917', 'SBIN0031025', 'State Bank of India'), legal: null, gst: null,
  },
  {
    id: 'v_kesariya', name: 'Kesariya Prints', owner: 'Meera Joshi', city: 'Jaipur, Rajasthan', sells: 'women', status: 'approved', live: 31, ageDays: 90,
    commission: ['not_set', null, null, 0], signupProposal: null, link: 'instagram.com/kesariyaprints',
    delivery: shazlo('7 Johari Bazaar, first floor', 'Pink City', 'Jaipur', '302003'), returns: [7, 'unworn_with_tags', 5], cod: [true, true],
    payout: upi('meera••••@okicici'), legal: null, gst: null,
  },
  {
    id: 'v_indigo', name: 'Indigo Loom', owner: 'Arjun Mehta', city: 'Bagru, Rajasthan', sells: 'both', status: 'approved', live: 12, ageDays: 45,
    commission: ['proposed', 12, 10, 1], signupProposal: null, link: 'instagram.com/indigoloom',
    delivery: own('all', '3_5'), returns: [14, 'unworn_with_tags', 5], cod: [true, true],
    payout: bank('Indigo Loom', '3306', 'PUNB0244200', 'Punjab National Bank'), legal: 'Indigo Loom Crafts', gst: '08AAGFI7713R1Z9',
  },
  {
    id: 'v_bandhej', name: 'Bandhej House', owner: 'Farah Khan', city: 'Bhuj, Gujarat', sells: 'women', status: 'approved', live: 9, ageDays: 38,
    commission: ['agreed', 12, null, 37], signupProposal: 12, link: 'instagram.com/bandhejhouse',
    delivery: shazlo('Plot 11, Bhid Gate Road', 'Bhid Bazaar', 'Bhuj', '370001'), returns: [7, 'unworn_with_tags', 7], cod: [true, false],
    payout: bank('Farah Khan', '5560', 'BARB0BHUJXX', 'Bank of Baroda'), legal: null, gst: '24ABCPK5531D1Z2',
  },
  {
    id: 'v_sutra', name: 'Sutra Collective', owner: 'Ishita Bose', city: 'Kolkata, West Bengal', sells: 'women', status: 'approved', live: 15, ageDays: 70,
    commission: ['sent_back', 15, 8, 3, 'We cannot go to 8% for handloom sarees yet. We can agree 12% if you switch to Shazlo delivery. Let us talk on Friday.'], signupProposal: null, link: 'instagram.com/sutracollective',
    delivery: own(['Kolkata', 'Howrah', 'Siliguri'], '3_5'), returns: [7, 'damaged_or_wrong', 5], cod: [true, true],
    payout: upi('sutra••••@ybl'), legal: 'Sutra Collective Foundation', gst: '19AAKTS2208J1ZQ',
  },
  {
    id: 'v_kutch', name: 'Kutch Kala', owner: 'Ravi Ahir', city: 'Bhuj, Gujarat', sells: 'both', status: 'approved', live: 7, ageDays: 33,
    commission: ['agreed', 18, null, 32], signupProposal: null, link: 'instagram.com/kutchkala',
    delivery: own('all', '5_7'), returns: [0, null, null], cod: [true, false],
    payout: bank('Ravi Ahir', '7742', 'ICIC0001867', 'ICICI Bank'), legal: null, gst: null,
  },
  {
    id: 'v_ambar', name: 'Ambar Textiles', owner: 'Nikhil Shah', city: 'Surat, Gujarat', sells: 'women', status: 'approved', live: 11, ageDays: 52,
    commission: ['agreed', 8, null, 51], signupProposal: 8, link: 'ambartextiles.com',
    delivery: shazlo('Unit 304, Millennium Textile Market', 'Ring Road', 'Surat', '395002'), returns: [7, 'unworn_with_tags', 2], cod: [true, true],
    payout: bank('Ambar Textiles Pvt Ltd', '1209', 'KKBK0002861', 'Kotak Mahindra Bank'), legal: 'Ambar Textiles Pvt Ltd', gst: '24AAHCA4410B1Z8',
  },
  {
    id: 'v_rangrez', name: 'Rangrez Studio', owner: 'Zoya Ali', city: 'Lucknow, Uttar Pradesh', sells: 'both', status: 'approved', live: 20, ageDays: 80,
    commission: ['proposed', 15, 12, 2], signupProposal: null, link: 'instagram.com/rangrezstudio',
    delivery: shazlo('22 Aminabad Road', 'Aminabad', 'Lucknow', '226018'), returns: [14, 'unworn_with_tags', 5], cod: [true, true],
    payout: upi('zoya••••@oksbi'), legal: null, gst: '09ABDPA6617Q1Z4',
  },
  {
    id: 'v_saanjh', name: 'Saanjh Label', owner: 'Mehak Gill', city: 'Amritsar, Punjab', sells: 'women', status: 'applied', live: 0, ageDays: 1,
    commission: ['proposed', null, 10, 1], signupProposal: 10, link: null,
    delivery: shazlo('House 118, Gali Kucha Bagh', 'Hall Bazaar', 'Amritsar', '143006'), returns: [7, 'unworn_with_tags', 5], cod: [true, true],
    payout: bank('Mehak Gill', '6083', 'PSIB0000123', 'Punjab & Sind Bank'), legal: null, gst: null,
  },
  {
    id: 'v_rann', name: 'Rann Weaves', owner: 'Aarti Chauhan', city: 'Bhuj, Gujarat', sells: 'both', status: 'applied', live: 0, ageDays: 2,
    commission: ['not_set', null, null, 2], signupProposal: null, link: 'instagram.com/rannweaves',
    delivery: own(['Bhuj', 'Ahmedabad', 'Mumbai', '370001'], '3_5'), returns: [14, 'unworn_with_tags', 7], cod: [false, true],
    payout: upi('aarti••••@okhdfcbank'), legal: 'Rann Weaves Producer Company', gst: '24AAJCR8812P1Z7',
  },
  {
    id: 'v_kaaya', name: 'Kaaya Ethnic', owner: 'Sana Mirza', city: 'Hyderabad, Telangana', sells: 'women', status: 'under_review', live: 0, ageDays: 4,
    commission: ['not_set', null, null, 4], signupProposal: null, link: 'instagram.com/kaayaethnic',
    delivery: shazlo('5-9-22, Pathergatti', 'Charminar', 'Hyderabad', '500002'), returns: [7, 'unworn_with_tags', 5], cod: [true, true],
    payout: bank('Kaaya Ethnic', '2448', 'UTIB0000008', 'Axis Bank'), legal: null, gst: null,
  },
  {
    id: 'v_quick', name: 'QuickFashion Hub', owner: 'Rohit Verma', city: 'Delhi', sells: 'both', status: 'rejected', live: 0, ageDays: 20,
    commission: ['not_set', null, null, 18], signupProposal: 20, link: 'instagram.com/quickfashionhub',
    delivery: own('all', '1_2'), returns: [30, 'any_reason', 2], cod: [true, true],
    payout: upi('rohit••••@paytm'), legal: 'QuickFashion Hub', gst: '07AAACQ123',
  },
  {
    id: 'v_trendz', name: 'Trendz Outlet', owner: 'Karan Malhotra', city: 'Mumbai, Maharashtra', sells: 'women', status: 'suspended', live: 0, ageDays: 120,
    commission: ['agreed', 15, null, 119], signupProposal: null, link: 'instagram.com/trendzoutlet',
    delivery: shazlo('Shop 9, Natraj Market', 'Malad West', 'Mumbai', '400064'), returns: [7, 'unworn_with_tags', 5], cod: [true, true],
    payout: bank('Trendz Outlet', '8135', 'HDFC0000212', 'HDFC Bank'), legal: 'Trendz Retail LLP', gst: '27AAIFT9921H1Z5',
  },
]

// The automatic checks for an application: duplicates, their own work online, the blocked list and,
// when they gave one, the GST number's format.
export function checksFor(v: Pick<VendorRecord, 'id' | 'application'>): S['VendorDetail']['checks'] {
  const resells = v.id === 'v_kaaya' || v.id === 'v_quick'
  const link = v.application.instagram_or_website
  const checks: S['VendorDetail']['checks'] = [
    { label: 'No other vendor uses this email or phone', ok: true, note: 'Checked against 36 vendors' },
    link
      ? { label: 'Instagram or website shows their own work', ok: !resells, note: resells ? 'Several posts are stock photos from other labels' : '120+ posts of their own pieces' }
      : { label: 'Instagram or website shows their own work', ok: false, note: 'No link given. Ask for photos of pieces they made.' },
    { label: 'Not on the blocked-sellers list', ok: true, note: 'No match' },
  ]
  const gst = v.application.gst_number
  if (gst) checks.push(GST_FORMAT.test(gst) ? { label: 'GST number format', ok: true, note: `${gst} has the right format` } : { label: 'GST number format', ok: false, note: `${gst} is not a GST number. It should be 15 characters, like 24AAQFK3912M1Z6.` })
  return checks
}

export function createMockVendorApi({ now = () => new Date() }: { now?: () => Date } = {}): MockVendorApi {
  const t = now().getTime()
  const at = (ms: number) => new Date(t - ms).toISOString()

  const vendors: VendorRecord[] = VENDORS.map((seed) => {
    const { id, name, owner, city, sells, status, live, ageDays } = seed
    const slug = name.toLowerCase().replace(/[^a-z]+/g, '')
    const applied = at(ageDays * D)
    const [state, agreed, proposed, days, note] = seed.commission
    const bps = (pct: number | null) => (pct == null ? null : Math.round(pct * 100))
    const commission: S['Commission'] = { state, agreed_bps: bps(agreed), proposed_bps: bps(proposed), note: note ?? null, updated_at: state === 'not_set' && agreed == null && proposed == null ? null : at(days * D) }
    const application: S['Application'] = {
      instagram_or_website: seed.link,
      delivery: seed.delivery,
      returns: { window_days: seed.returns[0], condition: seed.returns[1], refund_days: seed.returns[2] },
      pay_on_delivery: { cash: seed.cod[0], upi: seed.cod[1] },
      payout: seed.payout,
      legal_name: seed.legal,
      gst_number: seed.gst,
      proposed_commission_bps: bps(seed.signupProposal),
      agreed_terms: true,
      agreed_price_rule: true,
      applied_at: applied,
    }
    const history: S['History'] = [{ at: applied, event: 'applied', by: owner }]
    if (seed.signupProposal != null) history.unshift({ at: applied, event: 'commission_proposed', by: owner, note: `${seed.signupProposal}%` })
    if (status === 'approved' || status === 'suspended') history.unshift({ at: at((ageDays - 1) * D), event: 'invited', by: 'Priya Mehta', note: agreed != null && state !== 'not_set' ? `Commission ${agreed}%` : 'Commission to be agreed' })
    if (status === 'under_review') history.unshift({ at: at(2 * D), event: 'info_requested', by: 'Rahul Desai', note: 'Which pieces do you make yourselves, and which do you resell?' })
    if (status === 'rejected') history.unshift({ at: at(18 * D), event: 'rejected', by: 'Priya Mehta', note: 'Shazlo lists independent labels that make their own pieces.' })
    if (status === 'suspended') history.unshift({ at: at(6 * D), event: 'suspended', by: 'Naman Sinha', note: 'Three orders shipped with different products than listed.' })
    if ((state === 'proposed' || state === 'sent_back') && status !== 'applied') history.unshift({ at: at((days + (state === 'sent_back' ? 2 : 0)) * D), event: 'commission_proposed', by: owner, note: `${proposed}%` })
    if (state === 'sent_back') history.unshift({ at: at(days * D), event: 'commission_sent_back', by: 'Rahul Desai', note: note! })
    return {
      id,
      brand_name: name,
      owner_name: owner,
      email: `${owner.split(' ')[0]!.toLowerCase()}@${slug}.in`,
      phone: `+91 98${String(2500000 + ageDays * 7919).slice(0, 3)} ${String(10000 + ageDays * 313).slice(0, 5)}`,
      city,
      sells,
      status,
      live_products: live,
      since: applied,
      commission,
      application,
      history,
    }
  })

  type ProductSeed = [id: string, sku: string, vendor: string, title: string, rupees: number, mrp: number | null, type: string, ageHours: number, kind: 'new' | 'edit' | 'resubmission', opts: VersionOptions]
  const ONE_SIZE = { stock: [8] }
  const SEEDS: ProductSeed[] = [
    ['p_ajrakh', 'KS-AJR-014', 'v_kalki', 'Ajrakh Block-Print Kurta', 2499, 2999, 'Kurtas', 2, 'resubmission', { colour: C.indigo, others: [C.madder], slots: ['front', 'back', 'detail', 'worn', 'extra'], stock: [4, 8, 10, 6, 3], chart: KALKI_KURTAS }],
    ['p_dabu_skirt', 'KS-DAB-040', 'v_kalki', 'Dabu Print Wrap Skirt', 1450, 1650, 'Skirts', 19, 'new', { colour: C.indigo, material: 'Cotton cambric' }],
    ['p_handloom', 'KS-HCS-003', 'v_kalki', 'Handloom Cotton Shirt — Rust', 1199, 1499, 'Shirts', 20, 'edit', { gender: 'men', colour: C.rust, material: '100% handloom cotton', stock: [0, 4, 6, 5, 2], chart: KALKI_SHIRTS }],
    ['p_pochampally', 'KS-PIK-027', 'v_kalki', 'Pochampally Ikat Kurta', 2299, null, 'Kurtas', 6, 'new', { colour: C.maroon, others: [C.ivory, C.mustard], material: 'Cotton ikat, handwoven', chart: KALKI_KURTAS }],
    ['p_phulkari', 'NH-PHK-008', 'v_nila', 'Phulkari Dupatta — Mustard', 2799, 3199, 'Dupattas', 27, 'new', { colour: C.mustard, others: [C.rani], material: 'Cotton with silk-thread phulkari', ...ONE_SIZE }],
    ['p_bandhej_saree', 'BH-SAR-112', 'v_bandhej', 'Bandhej Cotton Saree — Rani', 3499, 3999, 'Sarees', 30, 'new', { colour: C.rani, others: [C.mustard], material: 'Mul cotton', ...ONE_SIZE }],
    ['p_potli', 'KK-POT-021', 'v_kutch', 'Mirror-Work Potli Bag', 899, 999, 'Bags', 9, 'new', { gender: 'unisex', colour: C.multi, material: 'Cotton with mirror work', ...ONE_SIZE }],
    ['p_dabu_set', 'IL-DAB-045', 'v_indigo', 'Indigo Dabu Kurta Set', 2899, 3299, 'Co-ord sets', 3, 'new', { colour: C.indigo, others: [C.ivory], material: 'Cotton (mul), natural indigo', tryOn: 2 }],
    ['p_patola', 'AT-PAT-007', 'v_ambar', 'Patola Silk Stole', 4999, 5499, 'Stoles', 34, 'resubmission', { gender: 'unisex', colour: C.madder, others: [C.black, C.ivory], material: 'Pure silk, double ikat', ...ONE_SIZE }],
  ]
  const products: ProductRecord[] = SEEDS.map(([id, sku, vendorId, title, rupees, mrp, type, ageHours, kind, opts]) => {
    const submitted = version(sku, title, rupees, mrp, type, opts)
    let compareTo: Version | null = null
    let compareLabel: ProductRecord['compareLabel'] = null
    const history: S['History'] = [{ at: at(ageHours * H), event: 'submitted', by: vendors.find((v) => v.id === vendorId)!.owner_name }]
    if (kind === 'resubmission') {
      compareLabel = 'sent_back'
      if (sku === 'KS-AJR-014') {
        compareTo = version(sku, title, rupees, mrp, type, { ...opts, slots: ['front', 'detail', 'worn', 'extra'], tryOn: 3, stock: [4, 8, 10, 6, 0] })
        history.push({ at: at((ageHours + 8) * H), event: 'rejected', by: 'Priya Mehta', note: 'The back photo is missing and there are only 3 try-on photos. Add the back photo and 5 try-on photos so shoppers can see the print and the fit.' }, { at: at((ageHours + 10) * H), event: 'submitted', by: 'Kiran Shah' })
      } else {
        compareTo = { ...submitted, price_paise: 5999_00, material: 'Silk', description: 'Silk stole.' }
        history.push({ at: at((ageHours + 30) * H), event: 'rejected', by: 'Rahul Desai', note: 'Price ₹5,999 is above the MRP on the tag (₹5,499). Write a fuller description and material: weave, size and care.' }, { at: at((ageHours + 32) * H), event: 'submitted', by: 'Nikhil Shah' })
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
      draft: brand('Handloom sarees from the Deccan, woven to order.', 'We work with 22 weaving families in Ilkal and Molakalmuru. Every saree carries the weaver’s name on its tag, and takes 6 to 9 days on the loom.', 'Bengaluru, Karnataka', 'nilahandloom-new'),
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
