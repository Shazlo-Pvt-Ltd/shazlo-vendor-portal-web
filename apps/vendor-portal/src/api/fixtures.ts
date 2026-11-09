// Sample data copied from the Penpot wireframes (Kalki Studio, V-04 to V-09) so the mock API
// shows the same catalogue the designs do. Counts match V-04/V-06: 18 live, 4 pending,
// 2 sent back, 3 drafts, 27 in all.
import type { BrandProfileFields, Product, ProductStatus, ReviewDecision, Session, SizeStock } from './types'

const HOUR = 3_600_000
const DAY = 24 * HOUR
export const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

export const demoSession: Session = {
  user: { id: 'u_kiran', name: 'Kiran Shah', initials: 'KS', email: 'kiran@kalkistudio.in', role: 'owner' },
  vendor: { id: 'v_kalki', brandName: 'Kalki Studio', initials: 'KS', status: 'approved', approvedAt: '2026-10-14', city: 'Ahmedabad', commissionPct: 15 },
}

/** The password the mock accepts for kiran@kalkistudio.in. Any other password is rejected. */
export const DEMO_PASSWORD = 'kalki-studio-2026'

function sizes(prefix: string, stock: number[], labels = ['S', 'M', 'L', 'XL', 'XXL']): SizeStock[] {
  return stock.map((n, i) => ({ size: labels[i] ?? `S${i}`, sku: `${prefix}-${labels[i]}`, stock: n }))
}

function product(p: Partial<Product> & Pick<Product, 'id' | 'title' | 'sku' | 'category' | 'status' | 'updatedAt'>): Product {
  return {
    gender: 'women',
    fabric: 'Cotton',
    description: '',
    price: null,
    mrp: null,
    sizes: [],
    // Submitted products have their three required photos; drafts start with empty slots.
    images: p.status === 'draft'
      ? [{ id: `${p.id}-f`, slot: 'front' }, { id: `${p.id}-b`, slot: 'back' }, { id: `${p.id}-d`, slot: 'detail' }]
      : [
          { id: `${p.id}-f`, slot: 'front', name: 'front.jpg' },
          { id: `${p.id}-b`, slot: 'back', name: 'back.jpg' },
          { id: `${p.id}-d`, slot: 'detail', name: 'fabric-close-up.jpg' },
        ],
    returnable: true,
    returnDays: 7,
    weightGrams: 350,
    ...p,
  }
}

export const ajrakhDecision: ReviewDecision = {
  id: 'd_ajrakh',
  subject: { kind: 'product', productId: 'p_ajrakh', title: 'Ajrakh Block-Print Kurta', sku: 'KS-AJR-014' },
  outcome: 'rejected',
  reason: 'Back photo is missing. Add front, back and a fabric close-up.',
  fields: ['images'],
  decidedAt: ago(2 * HOUR),
  submittedAt: ago(DAY + 3 * HOUR),
}

export const kutchDecision: ReviewDecision = {
  id: 'd_kutch',
  subject: { kind: 'product', productId: 'p_kutch', title: 'Kutch Mirror-Work Jacket', sku: 'KS-KMJ-007' },
  outcome: 'rejected',
  reason: 'Price ₹3,999 does not match the MRP on the tag (₹3,499).',
  fields: ['price', 'mrp'],
  decidedAt: '2026-10-21T11:20:00+05:30',
  submittedAt: '2026-10-20T16:05:00+05:30',
}

export const initialDecisions: ReviewDecision[] = [
  ajrakhDecision,
  {
    id: 'd_bandhani',
    subject: { kind: 'product', productId: 'p_bandhani', title: 'Bandhani Silk Dupatta', sku: 'KS-BDN-022' },
    outcome: 'approved',
    decidedAt: ago(DAY + 2 * HOUR),
    submittedAt: ago(2 * DAY),
    liveAt: ago(DAY + 2 * HOUR - 4 * 60_000),
  },
  {
    id: 'd_brand',
    subject: { kind: 'brand_page', title: 'Brand page: story and cover' },
    outcome: 'approved',
    decidedAt: ago(DAY + 4 * HOUR),
    submittedAt: ago(2 * DAY + 2 * HOUR),
    liveAt: ago(DAY + 4 * HOUR - 3 * 60_000),
  },
  kutchDecision,
  {
    id: 'd_linen',
    subject: { kind: 'product', productId: 'p_linen', title: 'Linen Co-ord Set — Indigo', sku: 'KS-LCS-031' },
    outcome: 'approved',
    decidedAt: '2026-10-20T15:10:00+05:30',
    submittedAt: '2026-10-19T12:00:00+05:30',
  },
]

const wireframeProducts: Product[] = [
  product({
    id: 'p_ajrakh', title: 'Ajrakh Block-Print Kurta', sku: 'KS-AJR-014', category: 'Kurtas', status: 'rejected', fabric: 'Cotton (mul)',
    description: 'Straight-cut kurta in hand block-printed Ajrakh cotton, dyed with indigo and madder. Side slits, three-quarter sleeves. Hand wash cold.',
    price: 2499, mrp: 2999, sizes: sizes('KS-AJR-014', [4, 8, 10, 6, 0], ['XS', 'S', 'M', 'L', 'XL']), updatedAt: ago(2 * HOUR), lastDecision: ajrakhDecision,
    images: [
      { id: 'p_ajrakh-f', slot: 'front', name: 'front.jpg' },
      { id: 'p_ajrakh-b', slot: 'back' },
      { id: 'p_ajrakh-d', slot: 'detail', name: 'fabric-close-up.jpg' },
      { id: 'p_ajrakh-x1', slot: 'extra', name: 'styled-on-model.jpg' },
    ],
    weightGrams: 320,
  }),
  product({
    id: 'p_kutch', title: 'Kutch Mirror-Work Jacket', sku: 'KS-KMJ-007', category: 'Jackets', status: 'rejected', fabric: 'Cotton silk',
    description: 'Hand-embroidered mirror work from Kutch on a cropped, open-front jacket.', price: 3999, mrp: 3499,
    sizes: sizes('KS-KMJ-007', [2, 2, 1, 1, 0]), updatedAt: '2026-10-21T11:20:00+05:30', lastDecision: kutchDecision, gender: 'women',
  }),
  product({ id: 'p_bandhani', title: 'Bandhani Silk Dupatta', sku: 'KS-BDN-022', category: 'Dupattas', status: 'approved', fabric: 'Silk', price: 1850, mrp: 2200, sizes: [{ size: 'Free', sku: 'KS-BDN-022-F', stock: 14 }], updatedAt: ago(DAY + 2 * HOUR) }),
  product({ id: 'p_handloom', title: 'Handloom Cotton Shirt — Rust', sku: 'KS-HCS-003', category: 'Shirts', status: 'approved', pendingEdit: true, gender: 'men', price: 1299, mrp: 1599, sizes: sizes('KS-HCS-003', [4, 6, 6, 4, 2]), updatedAt: ago(DAY + 5 * HOUR) }),
  product({ id: 'p_linen', title: 'Linen Co-ord Set — Indigo', sku: 'KS-LCS-031', category: 'Co-ords', status: 'approved', fabric: 'Linen', price: 2999, mrp: 3499, sizes: sizes('KS-LCS-031', [2, 3, 2, 2, 0]), updatedAt: '2026-10-20T15:10:00+05:30' }),
  product({ id: 'p_chikankari', title: 'Chikankari Kurti — Ivory', sku: 'KS-CHK-018', category: 'Kurtis', status: 'approved', price: 1699, mrp: 1999, sizes: sizes('KS-CHK-018', [0, 0, 0, 0, 0]), updatedAt: '2026-10-19T10:00:00+05:30' }),
  product({ id: 'p_dabu', title: 'Dabu Print Wrap Skirt', sku: 'KS-DAB-040', category: 'Skirts', status: 'pending_review', price: 1450, mrp: 1750, sizes: sizes('KS-DAB-040', [3, 4, 3, 2, 0]), updatedAt: '2026-10-18T13:30:00+05:30', submittedAt: '2026-10-18T13:30:00+05:30' }),
  product({ id: 'p_kala', title: 'Kala Cotton Overshirt', sku: 'KS-KAL-011', category: 'Shirts', status: 'draft', gender: 'men', updatedAt: '2026-10-16T18:00:00+05:30', images: [{ id: 'p_kala-f', slot: 'front' }, { id: 'p_kala-b', slot: 'back' }, { id: 'p_kala-d', slot: 'detail' }] }),
]

// The rest of the 27, consistent with the wireframe counts.
const more: Array<[string, string, string, ProductStatus, number, number]> = [
  ['Indigo Dabu Kurta', 'KS-IDK-019', 'Kurtas', 'approved', 2199, 15],
  ['Leheriya Cotton Saree', 'KS-LHR-025', 'Sarees', 'approved', 3299, 7],
  ['Ajrakh Stole — Madder', 'KS-AJS-016', 'Stoles', 'approved', 1199, 20],
  ['Block-Print Palazzo — Sage', 'KS-BPP-028', 'Bottoms', 'approved', 1349, 18],
  ['Kantha Quilted Jacket', 'KS-KQJ-009', 'Jackets', 'approved', 4299, 4],
  ['Bagru Print Shirt Dress', 'KS-BSD-033', 'Dresses', 'approved', 2599, 11],
  ['Mul Cotton Night Suit', 'KS-MNS-036', 'Loungewear', 'approved', 1899, 16],
  ['Shibori Silk Scarf', 'KS-SSS-012', 'Stoles', 'approved', 999, 25],
  ['Patola Weave Dupatta', 'KS-PWD-021', 'Dupattas', 'approved', 2799, 5],
  ['Kalamkari Anarkali', 'KS-KMA-030', 'Kurtas', 'approved', 3499, 6],
  ['Handloom Khadi Kurta — Men', 'KS-HKM-005', 'Kurtas', 'approved', 1799, 13],
  ['Bandhgala Nehru Jacket', 'KS-BNJ-008', 'Jackets', 'approved', 2899, 8],
  ['Gamthi Print Tunic', 'KS-GPT-024', 'Kurtis', 'approved', 1299, 19],
  ['Ikat Cotton Trousers', 'KS-ICT-027', 'Bottoms', 'approved', 1599, 10],
  ['Kutch Embroidered Potli', 'KS-KEP-041', 'Accessories', 'pending_review', 899, 22],
  ['Ajrakh Co-ord — Rust', 'KS-ACR-042', 'Co-ords', 'pending_review', 3199, 9],
  ['Mashru Silk Kurti', 'KS-MSK-043', 'Kurtis', 'pending_review', 2299, 12],
  ['Tangaliya Shawl', 'KS-TGS-044', 'Stoles', 'draft', 2499, 0],
  ['Rogan Art Tote', 'KS-RAT-045', 'Accessories', 'draft', 1499, 0],
]

const moreProducts = more.map(([title, sku, category, status, price, stock], i) =>
  product({
    id: `p_${sku.toLowerCase()}`,
    title,
    sku,
    category,
    status,
    price: status === 'draft' && i % 2 ? null : price,
    mrp: status === 'draft' && i % 2 ? null : Math.round(price * 1.2 / 50) * 50 - 1,
    gender: /Men|Nehru|Trousers/.test(title) ? 'men' : 'women',
    sizes: stock ? sizes(sku, [Math.ceil(stock / 4), Math.ceil(stock / 4), Math.floor(stock / 4), Math.floor(stock / 4), 0]) : [],
    updatedAt: new Date(Date.parse('2026-10-15T12:00:00+05:30') - i * 2 * DAY).toISOString(),
    submittedAt: status === 'pending_review' ? ago((i - 13) * 6 * HOUR) : undefined,
  }),
)

export const initialProducts: Product[] = [...wireframeProducts, ...moreProducts]

/** When each wireframe product was first saved as a draft (V-07 review history). Others fall back to their oldest event. */
export const productCreatedAt: Record<string, string> = {
  p_ajrakh: '2026-10-22T10:30:00+05:30',
  p_kutch: '2026-10-18T12:00:00+05:30',
  p_bandhani: '2026-10-12T11:00:00+05:30',
  p_handloom: '2026-10-08T16:00:00+05:30',
  p_linen: '2026-10-10T10:00:00+05:30',
  p_chikankari: '2026-10-09T15:30:00+05:30',
  p_dabu: '2026-10-16T09:45:00+05:30',
  p_kala: '2026-10-16T18:00:00+05:30',
}

/** Product names the mock gives the drafts it creates from a bulk import (V-08). */
export const importedProductNames = [
  'Bagru Print Kurta — Mustard', 'Ajrakh Dupatta — Black', 'Indigo Nehru Jacket', 'Dabu Print Palazzo', 'Kalamkari Kurti — Rust',
  'Sanganeri Floral Shirt', 'Bandhani Cotton Saree', 'Kantha Stitch Stole', 'Leheriya Kurta — Teal', 'Block-Print Wrap Dress',
  'Mul Cotton Shirt — Ivory', 'Ikat Kurta — Indigo', 'Shibori Co-ord — Grey', 'Chanderi Dupatta — Gold', 'Khadi Overshirt — Olive',
]

// Brand page as drawn in V-05: the draft changes the cover image and the story (V-04: "2 unpublished
// changes (cover image, story)"). `mock://` image ids stand for uploaded assets the mock has no bytes
// for; screens draw them as image placeholders, as the wireframe does.
export const publishedBrand: BrandProfileFields = {
  brandName: 'Kalki Studio',
  tagline: 'Hand block-printed, naturally dyed.',
  logoUrl: 'mock://brand/logo.png',
  coverUrl: 'mock://brand/cover-2026-10.jpg',
  story: 'Ajrakh block prints from Kutch, dyed by hand with indigo and madder.',
  city: 'Ahmedabad, Gujarat',
  instagram: '@kalki.studio',
  website: 'kalkistudio.in',
  shipsIn: '2–3 days',
  returnPolicy: '7-day returns, unworn with tags',
  categories: ['Kurtas', 'Dupattas', 'Co-ords'],
}

export const draftBrand: BrandProfileFields = {
  ...publishedBrand,
  coverUrl: 'mock://brand/cover-2026-11.jpg',
  story: 'We work with Ajrakh printers in Kutch and dye every metre with indigo, madder and pomegranate rind. Small batches, made to last.',
}
