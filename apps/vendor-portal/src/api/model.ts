/**
 * The seller portal's view models: what the screens read and write. Screens never see vendor-api's
 * shapes (`schema.d.ts`, `proposed.d.ts`); `src/api/adapters/*` translate, and `src/api/queries.ts`
 * returns these. The Build 2 types keep the names, fields and meaning of Build 2's draft contract,
 * so the screens did not change; `Schemas['X']` still names each one.
 */

// ---- who and where -------------------------------------------------------------------------------

export type Sells = 'women' | 'men' | 'both'
export type Gender = 'Women' | 'Men' | 'Unisex'
export type ProductType =
  | 'Kurtas' | 'Kurtis' | 'Sarees' | 'Lehengas' | 'Dupattas' | 'Stoles'
  | 'Shirts' | 'T-shirts' | 'Tops' | 'Dresses' | 'Co-ords'
  | 'Skirts' | 'Jeans' | 'Trousers' | 'Palazzos'
  | 'Jackets' | 'Blazers'

// ---- store details -------------------------------------------------------------------------------

/** Delivery time in days when the brand delivers itself (`1_2` = 1-2 days). */
export type DeliveryDays = '1_2' | '2_3' | '3_5' | '5_7'
export interface PickupAddress {
  line1: string
  area: string
  city: string
  pin: string
}
export interface DeliveryByShazlo {
  mode: 'shazlo'
  pickup_address: PickupAddress
}
export interface DeliveryByBrand {
  mode: 'own'
  areas: { all_india: boolean; places: string[] }
  delivery_days: DeliveryDays
}
export type Delivery = DeliveryByShazlo | DeliveryByBrand
/** Days a shopper has to ask for a return; 0 means no returns. */
export type ReturnWindowDays = 0 | 7 | 14 | 30
export type ReturnCondition = 'unworn_with_tags' | 'any_reason' | 'damaged_or_wrong'
/** Working days after pickup until the refund. */
export type RefundDays = 2 | 5 | 7
export interface Returns {
  window_days: ReturnWindowDays
  condition: ReturnCondition | null
  refund_days: RefundDays | null
}
export interface PayOnDelivery {
  cash: boolean
  upi: boolean
}
export interface BankPayoutInput {
  method: 'bank'
  holder_name: string
  account_number: string
  ifsc: string
}
export interface UpiPayoutInput {
  method: 'upi'
  upi_id: string
}
export type PayoutInput = BankPayoutInput | UpiPayoutInput
/** A saved bank account, masked. */
export interface BankPayout {
  method: 'bank'
  holder_name: string
  /** From the IFSC; null for a bank vendor-api does not list (the payout is still good). */
  bank_name: string | null
  account_last4: string
  ifsc: string
}
/** A saved UPI ID, masked. */
export interface UpiPayout {
  method: 'upi'
  upi_id: string
}
export type Payout = BankPayout | UpiPayout
export interface Contact {
  name: string
  phone: string
  email: string
}
export interface BusinessDetails {
  legal_name: string | null
  gstin: string | null
}
export interface StoreBrandInput {
  sells: Sells
  city: string
  instagram_or_website: string | null
}
/** A required store-details topic; `pay_on_delivery` is saved as the `payment` section. */
export type StoreTopic = 'brand' | 'contact' | 'delivery' | 'returns' | 'pay_on_delivery' | 'payout'
export interface StoreDetails {
  brand_name: string
  sells: Sells | null
  city: string | null
  instagram_or_website: string | null
  contact: Contact | null
  delivery: Delivery | null
  returns: Returns | null
  pay_on_delivery: PayOnDelivery | null
  payout: Payout | null
  business: BusinessDetails
  /** Required topics not yet complete, in page order. */
  missing: StoreTopic[]
  complete: boolean
  updated_at: string | null
}
export interface IfscBank {
  ifsc: string
  bank: string
  /** null until vendor-api has branch names (it bundles only the banks). */
  branch: string | null
}

// ---- sign-up -------------------------------------------------------------------------------------

/** Build 2's sign-up (V-02). `password` is the Contact step's new password (main's rules). */
export interface VendorApplication {
  brand_name: string
  sells: Sells
  city: string
  instagram_or_website?: string
  owner_name: string
  phone: string
  email: string
  /** Sent with the application; the account is created at once and the email must be verified. */
  password?: string
  delivery: Delivery
  returns: Returns
  pay_on_delivery: PayOnDelivery
  payout: PayoutInput
  legal_name?: string
  gstin?: string
  proposed_commission_bps?: number
  agreed_terms: true
  agreed_price_rule: true
}
/**
 * vendor-api answers every sign-up the same way, so nobody can learn whether an email has an
 * account: there is no application id (`id` is empty).
 */
export interface ApplicationReceipt {
  id: string
  status: 'applied'
}

// ---- commission and me ---------------------------------------------------------------------------

export type CommissionState = 'not_set' | 'proposed' | 'sent_back' | 'agreed'
export interface Commission {
  state: CommissionState
  agreed_bps: number | null
  proposed_bps: number | null
  note: string | null
  /** When the commission last changed; null before it ever did. */
  updated_at: string | null
}
export interface Me {
  vendor: {
    id: string
    brand_name: string
    /** `pending` until Shazlo approves the brand (it can sign in and prepare everything meanwhile). */
    status: 'approved' | 'pending' | 'suspended'
    /** vendor-api does not say when the brand was approved: always null. */
    approved_at: string | null
    commission_bps: number | null
    commission: Commission
  }
  user: {
    id: string
    /** The contact's name when this user is the store's contact, else the email. */
    name: string
    email: string
  }
  role: 'vendor_owner' | 'vendor_staff'
  setup: {
    password_set: boolean
    brand_page: boolean
    first_product: boolean
    store_details: boolean
    live_products: number
    live_target: number
  }
}
export interface StatusCounts {
  all: number
  approved: number
  pending_review: number
  rejected: number
  draft: number
  archived: number
}
export interface Summary {
  products: StatusCounts
  reviews_waiting: number
  oldest_waiting_hours: number | null
  sent_back: number
}

// ---- brand page ----------------------------------------------------------------------------------

export interface BrandProfile {
  brand_name: string
  based_in: string
  story: string
  logo_url: string | null
  cover_url: string | null
  /** Superseded by the store details' returns; carried through, never edited. */
  return_policy: 'no_returns' | '7_day' | '14_day'
  /** Superseded by the store details' delivery; carried through, never edited. */
  dispatch_time: '1_2_days' | '2_3_days' | '3_5_days' | '5_7_days'
  instagram: string
  website: string
}
export interface ReviewState {
  state: 'none' | 'waiting' | 'rejected' | 'approved'
  reason?: string
  at?: string
}
export interface BrandPage {
  live: BrandProfile | null
  live_since: string | null
  draft: BrandProfile | null
  draft_saved_at: string | null
  changed_fields: string[]
  review: ReviewState
}

// ---- products ------------------------------------------------------------------------------------

export type ProductStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'archived'
/** front, back, detail and worn: the 4 required photos; extra: up to 4 more; tryon: the 5 try-on photos. */
export type PhotoAngle = 'front' | 'back' | 'detail' | 'worn' | 'extra' | 'tryon'
/** Keys of a refused submit's `fields`, in this order. */
export type SubmitRequirement =
  | 'title' | 'gender' | 'category' | 'main_colour' | 'material' | 'description'
  | 'photos' | 'tryon' | 'variants' | 'price_paise' | 'store_details'
export interface ProductSummary {
  id: string
  title: string
  sku: string
  category: ProductType | null
  main_colour: string | null
  status: ProductStatus
  price_paise: number | null
  mrp_paise: number | null
  stock: number | null
  thumbnail_url: string | null
  updated_at: string
  edit_in_review: boolean
  /** Approved but not yet on the store; vendor-api has no such state, so always false. */
  publishing: boolean
}
export interface ProductPage {
  items: ProductSummary[]
  next_cursor: string | null
  total: number
  counts: StatusCounts
}
export interface Variant {
  size: string
  /** The size's automatic code; never called SKU in seller text. */
  sku: string
  stock: number
}
/** Every field is optional; only the ones sent change. */
export interface ProductInput {
  title?: string
  description?: string
  category?: ProductType | null
  gender?: Gender | null
  material?: string
  main_colour?: string | null
  other_colours?: string[]
  price_paise?: number | null
  mrp_paise?: number | null
  variants?: Variant[]
}
export interface ProductImage {
  /** The image's asset id. */
  id: string
  url: string
  angle: PhotoAngle
}
export interface ProductHistoryEntry {
  at: string
  event: 'created' | 'submitted' | 'rejected' | 'approved' | 'archived'
  note?: string
}
export interface Product {
  id: string
  title: string
  description: string
  category: ProductType | null
  gender: Gender | null
  material: string
  main_colour: string | null
  other_colours: string[]
  sku: string
  status: ProductStatus
  price_paise: number | null
  mrp_paise: number | null
  images: ProductImage[]
  variants: Variant[]
  review: ReviewState
  history: ProductHistoryEntry[]
  updated_at: string
  /** A change to a live product is waiting for review; the live version stays on sale. */
  edit_in_review: boolean
  /** What shoppers see now, beside the version being changed (the editor's revision card); null until one is approved. */
  live: ProductVersion | null
  /** The version being edited or reviewed; null when there is none (a live product nobody is changing). */
  working: WorkingVersion | null
}
/** One version of a product's content, as shoppers see it once approved. */
export interface ProductVersion {
  version: number
  title: string
  description: string
  category: ProductType | null
  gender: Gender | null
  material: string
  main_colour: string | null
  other_colours: string[]
  price_paise: number | null
  mrp_paise: number | null
  images: ProductImage[]
  variants: Variant[]
}
/** `submitted_at` is set once this version was sent for review: deleting then archives instead of erasing. */
export interface WorkingVersion {
  version: number
  state: 'editing' | 'in_review' | 'rejected' | 'withdrawn'
  submitted_at: string | null
}
export interface BulkResult {
  results: { id: string; ok: boolean; code?: string; message?: string }[]
}

// ---- review status -------------------------------------------------------------------------------

export interface ReviewItem {
  id: string
  subject: {
    type: 'product' | 'brand_page'
    id: string
    title: string
    detail?: string
    thumbnail_url?: string | null
  }
  kind: 'new' | 'edit'
  state: 'waiting' | 'rejected' | 'approved'
  submitted_at: string
  decided_at?: string
  reason?: string
  publishing?: boolean
}
export interface ReviewPage {
  items: ReviewItem[]
  counts: { all: number; waiting: number; rejected: number; approved: number }
}

// ---- bulk import ---------------------------------------------------------------------------------

/** The template's columns, in order (PDF section 4). */
export type ImportColumn =
  | 'product_name' | 'gender' | 'product_type' | 'main_colour' | 'other_colours'
  | 'selling_price' | 'sizes_stock' | 'description' | 'material' | 'mrp'
export interface ImportError {
  /** Spreadsheet row; the header is row 1. */
  row: number
  /** The row's product name, when the report says it. */
  product: string | null
  /** The column in plain words. */
  column: string
  field: ImportColumn | null
  /** vendor-api's code for the problem (`invalid_value`, `required`…), for the error report. */
  code: string
  message: string
}
export interface ImportJob {
  id: string
  status: 'checking' | 'ready' | 'committed' | 'failed'
  file_name: string
  total_rows: number
  ok_rows: number
  ok_products: number
  /** Products already in the seller's list: importing leaves them as they are. */
  unchanged: number
  error_rows: number
  errors: ImportError[]
  /** Header cells that are not template columns; they are ignored. */
  ignored_columns: string[]
  /** More problems than vendor-api lists: fix these, check again, and the rest show. */
  errors_truncated: boolean
}
export interface ImportCommit {
  created: number
  /** The drafts just created, in file order, so photos can be matched to them by name. */
  products: { id: string; title: string }[]
}
/** `validate` writes nothing; `import` creates every valid product; `all_or_nothing` creates nothing unless the whole file is valid. */
export type ImportMode = 'validate' | 'import' | 'all_or_nothing'
/** One run of the import, as vendor-api reports it (main's validate-first flow). */
export interface ImportReport {
  mode: ImportMode | string
  fileFormat: string
  committed: boolean
  summary: {
    products: number
    created: number
    unchanged: number
    valid: number
    rejected: number
    rowsRead: number
    rowsWithErrors: number
  }
  ignoredColumns: string[]
  products: { productId: string | null; code: string; rows: number[]; status: 'created' | 'unchanged' | 'valid' | 'rejected' | 'unknown' }[]
  errors: { row: number; column: string | null; code: string; message: string }[]
  errorsTruncated: boolean
}

// ---- size charts ---------------------------------------------------------------------------------

export type SizeChartGroup = 'bottoms' | 'tops' | 'dresses' | 'jackets'
/** Centimetres by size, then by measurement: `{ M: { bust: 96, waist: 84, hip: null } }`. */
export interface SizeChartMeasurements {
  [size: string]: { [measurement: string]: number | null }
}
export interface SizeChart {
  group: SizeChartGroup
  measurements: SizeChartMeasurements
  photo_url: string | null
  updated_at: string | null
}
export interface SizeChartInput {
  measurements: SizeChartMeasurements
  photo_url: string | null
}

// ---- uploads -------------------------------------------------------------------------------------

/** What the image is for; each maps to one of vendor-api's asset kinds. */
export type UploadPurpose = 'logo' | 'cover' | 'product' | 'size_chart'
/** An uploaded, registered image. `key` is its asset id. */
export interface UploadedImage {
  key: string
  url: string
}

// ---- account and team ----------------------------------------------------------------------------

export type TeamRole = 'owner' | 'staff'
/** `invited` until the person sets a password; `disabled` cannot sign in. */
export type TeamUserStatus = 'active' | 'invited' | 'disabled'
export interface TeamUser {
  id: string
  email: string
  role: TeamRole
  status: TeamUserStatus
  lastLoginAt: string | null
  createdAt: string
}

// ---- submissions (main's Review status data) -----------------------------------------------------

export type SubmissionStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn'
export interface Submission {
  id: string
  subject: 'brand_profile' | 'product'
  /** The product's code; null for the brand page. */
  code: string | null
  /** The product, when vendor-api names it (proposed); null for the brand page or before then. */
  productId: string | null
  title: string | null
  version: number
  status: SubmissionStatus
  reason: string | null
  submittedAt: string
  decidedAt: string | null
}
export interface SubmissionPage {
  items: Submission[]
  total: number
  limit: number
  offset: number
}

// ---- the old names -------------------------------------------------------------------------------

/** Build 2's `Schemas['X']` names for every view model, so screens keep importing them that way. */
export interface Schemas {
  Sells: Sells
  Gender: Gender
  ProductType: ProductType
  DeliveryDays: DeliveryDays
  PickupAddress: PickupAddress
  DeliveryByShazlo: DeliveryByShazlo
  DeliveryByBrand: DeliveryByBrand
  Delivery: Delivery
  ReturnWindowDays: ReturnWindowDays
  ReturnCondition: ReturnCondition
  RefundDays: RefundDays
  Returns: Returns
  PayOnDelivery: PayOnDelivery
  BankPayoutInput: BankPayoutInput
  UpiPayoutInput: UpiPayoutInput
  PayoutInput: PayoutInput
  BankPayout: BankPayout
  UpiPayout: UpiPayout
  Payout: Payout
  Contact: Contact
  BusinessDetails: BusinessDetails
  StoreBrandInput: StoreBrandInput
  StoreTopic: StoreTopic
  StoreDetails: StoreDetails
  IfscBank: IfscBank
  VendorApplication: VendorApplication
  ApplicationReceipt: ApplicationReceipt
  CommissionState: CommissionState
  Commission: Commission
  Me: Me
  Summary: Summary
  StatusCounts: StatusCounts
  BrandProfile: BrandProfile
  BrandPage: BrandPage
  ReviewState: ReviewState
  ProductStatus: ProductStatus
  PhotoAngle: PhotoAngle
  SubmitRequirement: SubmitRequirement
  ProductSummary: ProductSummary
  ProductPage: ProductPage
  Variant: Variant
  ProductInput: ProductInput
  Product: Product
  ProductVersion: ProductVersion
  WorkingVersion: WorkingVersion
  ReviewItem: ReviewItem
  ReviewPage: ReviewPage
  ImportColumn: ImportColumn
  ImportJob: ImportJob
  ImportCommit: ImportCommit
  SizeChartGroup: SizeChartGroup
  SizeChartMeasurements: SizeChartMeasurements
  SizeChart: SizeChart
  SizeChartInput: SizeChartInput
}
