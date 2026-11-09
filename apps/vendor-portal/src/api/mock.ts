// In-memory mock of vendor-api. vendor-api is still in Phase 2, so screens are built against
// this contract; each method is replaced by an HTTP call when its endpoint ships.
import { ago, DEMO_PASSWORD, demoSession, draftBrand, initialDecisions, initialProducts, publishedBrand } from './fixtures'
import {
  ApiError, type ApplicationInput, type BrandProfile, type BrandProfileFields, type ImportReport, type OverviewSummary, type Product,
  type ReviewDecision, type Session, type Submission,
} from './types'
import { importedProductNames, productCreatedAt } from './fixtures'

const clone = <T,>(v: T): T => structuredClone(v)
const wait = (ms = 250) => new Promise(r => setTimeout(r, import.meta.env.MODE === 'test' ? 0 : ms))

interface State {
  session: Session | null
  products: Product[]
  decisions: ReviewDecision[]
  brand: BrandProfile
  lastImport: CatalogImportReport | null
}

/** V-08: the contract's ImportReport plus image links that failed without blocking their product. */
export interface CatalogImportReport extends ImportReport {
  imageLinksFailed: number
}

/** One line of a product's review history (V-07 side column). */
export interface ProductEvent {
  id: string
  kind: 'created' | 'submitted' | 'edit_submitted' | 'approved' | 'sent_back' | 'archived'
  at: string
  note?: string
}

// Products created in this session remember when they were first saved.
const createdAt = new Map<string, string>()

function brandChanges(draft: BrandProfileFields, published: BrandProfileFields | null): Array<keyof BrandProfileFields> {
  if (!published) return Object.keys(draft) as Array<keyof BrandProfileFields>
  return (Object.keys(draft) as Array<keyof BrandProfileFields>).filter(k => JSON.stringify(draft[k]) !== JSON.stringify(published[k]))
}

function initialState(): State {
  const changed = brandChanges(draftBrand, publishedBrand)
  return {
    session: null,
    products: clone(initialProducts),
    decisions: clone(initialDecisions),
    brand: {
      published: clone(publishedBrand),
      draft: clone(draftBrand),
      publishedAt: '2026-10-20T15:00:00+05:30',
      changedFields: changed,
      status: 'draft_changes',
    },
    lastImport: null,
  }
}

// Development only: remember that someone signed in so a page reload keeps the demo session.
// This is a flag, never a token; real tokens stay in memory (ADR 0009).
const DEV_FLAG = 'shz-vendor-demo-signed-in'
const devRemember = (on: boolean) => {
  if (!import.meta.env.DEV || import.meta.env.MODE === 'test' || typeof sessionStorage === 'undefined') return
  if (on) sessionStorage.setItem(DEV_FLAG, '1')
  else sessionStorage.removeItem(DEV_FLAG)
}

let state = initialState()
if (import.meta.env.DEV && import.meta.env.MODE !== 'test' && typeof sessionStorage !== 'undefined' && sessionStorage.getItem(DEV_FLAG)) {
  state.session = clone(demoSession)
}

/** Test helper: start from the wireframe data again. */
export function resetMock(signedIn = false) {
  state = initialState()
  if (signedIn) state.session = clone(demoSession)
}

function requireSession(): Session {
  if (!state.session) throw new ApiError('unauthorized', 'Your session has ended. Sign in again.')
  return state.session
}

export const mockApi = {
  /* ---------- auth (V-01, V-02, V-03) ---------- */
  async signIn(email: string, password: string, remember: boolean): Promise<Session> {
    void remember // the real API sets a longer-lived refresh cookie
    await wait(400)
    if (email.trim().toLowerCase() !== demoSession.user.email || password !== DEMO_PASSWORD) {
      throw new ApiError('invalid_credentials', 'That email and password don’t match. Check both, or reset your password.')
    }
    state.session = clone(demoSession)
    devRemember(true)
    return clone(state.session)
  },
  async signOut(): Promise<void> {
    await wait(100)
    state.session = null
    devRemember(false)
  },
  async getSession(): Promise<Session | null> {
    await wait(50)
    return state.session ? clone(state.session) : null
  },
  async requestPasswordReset(email: string): Promise<void> {
    void email // same response whether or not the account exists
    await wait(300)
  },
  async apply(input: ApplicationInput): Promise<{ reference: string }> {
    await wait(500)
    if (input.email.trim().toLowerCase() === demoSession.user.email) {
      throw new ApiError('duplicate_application', 'There is already a seller account for this email. Sign in instead.', 'email')
    }
    return { reference: `APP-${Math.floor(10000 + Math.random() * 89999)}` }
  },
  async getInvite(token: string): Promise<{ email: string; brandName: string; expiresAt: string }> {
    await wait(200)
    if (token === 'expired') throw new ApiError('invite_expired', 'This invite link has expired. Ask partners@shazlo.store for a new one.')
    return { email: demoSession.user.email, brandName: demoSession.vendor.brandName, expiresAt: ago(-2 * 24 * 3_600_000) }
  },
  async setPassword(_token: string, password: string): Promise<Session> {
    await wait(400)
    if (password.length < 10) throw new ApiError('weak_password', 'Use at least 10 characters.', 'password')
    state.session = clone(demoSession)
    devRemember(true)
    return clone(state.session)
  },

  /* ---------- overview (V-04) ---------- */
  async getOverview(): Promise<OverviewSummary> {
    await wait()
    requireSession()
    const by = (s: Product['status']) => state.products.filter(p => p.status === s).length
    const live = by('approved')
    return {
      counts: { live, pending: by('pending_review'), sentBack: by('rejected'), drafts: by('draft'), total: state.products.length },
      recentDecisions: clone([...state.decisions].sort((a, b) => b.decidedAt.localeCompare(a.decidedAt)).slice(0, 5)),
      checklist: [
        { id: 'password', label: 'Set your password', done: true },
        { id: 'brand', label: 'Complete brand page', done: true },
        { id: 'first', label: 'Add your first product', done: state.products.length > 0 },
        { id: 'returns', label: 'Set your return policy', done: false },
        { id: 'ten', label: `List 10 products (${live} of 10)`, done: live >= 10 },
      ],
    }
  },

  /* ---------- products (V-06, V-07, V-08) ---------- */
  async listProducts(): Promise<Product[]> {
    await wait()
    requireSession()
    return clone(state.products)
  },
  async getProduct(id: string): Promise<Product> {
    await wait()
    requireSession()
    const p = state.products.find(x => x.id === id)
    if (!p) throw new ApiError('not_found', 'This product no longer exists.')
    return clone(p)
  },
  async saveProduct(input: Product): Promise<Product> {
    await wait(300)
    requireSession()
    const taken = new Map(state.products.filter(p => p.id !== input.id).flatMap(p => p.sizes.map(s => [s.sku.toUpperCase(), p.title] as const)))
    const clash = input.sizes.find(s => taken.has(s.sku.toUpperCase()))
    if (clash) throw new ApiError('duplicate_sku', `SKU ${clash.sku} is already used by ${taken.get(clash.sku.toUpperCase())}. Each SKU must be unique.`, 'sizes')
    const i = state.products.findIndex(p => p.id === input.id)
    const next = { ...clone(input), updatedAt: new Date().toISOString() }
    if (i === -1) {
      state.products.unshift(next)
      createdAt.set(next.id, next.updatedAt)
    } else state.products[i] = next
    return clone(next)
  },
  async getProductHistory(id: string): Promise<ProductEvent[]> {
    await wait(150)
    requireSession()
    const p = state.products.find(x => x.id === id)
    if (!p) throw new ApiError('not_found', 'This product no longer exists.')
    const decisions = state.decisions.filter(d => d.subject.kind === 'product' && d.subject.productId === id)
    const events: ProductEvent[] = []
    for (const d of decisions) {
      events.push({ id: `${d.id}-s`, kind: 'submitted', at: d.submittedAt })
      events.push({ id: d.id, kind: d.outcome === 'approved' ? 'approved' : 'sent_back', at: d.decidedAt, note: d.reason })
    }
    if (p.submittedAt && !decisions.some(d => d.submittedAt === p.submittedAt) && (p.status === 'pending_review' || p.pendingEdit)) {
      events.push({ id: `${id}-pending`, kind: p.pendingEdit ? 'edit_submitted' : 'submitted', at: p.submittedAt })
    }
    if (p.status === 'archived') events.push({ id: `${id}-archived`, kind: 'archived', at: p.updatedAt })
    const oldest = [p.updatedAt, ...events.map(e => e.at)].sort()[0] ?? p.updatedAt
    events.push({ id: `${id}-created`, kind: 'created', at: createdAt.get(id) ?? productCreatedAt[id] ?? oldest })
    return events.sort((a, b) => b.at.localeCompare(a.at))
  },
  async submitProducts(ids: string[]): Promise<Product[]> {
    await wait(400)
    requireSession()
    const now = new Date().toISOString()
    for (const p of state.products) {
      if (!ids.includes(p.id)) continue
      if (p.status === 'approved') p.pendingEdit = true
      else p.status = 'pending_review'
      p.submittedAt = now
      p.updatedAt = now
    }
    return clone(state.products.filter(p => ids.includes(p.id)))
  },
  async archiveProducts(ids: string[]): Promise<void> {
    await wait(300)
    requireSession()
    for (const p of state.products) if (ids.includes(p.id)) { p.status = 'archived'; p.pendingEdit = false; p.updatedAt = new Date().toISOString() }
  },
  async importCatalog(file: File): Promise<CatalogImportReport> {
    await wait(700)
    requireSession()
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      throw new ApiError('unsupported_file', `${file.name} isn’t a spreadsheet. Upload the template as .xlsx or .csv.`, 'file')
    }
    if (file.size === 0) throw new ApiError('empty_file', `${file.name} is empty. Fill in the template and upload it again.`, 'file')
    if (file.size > 10 * 1024 * 1024) throw new ApiError('file_too_large', 'Files can be up to 10 MB. Split the sheet into two files.', 'file')
    // The mock does not read the sheet; it returns the V-08 report for any file.
    const report: CatalogImportReport = {
      fileName: file.name,
      totalRows: 52,
      validRows: 47,
      imageLinksFailed: 3,
      uploadedAt: new Date().toISOString(),
      errors: [
        { row: 12, product: 'Bagru Print Palazzo', column: 'Price', message: 'Must be a number above 0. Found “1,299/-”; use 1299.' },
        { row: 19, product: 'Indigo Dabu Kurta', column: 'Size', message: '“Free size” is not supported. Use XS–XXL or One size.' },
        { row: 27, product: 'Kala Cotton Jacket', column: 'Image 1', message: 'Link could not be opened (access denied). Make the file public or upload it in the editor.' },
        { row: 33, product: '', column: 'Product name', message: 'Required. Add a product name.' },
        { row: 41, product: 'Mashru Silk Stole', column: 'Category', message: '“Stoles” is not a category. Closest match: Dupattas.' },
      ],
    }
    state.lastImport = report
    return clone(report)
  },
  async getLastImport(): Promise<CatalogImportReport | null> {
    await wait(100)
    return clone(state.lastImport)
  },
  /** Creates every valid row of the last import as a draft (V-08 step 4). Nothing goes live until it is reviewed. */
  async createDraftsFromImport(): Promise<number> {
    await wait(500)
    requireSession()
    const n = state.lastImport?.validRows ?? 0
    const now = new Date().toISOString()
    const categories = ['Kurtas', 'Dupattas', 'Jackets', 'Bottoms', 'Kurtis', 'Shirts', 'Sarees', 'Stoles', 'Shirts', 'Dresses', 'Shirts', 'Kurtas', 'Co-ords', 'Dupattas', 'Shirts']
    const drafts: Product[] = Array.from({ length: n }, (_, i) => {
      const k = i % importedProductNames.length
      const round = Math.floor(i / importedProductNames.length)
      const sku = `KS-IMP-${String(101 + i).padStart(3, '0')}`
      const price = 999 + ((i * 250) % 2500)
      return {
        id: `p_imp_${Date.now()}_${i}`,
        title: `${importedProductNames[k] ?? 'Imported product'}${round ? ` · Batch ${round + 1}` : ''}`,
        sku,
        category: categories[k] ?? 'Kurtas',
        gender: 'women',
        fabric: 'Cotton',
        description: '',
        price,
        mrp: Math.round(price * 1.2 / 50) * 50 - 1,
        sizes: ['S', 'M', 'L'].map(size => ({ size, sku: `${sku}-${size}`, stock: 4 })),
        images: [{ id: `${sku}-f`, slot: 'front', name: 'image-1.jpg' }, { id: `${sku}-b`, slot: 'back' }, { id: `${sku}-d`, slot: 'detail' }],
        status: 'draft',
        returnable: true,
        returnDays: 7,
        weightGrams: null,
        updatedAt: now,
      }
    })
    state.products.unshift(...drafts)
    for (const d of drafts) createdAt.set(d.id, now)
    state.lastImport = null
    return n
  },

  /* ---------- brand page (V-05) ---------- */
  async getBrandProfile(): Promise<BrandProfile> {
    await wait()
    requireSession()
    return clone(state.brand)
  },
  async saveBrandDraft(draft: BrandProfileFields): Promise<BrandProfile> {
    await wait(300)
    requireSession()
    // V-05 notes: submit locks the draft until a decision; brand name changes go through support.
    if (state.brand.status === 'pending_review') throw new ApiError('draft_locked', 'Your draft is with the review team. You can edit it again once they decide.')
    const next = { ...clone(draft), brandName: state.brand.published?.brandName ?? draft.brandName }
    state.brand.draft = next
    state.brand.changedFields = brandChanges(next, state.brand.published)
    state.brand.status = state.brand.changedFields.length ? 'draft_changes' : 'live'
    return clone(state.brand)
  },
  async discardBrandDraft(): Promise<BrandProfile> {
    await wait(300)
    requireSession()
    if (state.brand.status === 'pending_review') throw new ApiError('draft_locked', 'Your draft is with the review team. You can edit it again once they decide.')
    if (state.brand.published) state.brand.draft = clone(state.brand.published)
    state.brand.changedFields = []
    state.brand.status = 'live'
    state.brand.lastDecision = undefined
    return clone(state.brand)
  },
  async submitBrandPage(): Promise<BrandProfile> {
    await wait(400)
    requireSession()
    if (state.brand.status === 'pending_review') throw new ApiError('already_submitted', 'This draft is already with the review team.')
    if (!state.brand.changedFields.length) throw new ApiError('nothing_to_submit', 'Your draft matches the live page, so there is nothing to review.')
    state.brand.status = 'pending_review'
    state.brand.submittedAt = new Date().toISOString()
    return clone(state.brand)
  },

  /* ---------- review status (V-09) ---------- */
  async listSubmissions(): Promise<Submission[]> {
    await wait()
    requireSession()
    const pending: Submission[] = state.products
      .filter(p => p.status === 'pending_review' || (p.status === 'approved' && p.pendingEdit))
      .map(p => ({ id: `s_${p.id}`, subject: { kind: 'product', productId: p.id, title: p.title, sku: p.sku }, submittedAt: p.submittedAt ?? p.updatedAt }))
    if (state.brand.status === 'pending_review') {
      pending.push({ id: 's_brand', subject: { kind: 'brand_page', title: 'Brand page draft' }, submittedAt: state.brand.submittedAt ?? new Date().toISOString() })
    }
    // Waiting: oldest first (that is the one the SLA strip talks about). Decided: newest first.
    pending.sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))
    const decided: Submission[] = [...state.decisions]
      .sort((a, b) => b.decidedAt.localeCompare(a.decidedAt))
      .map(d => ({ id: `s_${d.id}`, subject: d.subject, submittedAt: d.submittedAt, decision: d }))
    return clone([...pending, ...decided])
  },
}

export type VendorApi = typeof mockApi
