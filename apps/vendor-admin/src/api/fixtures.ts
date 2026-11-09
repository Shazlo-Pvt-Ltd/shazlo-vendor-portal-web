// Sample data copied from the Penpot boards A-04 to A-10 (Shazlo-One admin). Items the boards do not
// show (the rest of the 14 queue items and 36 vendors) are filled in so every count is real.
import type { BrandSubmission, OutboxEvent, ProductSubmission, Vendor, VendorStatus } from './types'

/* ---------- Vendors ---------- */

const autoChecks = (city: string): Vendor['checks'] => [
  { ok: true, text: 'No other vendor or application uses this email or phone' },
  { ok: true, text: `City is in the launch area (${city})` },
  { ok: true, text: 'Instagram account has a year or more of posts' },
  { ok: true, text: 'Not on the blocked list' },
]

const initialsOf = (brand: string) =>
  brand.replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('')

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

interface VendorSeed {
  id: string
  brand: string
  city: string
  categories: string[]
  owner: string
  phone: string
  status: VendorStatus
  since: string
  live: number | null
  commission: number | null
}

function makeVendor(s: VendorSeed, seq: number): Vendor {
  const handle = slug(s.brand)
  const approvedLike = s.status === 'approved' || s.status === 'suspended'
  return {
    id: s.id,
    applicationRef: `A-0${(100 + seq).toString()}`,
    brand: s.brand,
    initials: initialsOf(s.brand),
    city: s.city,
    categories: s.categories,
    owner: s.owner,
    phone: s.phone,
    email: `hello@${handle}.in`,
    instagram: `instagram.com/${handle}`,
    priceRange: '₹800 – ₹4,500',
    about: `${s.categories.map(c => c[0]!.toUpperCase() + c.slice(1)).join(' and ')} from ${s.city}, made in small batches.`,
    liveCount: s.live,
    status: s.status,
    sinceLabel: s.since,
    appliedLabel: `${s.since}, 10:00`,
    commissionPct: s.commission,
    checks: autoChecks(s.city),
    activity: [
      ...(approvedLike ? [{ title: 'Approved and invited', at: `${s.since}, 16:20` }] : []),
      { title: 'Application received', at: `${s.since}, 10:00` },
    ],
    ownerLogin: approvedLike ? `hello@${handle}.in` : undefined,
    seq,
  }
}

const saanjh: Vendor = {
  id: 'v_saanjh',
  applicationRef: 'A-0142',
  brand: 'Saanjh Label',
  initials: 'SL',
  city: 'Ahmedabad',
  categories: ['kurtas', 'co-ords'],
  owner: 'Meher Joshi',
  phone: '+91 99241 18850',
  email: 'hello@saanjhlabel.in',
  instagram: 'instagram.com/saanjh.label',
  priceRange: '₹900 – ₹3,200',
  about: 'Small-batch cotton kurtas and co-ords, hand-finished in our Maninagar studio. 40+ designs, sold on Instagram since 2024.',
  liveCount: null,
  status: 'under_review',
  sinceLabel: '23 Oct',
  appliedLabel: '23 Oct, 09:10',
  commissionPct: null,
  checks: [
    { ok: true, text: 'No other vendor or application uses this email or phone' },
    { ok: true, text: 'City is in the launch area (Ahmedabad)' },
    { ok: false, text: 'Instagram account is 4 months old; check it has real customers' },
    { ok: true, text: 'Not on the blocked list' },
  ],
  activity: [
    { title: 'Vendor replied with 3 product photos', at: '24 Oct, 18:02' },
    { title: 'More info requested by Priya Mehta', at: '24 Oct, 10:31', quote: '“Please share photos of 3 products you plan to list.”' },
    { title: 'Opened for review by Priya Mehta', at: '24 Oct, 10:30', transition: 'applied → under_review' },
    { title: 'Application received', at: '23 Oct, 09:10' },
  ],
  seq: 0,
}

const rann: Vendor = {
  ...makeVendor({ id: 'v_rann', brand: 'Rann Weaves', city: 'Bhuj', categories: ['stoles', 'shawls'], owner: 'Aarti Chauhan', phone: '+91 98790 22471', status: 'applied', since: 'Today', live: null, commission: null }, 1),
  applicationRef: 'A-0147',
  email: 'aarti@rannweaves.in',
  instagram: 'instagram.com/rann.weaves',
  priceRange: '₹1,200 – ₹6,500',
  about: 'Hand-woven Kala cotton and wool stoles and shawls from weaver families in Bhujodi.',
  appliedLabel: 'Today, 11:55',
  activity: [{ title: 'Application received', at: 'Today, 11:55' }],
  checks: [
    { ok: true, text: 'No other vendor or application uses this email or phone' },
    { ok: false, text: 'Bhuj is outside the launch area (Ahmedabad); check they can ship from there' },
    { ok: true, text: 'Instagram account has a year or more of posts' },
    { ok: true, text: 'Not on the blocked list' },
  ],
}

const kaaya: Vendor = {
  ...makeVendor({ id: 'v_kaaya', brand: 'Kaaya Ethnic', city: 'Vadodara', categories: ['sarees'], owner: 'Pooja Trivedi', phone: '+91 97230 66012', status: 'applied', since: 'Yesterday', live: null, commission: null }, 2),
  applicationRef: 'A-0145',
  appliedLabel: 'Yesterday, 17:40',
  priceRange: '₹1,800 – ₹9,000',
  about: 'Bandhani and Gharchola sarees, sourced from Jamnagar dyers and finished in Vadodara.',
  activity: [{ title: 'Application received', at: 'Yesterday, 17:40' }],
}

const kalki: Vendor = {
  ...makeVendor({ id: 'v_kalki', brand: 'Kalki Studio', city: 'Ahmedabad', categories: ['kurtas', 'dupattas'], owner: 'Kiran Shah', phone: '+91 98250 41376', status: 'approved', since: '14 Oct', live: 18, commission: 15 }, 3),
  email: 'kiran@kalkistudio.in',
  ownerLogin: 'kiran@kalkistudio.in',
  instagram: 'instagram.com/kalki.studio',
}

const seeds: VendorSeed[] = [
  { id: 'v_nila', brand: 'Nila Handloom', city: 'Patan', categories: ['sarees', 'stoles'], owner: 'Hetal Prajapati', phone: '+91 94272 30118', status: 'approved', since: '28 Sep', live: 31, commission: 15 },
  { id: 'v_morpankh', brand: 'Mor Pankh Clothing', city: 'Ahmedabad', categories: ['dupattas'], owner: 'Devansh Patel', phone: '+91 90990 75543', status: 'approved', since: '2 Oct', live: 12, commission: 15 },
  { id: 'v_ivory', brand: 'Studio Ivory', city: 'Surat', categories: ['western wear'], owner: 'Rohan Mehta', phone: '+91 98980 14409', status: 'suspended', since: '20 Oct', live: 0, commission: 15 },
  { id: 'v_athread', brand: 'Ahmedabad Thread Co.', city: 'Ahmedabad', categories: ['menswear'], owner: 'Farhan Shaikh', phone: '+91 99045 81122', status: 'rejected', since: '19 Oct', live: null, commission: null },
  { id: 'v_kesariya', brand: 'Kesariya Prints', city: 'Ahmedabad', categories: ['kurtas', 'dupattas'], owner: 'Nisha Patel', phone: '+91 98251 33410', status: 'approved', since: '1 Oct', live: 22, commission: 15 },
  { id: 'v_indigoloom', brand: 'Indigo Loom', city: 'Ahmedabad', categories: ['shirts', 'kurtas'], owner: 'Arjun Desai', phone: '+91 99099 21567', status: 'approved', since: '30 Sep', live: 16, commission: 15 },
  { id: 'v_bandhej', brand: 'Bandhej House', city: 'Jamnagar', categories: ['sarees', 'dupattas'], owner: 'Kavita Joshi', phone: '+91 94262 77018', status: 'approved', since: '29 Sep', live: 27, commission: 15 },
  { id: 'v_sutra', brand: 'Sutra Collective', city: 'Vadodara', categories: ['co-ords', 'kurtas'], owner: 'Ritu Shah', phone: '+91 97370 40592', status: 'approved', since: '3 Oct', live: 14, commission: 15 },
  { id: 'v_kutchkala', brand: 'Kutch Kala', city: 'Bhuj', categories: ['jackets', 'stoles'], owner: 'Ramesh Ahir', phone: '+91 94281 56230', status: 'approved', since: '5 Oct', live: 9, commission: 15 },
  { id: 'v_ambar', brand: 'Ambar Textiles', city: 'Surat', categories: ['sarees'], owner: 'Mehul Kapadia', phone: '+91 98795 11846', status: 'approved', since: '26 Sep', live: 38, commission: 15 },
  { id: 'v_rangrez', brand: 'Rangrez Studio', city: 'Ahmedabad', categories: ['dupattas', 'stoles'], owner: 'Zoya Mansuri', phone: '+91 90330 62417', status: 'approved', since: '7 Oct', live: 11, commission: 15 },
  { id: 'v_moti', brand: 'Moti Weaves', city: 'Patan', categories: ['sarees'], owner: 'Bhavesh Salvi', phone: '+91 94090 38821', status: 'approved', since: '27 Sep', live: 19, commission: 15 },
  { id: 'v_gulmohar', brand: 'Gulmohar Label', city: 'Ahmedabad', categories: ['kurtas'], owner: 'Sneha Iyer', phone: '+91 99780 45126', status: 'approved', since: '8 Oct', live: 13, commission: 15 },
  { id: 'v_taana', brand: 'Taana Baana', city: 'Surat', categories: ['sarees', 'co-ords'], owner: 'Dhruv Mehta', phone: '+91 98242 90734', status: 'approved', since: '4 Oct', live: 24, commission: 15 },
  { id: 'v_ajrakhpur', brand: 'Ajrakhpur Crafts', city: 'Bhuj', categories: ['kurtas', 'stoles'], owner: 'Ismail Khatri', phone: '+91 94264 17389', status: 'approved', since: '25 Sep', live: 29, commission: 15 },
  { id: 'v_saffron', brand: 'Saffron Thread', city: 'Rajkot', categories: ['kurtas', 'co-ords'], owner: 'Hiral Vyas', phone: '+91 97129 53408', status: 'approved', since: '9 Oct', live: 8, commission: 15 },
  { id: 'v_neelkamal', brand: 'Neel Kamal Designs', city: 'Vadodara', categories: ['sarees'], owner: 'Komal Rathod', phone: '+91 99250 74163', status: 'approved', since: '6 Oct', live: 17, commission: 15 },
  { id: 'v_chhapa', brand: 'Chhapa Co.', city: 'Ahmedabad', categories: ['shirts'], owner: 'Yash Thakkar', phone: '+91 98986 30275', status: 'approved', since: '10 Oct', live: 10, commission: 15 },
  { id: 'v_mitti', brand: 'Mitti Label', city: 'Gandhinagar', categories: ['co-ords'], owner: 'Ananya Bhatt', phone: '+91 90813 27694', status: 'approved', since: '11 Oct', live: 7, commission: 15 },
  { id: 'v_rabari', brand: 'Rabari Threads', city: 'Bhuj', categories: ['jackets', 'dupattas'], owner: 'Lakha Rabari', phone: '+91 94276 81052', status: 'approved', since: '12 Oct', live: 6, commission: 15 },
  { id: 'v_patola', brand: 'Patola Ghar', city: 'Patan', categories: ['sarees', 'dupattas'], owner: 'Rohit Salvi', phone: '+91 98790 64318', status: 'approved', since: '24 Sep', live: 21, commission: 15 },
  { id: 'v_lehar', brand: 'Lehar Studio', city: 'Surat', categories: ['western wear'], owner: 'Tanvi Choksi', phone: '+91 99133 08547', status: 'approved', since: '13 Oct', live: 15, commission: 15 },
  { id: 'v_khadi', brand: 'Khadi Kotha', city: 'Ahmedabad', categories: ['kurtas', 'shirts'], owner: 'Manish Parmar', phone: '+91 97277 41960', status: 'approved', since: '15 Oct', live: 12, commission: 15 },
  { id: 'v_varsha', brand: 'Varsha Handloom', city: 'Rajkot', categories: ['sarees'], owner: 'Varsha Gohil', phone: '+91 94084 22751', status: 'approved', since: '16 Oct', live: 9, commission: 15 },
  { id: 'v_bagh', brand: 'Bagh Prints', city: 'Vadodara', categories: ['dupattas'], owner: 'Farida Bohra', phone: '+91 98253 86609', status: 'approved', since: '17 Oct', live: 11, commission: 15 },
  { id: 'v_charkha', brand: 'Charkha Label', city: 'Anand', categories: ['kurtas'], owner: 'Jignesh Patel', phone: '+91 99798 15432', status: 'approved', since: '18 Oct', live: 5, commission: 15 },
  { id: 'v_ruhani', brand: 'Ruhani Studio', city: 'Ahmedabad', categories: ['co-ords', 'kurtas'], owner: 'Sana Qureshi', phone: '+91 90167 59321', status: 'approved', since: '19 Oct', live: 8, commission: 15 },
  { id: 'v_haveli', brand: 'Haveli Weaves', city: 'Jamnagar', categories: ['stoles', 'shawls'], owner: 'Prakash Jadeja', phone: '+91 94291 70843', status: 'approved', since: '21 Oct', live: 4, commission: 15 },
  { id: 'v_tilak', brand: 'Tilak Menswear', city: 'Surat', categories: ['menswear'], owner: 'Kunal Shah', phone: '+91 98249 36175', status: 'approved', since: '22 Oct', live: 6, commission: 15 },
  { id: 'v_quickfashion', brand: 'QuickFashion Hub', city: 'Mumbai', categories: ['western wear'], owner: 'Rahul Verma', phone: '+91 98200 41733', status: 'rejected', since: '16 Oct', live: null, commission: null },
  { id: 'v_trendz', brand: 'Trendz Outlet', city: 'Pune', categories: ['menswear'], owner: 'Amit Kulkarni', phone: '+91 98220 58614', status: 'rejected', since: '11 Oct', live: null, commission: null },
  { id: 'v_sona', brand: 'Sona Silks', city: 'Kolkata', categories: ['sarees'], owner: 'Debjani Sen', phone: '+91 98310 27459', status: 'rejected', since: '8 Oct', live: null, commission: null },
]

const rejectionNote = (v: Vendor): Vendor =>
  v.status === 'rejected'
    ? {
        ...v,
        statusReason: v.city === 'Ahmedabad' ? 'Sells machine-made menswear only; Shazlo lists handmade and small-batch labels.' : `${v.city} is outside the launch area (Ahmedabad and nearby).`,
        activity: [{ title: 'Rejected by Rahul Desai', at: `${v.sinceLabel}, 15:00`, transition: 'under_review → rejected' }, ...v.activity],
      }
    : v.status === 'suspended'
      ? {
          ...v,
          statusReason: 'Orders shipped late three times in October. Suspended until the dispatch plan is fixed.',
          activity: [{ title: 'Suspended by Naman Sinha', at: `${v.sinceLabel}, 12:10`, transition: 'approved → suspended' }, ...v.activity],
        }
      : v

export const initialVendors: Vendor[] = [
  saanjh,
  rann,
  kaaya,
  kalki,
  ...seeds.map((s, i) => rejectionNote(makeVendor(s, i + 4))),
]

/* ---------- Product submissions ---------- */

const photos = (labels: string[], fresh: string[] = []) => labels.map(label => ({ label, isNew: fresh.includes(label) || undefined }))

export const initialProducts: Array<ProductSubmission & { seq: number; waitingMinutes: number; submittedDay: 'today' | 'yesterday' | 'earlier'; queueSubmitted: string }> = [
  {
    id: 'p_dabu_skirt', seq: 2, sku: 'KS-DAB-040', title: 'Dabu Print Wrap Skirt', vendorId: 'v_kalki', vendorName: 'Kalki Studio', change: 'new',
    submittedLabel: '18 Oct, 16:20', queueSubmitted: '18 Oct, 16:20', submittedDay: 'earlier', waitingMinutes: 19 * 60,
    photos: photos(['Front', 'Back', 'Close-up']),
    description: 'Wrap skirt in mud-resist Dabu printed cotton from Akola, dyed with indigo. Tie waist, ankle length. Hand wash cold.',
    fields: [
      { field: 'Photos', before: null, after: 'Front, back, close-up (3)' },
      { field: 'Title', before: null, after: 'Dabu Print Wrap Skirt' },
      { field: 'Price', before: null, after: '₹1,899 · MRP ₹2,299' },
      { field: 'Type', before: null, after: 'Skirt · Women · Cotton' },
      { field: 'Stock', before: null, after: 'S 5 · M 8 · L 6 · XL 3' },
    ],
    status: 'pending',
  },
  {
    id: 'p_ajrakh_kurta', seq: 4, sku: 'KS-AJR-014', title: 'Ajrakh Block-Print Kurta', vendorId: 'v_kalki', vendorName: 'Kalki Studio', change: 'resubmission', resubmission: 2,
    submittedLabel: 'today, 12:30', queueSubmitted: 'Today, 12:30', submittedDay: 'today', waitingMinutes: 2 * 60,
    note: 'sent back once before for a missing back photo',
    photos: photos(['Front', 'Back', 'Close-up', 'Extra'], ['Back']),
    description: 'Straight-cut kurta in hand block-printed Ajrakh cotton, dyed with indigo and madder. Side slits, three-quarter sleeves. Hand wash cold.',
    fields: [
      { field: 'Photos', before: 'Front, close-up, extra (3)', after: 'Front, back, close-up, extra (4)' },
      { field: 'Title', before: 'Ajrakh Block-Print Kurta', after: 'Ajrakh Block-Print Kurta' },
      { field: 'Price', before: '₹2,499 · MRP ₹2,999', after: '₹2,499 · MRP ₹2,999' },
      { field: 'Type', before: 'Kurta · Women · Cotton (mul)', after: 'Kurta · Women · Cotton (mul)' },
      { field: 'Stock', before: 'XS 4 · S 8 · M 10 · L 6 · XL 0', after: 'XS 4 · S 8 · M 10 · L 6 · XL 0' },
    ],
    previousDecision: { by: 'Rahul Desai', at: 'today, 11:40', message: '“Back photo is missing. Add front, back and a fabric close-up so shoppers can see the print.”' },
    status: 'pending',
  },
  {
    id: 'p_handloom_shirt', seq: 5, sku: 'KS-HCS-003', title: 'Handloom Cotton Shirt — Rust', vendorId: 'v_kalki', vendorName: 'Kalki Studio', change: 'edit',
    submittedLabel: 'yesterday, 16:05', queueSubmitted: 'Yesterday', submittedDay: 'yesterday', waitingMinutes: 22 * 60,
    note: 'edit to a live product; the live version stays in the app until this is approved',
    photos: photos(['Front', 'Back', 'Close-up', 'Extra'], ['Extra']),
    description: 'Relaxed shirt in handloom cotton, dyed rust with natural kattha. Mandarin collar, coconut-shell buttons. Hand wash cold.',
    fields: [
      { field: 'Photos', before: 'Front, back, close-up (3)', after: 'Front, back, close-up, extra (4)' },
      { field: 'Title', before: 'Handloom Cotton Shirt — Rust', after: 'Handloom Cotton Shirt — Rust' },
      { field: 'Price', before: '₹1,599 · MRP ₹1,999', after: '₹1,499 · MRP ₹1,999' },
      { field: 'Type', before: 'Shirt · Men · Cotton (handloom)', after: 'Shirt · Men · Cotton (handloom)' },
      { field: 'Stock', before: 'S 6 · M 8 · L 5 · XL 2', after: 'S 6 · M 8 · L 5 · XL 2' },
    ],
    status: 'pending',
  },
  {
    id: 'p_phulkari_dupatta', seq: 6, sku: 'MP-PHL-002', title: 'Phulkari Dupatta — Mustard', vendorId: 'v_morpankh', vendorName: 'Mor Pankh Clothing', change: 'new',
    submittedLabel: 'today, 10:48', queueSubmitted: 'Today, 10:48', submittedDay: 'today', waitingMinutes: 3 * 60,
    photos: photos(['Front', 'Close-up', 'Extra']),
    description: 'Mustard georgette dupatta with hand-embroidered Phulkari florals in silk thread. 2.25 m. Dry clean only.',
    fields: [
      { field: 'Photos', before: null, after: 'Front, close-up, extra (3)' },
      { field: 'Title', before: null, after: 'Phulkari Dupatta — Mustard' },
      { field: 'Price', before: null, after: '₹1,450 · MRP ₹1,800' },
      { field: 'Type', before: null, after: 'Dupatta · Women · Georgette' },
      { field: 'Stock', before: null, after: 'Free size 14' },
    ],
    status: 'pending',
  },
  {
    id: 'p_bandhej_saree', seq: 9, sku: 'NH-BND-021', title: 'Bandhej Cotton Saree — Rani', vendorId: 'v_nila', vendorName: 'Nila Handloom', change: 'resubmission', resubmission: 1,
    submittedLabel: 'today, 12:05', queueSubmitted: 'Today, 12:05', submittedDay: 'today', waitingMinutes: 2 * 60 + 25,
    note: 'sent back once before for a price that didn’t match the tag',
    photos: photos(['Front', 'Back', 'Close-up']),
    description: 'Rani pink tie-dyed Bandhej saree in fine cotton with a woven border. 5.5 m with blouse piece. Dry clean first wash.',
    fields: [
      { field: 'Photos', before: 'Front, back, close-up (3)', after: 'Front, back, close-up (3)' },
      { field: 'Title', before: 'Bandhej Cotton Saree — Rani', after: 'Bandhej Cotton Saree — Rani' },
      { field: 'Price', before: '₹2,200 · MRP ₹3,200', after: '₹3,200 · MRP ₹3,200' },
      { field: 'Type', before: 'Saree · Women · Cotton', after: 'Saree · Women · Cotton' },
      { field: 'Stock', before: 'Free size 6', after: 'Free size 6' },
    ],
    previousDecision: { by: 'Priya Mehta', at: '20 Oct, 15:10', message: '“The tag in the photo says ₹3,200 but the listing price is ₹2,200. Please check the price.”' },
    status: 'pending',
  },
  {
    id: 'p_potli_bag', seq: 10, sku: 'MP-POT-007', title: 'Mirror-Work Potli Bag', vendorId: 'v_morpankh', vendorName: 'Mor Pankh Clothing', change: 'new',
    submittedLabel: 'today, 12:50', queueSubmitted: 'Today, 12:50', submittedDay: 'today', waitingMinutes: 100,
    photos: photos(['Front', 'Back', 'Close-up']),
    description: 'Drawstring potli in maroon cotton silk with Kutch mirror-work and a tasselled cord. Lined inside.',
    fields: [
      { field: 'Photos', before: null, after: 'Front, back, close-up (3)' },
      { field: 'Title', before: null, after: 'Mirror-Work Potli Bag' },
      { field: 'Price', before: null, after: '₹749 · MRP ₹899' },
      { field: 'Type', before: null, after: 'Bag · Women · Cotton silk' },
      { field: 'Stock', before: null, after: 'One size 20' },
    ],
    status: 'pending',
  },
  {
    id: 'p_dabu_set', seq: 11, sku: 'KS-DAB-052', title: 'Indigo Dabu Kurta Set', vendorId: 'v_kalki', vendorName: 'Kalki Studio', change: 'edit',
    submittedLabel: 'today, 13:05', queueSubmitted: 'Today, 13:05', submittedDay: 'today', waitingMinutes: 85,
    note: 'edit to a live product; the live version stays in the app until this is approved',
    photos: photos(['Front', 'Back', 'Close-up', 'Extra']),
    description: 'Kurta and straight pants in indigo Dabu-printed cotton. Kurta lined at the yoke; pants with an elastic back. Hand wash cold, separately.',
    fields: [
      { field: 'Photos', before: 'Front, back, close-up, extra (4)', after: 'Front, back, close-up, extra (4)' },
      { field: 'Title', before: 'Indigo Dabu Kurta Set', after: 'Indigo Dabu Kurta Set' },
      { field: 'Price', before: '₹3,299 · MRP ₹3,799', after: '₹3,299 · MRP ₹3,799' },
      { field: 'Type', before: 'Kurta set · Women · Cotton', after: 'Kurta set · Women · Cotton' },
      { field: 'Stock', before: 'S 3 · M 5 · L 4', after: 'S 3 · M 5 · L 4 · XL 2' },
    ],
    status: 'pending',
  },
  {
    id: 'p_patola_stole', seq: 12, sku: 'NH-PAT-009', title: 'Patola Silk Stole', vendorId: 'v_nila', vendorName: 'Nila Handloom', change: 'resubmission', resubmission: 1,
    submittedLabel: 'today, 13:20', queueSubmitted: 'Today, 13:20', submittedDay: 'today', waitingMinutes: 70,
    note: 'sent back once before for blurry photos',
    photos: photos(['Front', 'Close-up', 'Extra'], ['Front', 'Close-up']),
    description: 'Single-ikat Patola stole in mulberry silk, woven on a Patan pit loom. 2 m × 0.5 m. Dry clean only.',
    fields: [
      { field: 'Photos', before: 'Front, close-up, extra (3)', after: 'Front, close-up, extra (3), 2 replaced' },
      { field: 'Title', before: 'Patola Silk Stole', after: 'Patola Silk Stole' },
      { field: 'Price', before: '₹4,800 · MRP ₹5,400', after: '₹4,800 · MRP ₹5,400' },
      { field: 'Type', before: 'Stole · Women · Silk (mulberry)', after: 'Stole · Women · Silk (mulberry)' },
      { field: 'Stock', before: 'Free size 3', after: 'Free size 3' },
    ],
    previousDecision: { by: 'Rahul Desai', at: '22 Oct, 12:15', message: '“Front and close-up photos are blurry. Please reshoot them in daylight.”' },
    status: 'pending',
  },
  {
    id: 'p_chikankari_kurta', seq: 13, sku: 'MP-CHK-011', title: 'Chikankari Kurta — Ivory', vendorId: 'v_morpankh', vendorName: 'Mor Pankh Clothing', change: 'new',
    submittedLabel: 'today, 13:40', queueSubmitted: 'Today, 13:40', submittedDay: 'today', waitingMinutes: 50,
    photos: photos(['Front', 'Back', 'Close-up']),
    description: 'Ivory mul cotton kurta with hand Chikankari on the yoke and sleeves. A-line, calf length. Comes with a slip.',
    fields: [
      { field: 'Photos', before: null, after: 'Front, back, close-up (3)' },
      { field: 'Title', before: null, after: 'Chikankari Kurta — Ivory' },
      { field: 'Price', before: null, after: '₹2,150 · MRP ₹2,600' },
      { field: 'Type', before: null, after: 'Kurta · Women · Cotton (mul)' },
      { field: 'Stock', before: null, after: 'S 4 · M 6 · L 4 · XL 2' },
    ],
    status: 'pending',
  },
]

/* ---------- Brand page submissions ---------- */

const nilaLive = {
  cover: 'nila-cover-1',
  logo: 'nila-logo-1',
  name: 'Nila Handloom',
  tagline: 'Handwoven in Patan since 1987.',
  location: 'Patan',
  dispatch: 'Ships in 3–5 days',
  story: 'Handwoven sarees and stoles from Patan, Gujarat.',
  returnPolicy: 'Returns within 7 days, unworn with tags.',
}

const morPankhLive = {
  cover: 'mp-cover-1',
  logo: 'mp-logo-1',
  name: 'Mor Pankh Clothing',
  tagline: 'Dupattas with a story.',
  location: 'Ahmedabad',
  dispatch: 'Ships in 2–4 days',
  story: 'Hand-embroidered dupattas made with women artisans in old Ahmedabad.',
  returnPolicy: 'Returns within 7 days, unworn with tags.',
}

export const initialBrands: Array<BrandSubmission & { seq: number; waitingMinutes: number; submittedDay: 'today' | 'yesterday' | 'earlier'; queueSubmitted: string }> = [
  {
    id: 'b_nila', seq: 3, vendorId: 'v_nila', vendorName: 'Nila Handloom', submittedLabel: 'today, 08:05', queueSubmitted: 'Today, 08:05', submittedDay: 'today', waitingMinutes: 6 * 60,
    livePublishedLabel: '12 Oct',
    live: nilaLive,
    draft: { ...nilaLive, cover: 'nila-cover-2', story: 'Three generations of weavers in Patan. Every saree and stole is woven on pit looms with natural dyes: slower, and better for it.' },
    status: 'pending',
  },
  {
    id: 'b_morpankh', seq: 14, vendorId: 'v_morpankh', vendorName: 'Mor Pankh Clothing', submittedLabel: 'today, 13:55', queueSubmitted: 'Today, 13:55', submittedDay: 'today', waitingMinutes: 35,
    livePublishedLabel: '4 Oct',
    live: morPankhLive,
    draft: { ...morPankhLive, tagline: 'Hand-embroidered dupattas from old Ahmedabad.' },
    status: 'pending',
  },
]

/** Queue position and waiting time of the vendor applications (A-04 rows). */
export const applicationQueue: Record<string, { seq: number; waitingMinutes: number; submittedDay: 'today' | 'yesterday' | 'earlier'; queueSubmitted: string }> = {
  v_saanjh: { seq: 1, waitingMinutes: 26 * 60, submittedDay: 'earlier', queueSubmitted: '23 Oct, 09:10' },
  v_rann: { seq: 7, waitingMinutes: 2 * 60, submittedDay: 'today', queueSubmitted: 'Today, 11:55' },
  v_kaaya: { seq: 8, waitingMinutes: 20 * 60, submittedDay: 'yesterday', queueSubmitted: 'Yesterday' },
}

export const initialStats = { approvedToday: 8, sentBackToday: 3, medianDecisionMinutes: 5 * 60 + 20 }

/* ---------- Publishing outbox ---------- */

const productPayload = (id: string, title: string, vendor: string, price: number) => ({
  product_id: id, vendor_id: vendor, title, min_price_paise: price, max_price_paise: price, commission_bps: 1500, version: 1,
})

export const initialOutbox: OutboxEvent[] = [
  {
    id: '0b8e2f4c-6a1d-4e7b-9c35-1f0d2a7c8e91', seq: 1, name: 'product.published', version: 1, item: 'Phulkari Dupatta — Mustard', status: 'failed', tries: 8, maxTries: 8,
    lastLabel: '13:02', idempotencyKey: 'product:MP-PHL-002:rev-3', approvedBy: 'Rahul Desai · today, 12:40',
    response: { at: '13:02', status: 422, body: 'price_paise must be greater than 0' },
    payload: productPayload('MP-PHL-002', 'Phulkari Dupatta — Mustard', 'v_morpankh', 0),
    hint: 'Tried 8 times over 6 hours (1 m, 5 m, 15 m, 1 h …). Retrying the same payload will fail again; fix the product price first, which creates a new revision and a new event.',
  },
  {
    id: '5d21a9e0-3c4b-4f8a-8e17-92b6c0d4a3f5', seq: 2, name: 'product.published', version: 1, item: 'Linen Co-ord Set — Indigo', status: 'retrying', tries: 3, maxTries: 8,
    lastLabel: '13:20', nextTryLabel: '13:24', idempotencyKey: 'product:SC-LCS-018:rev-1', approvedBy: 'Priya Mehta · today, 13:05',
    response: { at: '13:20', status: 503, body: 'central app unavailable, try again later' },
    payload: productPayload('SC-LCS-018', 'Linen Co-ord Set — Indigo', 'v_sutra', 289900),
  },
  {
    id: '9a7c3e12-0f5d-4b6e-a8c1-3d2e7f9b0c44', seq: 3, name: 'brand_profile.published', version: 1, item: 'Nila Handloom', status: 'waiting', tries: 0, maxTries: 8,
    lastLabel: null, idempotencyKey: 'brand_profile:v_nila:rev-4', approvedBy: 'Priya Mehta · today, 13:21',
    payload: { vendor_id: 'v_nila', name: 'Nila Handloom', version: 4 },
  },
  {
    id: 'c4f1b8d2-7e6a-4c3b-9d05-8a1e2f6b7c90', seq: 4, name: 'product.published', version: 1, item: 'Kutch Mirror-Work Tote', status: 'waiting', tries: 0, maxTries: 8,
    lastLabel: null, idempotencyKey: 'product:KK-TOT-004:rev-1', approvedBy: 'Rahul Desai · today, 13:22',
    payload: productPayload('KK-TOT-004', 'Kutch Mirror-Work Tote', 'v_kutchkala', 129900),
  },
  {
    id: 'e2b9d7a4-1c8f-4e5d-b3a6-0f4c9e2d1b78', seq: 5, name: 'vendor.status_changed', version: 1, item: 'Studio Ivory · suspended', status: 'delivered', tries: 1, maxTries: 8,
    lastLabel: '12:51', idempotencyKey: 'vendor:v_ivory:status-3', approvedBy: 'Naman Sinha · today, 12:51',
    response: { at: '12:51', status: 200, body: '{"accepted": true}' },
    payload: { vendor_id: 'v_ivory', status: 'suspended', version: 3 },
  },
  {
    id: 'f7a3c1e9-5b2d-4a8f-9e64-2c7b0d3f8a15', seq: 6, name: 'product.unpublished', version: 1, item: 'Kutch Mirror-Work Jacket', status: 'delivered', tries: 1, maxTries: 8,
    lastLabel: '12:40', idempotencyKey: 'product:KK-JKT-002:unpublish-2', approvedBy: 'Rahul Desai · today, 12:40',
    response: { at: '12:40', status: 200, body: '{"accepted": true}' },
    payload: { product_id: 'KK-JKT-002', reason: 'archived', version: 2 },
  },
  {
    id: '1d6e8b3f-9c2a-4f7e-8b15-6a0c4d9e2f37', seq: 7, name: 'product.published', version: 1, item: 'Bandhani Silk Dupatta', status: 'delivered', tries: 2, maxTries: 8,
    lastLabel: '11:03', idempotencyKey: 'product:BH-BSD-011:rev-1', approvedBy: 'Priya Mehta · today, 10:58',
    response: { at: '11:03', status: 200, body: '{"accepted": true}' },
    payload: productPayload('BH-BSD-011', 'Bandhani Silk Dupatta', 'v_bandhej', 219900),
  },
]

/** Delivered events older than the listed page, counted in the tabs (312 delivered in all). */
export const olderDelivered = 309
export const initialDelivered24h = 312
