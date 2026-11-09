// V-07 · Product editor (sent back) and V-07m · Product editor, sent back (mobile).
// One editor for new drafts, sent-back products, products in review and live products.
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useBlocker, useNavigate, useParams } from 'react-router'
import {
  Banner, Button, Card, Content, Dialog, EmptyState, Icon, kit, PageHeader, Select, Text, TextArea, TextInput, useToast,
} from '@shazlo/ui/components'
import { ApiError, type Product, type SizeStock } from '../../api'
import { keys, useArchiveProducts, useProduct, useProducts, useSaveProduct, useSubmitProducts } from '../../api/hooks'
import { useSession } from '../../app/session'
import { TopBar } from '../../app/topbar'
import { relativeTime, rupees } from '../../lib/format'
import {
  AddPhotoSlot, AddSizeButton, EditorSkeleton, HistoryCard, MAX_PHOTOS, MoneyInput, NetEarnings, normaliseImages, PhotoSlot, readPhoto,
  REQUIRED_SLOTS, ReturnsCard, ReviewRulesCard, SizesTable, SizeStepperRow, slotName, sortSizes, usePhotoPicker,
} from './editorParts'
import { ArchiveDialog, BarIcon, fabrics, genders, hasPhoto, MobilePageBar, ProductStatus, productTypes, RowMenu, savedAgo, useIsMobile } from './shared'

/* ---------- validation ---------- */

type FieldKey = 'images' | 'title' | 'description' | 'category' | 'fabric' | 'mrp' | 'price' | 'sizes'
type Errors = Partial<Record<FieldKey, string>>
type Mode = 'draft' | 'submit'

// Focus order on submit: the first problem on the page gets focus.
const FIELD_ORDER: FieldKey[] = ['images', 'title', 'description', 'category', 'fabric', 'mrp', 'price', 'sizes']

function joinWords(words: string[]) {
  return words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

function skuProblems(sizes: SizeStock[], taken: Map<string, string>) {
  const bad = new Set<string>()
  let message: string | undefined
  const seen = new Set<string>()
  for (const s of sizes) {
    const sku = s.sku.trim().toUpperCase()
    if (!sku) { message ??= `Size ${s.size} needs a SKU.`; continue }
    if (seen.has(sku)) { bad.add(sku); message ??= `SKU ${sku} is used for two sizes. Each SKU must be unique.` }
    const other = taken.get(sku)
    if (other) { bad.add(sku); message ??= `SKU ${sku} is already used by ${other}. Each SKU must be unique.` }
    seen.add(sku)
  }
  return { bad, message }
}

export function validate(f: Product, mode: Mode, taken: Map<string, string>): Errors {
  const e: Errors = {}
  if (!f.title.trim()) e.title = mode === 'draft' ? 'Add a title so you can find this draft later.' : 'Add a title. Shoppers search by it.'
  else if (f.title.trim().length < 4) e.title = 'Use at least 4 characters, for example “Ajrakh Kurta”.'
  if (f.price !== null && f.price <= 0) e.price = 'Enter an amount above ₹0.'
  if (f.mrp !== null && f.mrp <= 0) e.mrp = 'Enter an amount above ₹0.'
  if (!e.price && f.price !== null && f.mrp !== null && f.price > f.mrp) {
    e.price = `Selling price can’t be more than the MRP (${rupees(f.mrp)}). Lower the price or check the tag.`
  }
  const sku = skuProblems(f.sizes, taken)
  if (sku.message) e.sizes = sku.message
  if (mode === 'submit') {
    const missing = REQUIRED_SLOTS.filter(slot => !hasPhoto(f.images.find(i => i.slot === slot)))
    if (missing.length) {
      const names = missing.map(s => slotName[s])
      e.images = `${missing.length === 1 ? `Add a ${names[0]} photo` : `Add ${joinWords(names)} photos`}. Every product needs front, back and a fabric close-up.`
    }
    if (!f.description.trim()) e.description = 'Add a description: fabric, fit and how to care for it.'
    if (!f.category) e.category = 'Choose a product type.'
    if (!f.fabric) e.fabric = 'Choose the main fabric.'
    if (f.mrp === null) e.mrp = 'Add the MRP printed on the tag.'
    if (f.price === null) e.price = 'Add the price shoppers pay.'
    if (!f.sizes.length) e.sizes = 'Add at least one size with its stock.'
  }
  return e
}

/** Content edits on a live product go to review; price and stock edits apply at once (V-07 note 6). */
function contentChanged(a: Product, b: Product) {
  const pick = (p: Product) => JSON.stringify([p.title, p.description, p.category, p.gender, p.fabric, p.returnable, p.returnDays, p.images.map(i => [i.slot, i.url, i.name])])
  return pick(a) !== pick(b)
}

const fieldId: Record<FieldKey, string> = {
  images: 'pe-photos', title: 'pe-title', description: 'pe-description', category: 'pe-type', fabric: 'pe-fabric', mrp: 'pe-mrp', price: 'pe-price', sizes: 'pe-sizes',
}

function focusFirst(errors: Errors, form: Product) {
  const first = FIELD_ORDER.find(k => errors[k])
  if (!first) return
  window.requestAnimationFrame(() => {
    let el: HTMLElement | null = null
    if (first === 'images') {
      const slot = REQUIRED_SLOTS.find(s => !hasPhoto(form.images.find(i => i.slot === s)))
      el = document.getElementById(`pe-slot-${slot ?? 'front'}`)
    } else if (first === 'sizes') {
      el = document.querySelector<HTMLElement>('[aria-invalid="true"][aria-label^="SKU"]') ?? document.getElementById('pe-sizes')
    } else el = document.getElementById(fieldId[first])
    el?.focus()
    el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  })
}

/* ---------- new products ---------- */

const skuWord = (title: string) => (title.toUpperCase().replace(/[^A-Z ]/g, '').trim().split(/\s+/)[0] ?? '').replace(/[AEIOU]/g, (m, i: number) => (i === 0 ? m : '')).padEnd(3, 'X').slice(0, 3)

function nextSkuNumber(list: Product[]) {
  const max = Math.max(0, ...list.map(p => Number(/-(\d{3})$/.exec(p.sku)?.[1] ?? 0)))
  return String(max + 1).padStart(3, '0')
}

function blankProduct(list: Product[], prefix: string): Product {
  const id = `p_new_${Date.now().toString(36)}`
  return {
    id,
    title: '',
    sku: `${prefix}-NEW-${nextSkuNumber(list)}`,
    category: '',
    gender: 'women',
    fabric: '',
    description: '',
    price: null,
    mrp: null,
    sizes: [],
    images: normaliseImages([], id),
    status: 'draft',
    returnable: true,
    returnDays: 7,
    weightGrams: null,
    updatedAt: new Date().toISOString(),
  }
}

/* ---------- screen ---------- */

export function ProductEditor() {
  const { id } = useParams()
  const mobile = useIsMobile()
  const product = useProduct(id)
  const list = useProducts()
  const { session } = useSession()
  const [blank, setBlank] = useState<Product | null>(null)

  useEffect(() => {
    if (!id && !blank && list.data) setBlank(blankProduct(list.data, session?.vendor.initials ?? 'KS'))
  }, [id, blank, list.data, session])

  if (id && product.isError) {
    const gone = product.error instanceof ApiError && product.error.code === 'not_found'
    return (
      <Content>
        <TopBar crumbs={[{ label: 'Products', to: '/products' }, { label: 'Not found' }]} />
        <Card pad={0}>
          <EmptyState
            icon={gone ? 'search' : 'alert'}
            title={gone ? 'We couldn’t find that product' : 'This product didn’t load'}
            action={gone ? <Button variant="primary" to="/products">Back to products</Button> : <Button variant="secondary" icon="refresh" onClick={() => void product.refetch()}>Try again</Button>}
          >
            {gone ? 'It may have been archived or the link is old. Check the Archived tab in Products.' : 'Check your internet connection, then try again. Nothing you saved is lost.'}
          </EmptyState>
        </Card>
      </Content>
    )
  }
  const initial = id ? product.data : blank
  if (!initial) {
    return (
      <>
        <TopBar crumbs={[{ label: 'Products', to: '/products' }, { label: id ? 'Loading…' : 'New product' }]} />
        <EditorSkeleton mobile={mobile} />
      </>
    )
  }
  return <Editor key={initial.id} initial={initial} isNew={!id} mobile={mobile} all={list.data ?? []} />
}

function Editor({ initial, isNew: startedNew, mobile, all }: { initial: Product; isNew: boolean; mobile: boolean; all: Product[] }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { show } = useToast()
  const { session } = useSession()
  const commission = session?.vendor.commissionPct ?? 15
  const save = useSaveProduct()
  const submit = useSubmitProducts()
  const archive = useArchiveProducts()

  const seed = useMemo(() => ({ ...initial, images: normaliseImages(initial.images, initial.id), sizes: sortSizes(initial.sizes) }), [initial])
  const [form, setForm] = useState<Product>(seed)
  const [baseline, setBaseline] = useState<Product>(seed)
  const [isNew, setIsNew] = useState(startedNew)
  const [attempt, setAttempt] = useState<Mode | null>(null)
  const [serverErrors, setServerErrors] = useState<Errors>({})
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [skuTouched, setSkuTouched] = useState(!startedNew)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const busy = save.isPending || submit.isPending

  // SKUs used by the vendor's other products: SKU must be unique per vendor (V-07 note 4).
  const taken = useMemo(() => new Map(all.filter(p => p.id !== form.id).flatMap(p => p.sizes.map(s => [s.sku.trim().toUpperCase(), p.title] as const))), [all, form.id])
  const errors: Errors = { ...(attempt ? validate(form, attempt, taken) : {}), ...serverErrors }
  const badSkus = attempt || serverErrors.sizes ? skuProblems(form.sizes, taken).bad : new Set<string>()

  const dirty = JSON.stringify(form) !== JSON.stringify(baseline)
  const guard = useRef(dirty)
  guard.current = dirty
  const blocker = useBlocker(({ currentLocation, nextLocation }) => guard.current && currentLocation.pathname !== nextLocation.pathname)
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const flagged = new Set(form.status === 'rejected' ? form.lastDecision?.fields ?? [] : [])
  const highlightMissing = Boolean(errors.images) || flagged.has('images')

  /* ----- edits ----- */
  const patch = (p: Partial<Product>) => {
    setForm(f => ({ ...f, ...p }))
    setServerErrors(({ ...rest }) => { for (const k of Object.keys(p)) delete rest[k as FieldKey]; return rest })
  }
  const skuSuffix = (size: string) => (size === 'One size' ? 'OS' : size.toUpperCase())
  const setTitle = (title: string) => setForm(f => {
    if (skuTouched || !isNew) return { ...f, title }
    // New products: the SKU follows the title until the seller edits one ("generated and editable").
    const num = /-(\d{3})$/.exec(f.sku)?.[1] ?? nextSkuNumber(all)
    const prefix = f.sku.split('-')[0] ?? 'KS'
    const sku = title.trim() ? `${prefix}-${skuWord(title)}-${num}` : f.sku
    return { ...f, title, sku, sizes: f.sizes.map(s => (s.sku === `${f.sku}-${s.size}` ? { ...s, sku: `${sku}-${skuSuffix(s.size)}` } : s)) }
  })
  const addSize = (size: string) => setForm(f => ({ ...f, sizes: sortSizes([...f.sizes, { size, sku: `${f.sku}-${skuSuffix(size)}`, stock: 0 }]) }))
  const changeSize = (i: number, p: Partial<SizeStock>) => {
    if (p.sku !== undefined) setSkuTouched(true)
    setServerErrors(e => { const rest = { ...e }; delete rest.sizes; return rest })
    setForm(f => ({ ...f, sizes: f.sizes.map((s, j) => (j === i ? { ...s, ...p } : s)) }))
  }
  const removeSize = (i: number) => setForm(f => ({ ...f, sizes: f.sizes.filter((_, j) => j !== i) }))

  /* ----- photos ----- */
  const filledCount = form.images.filter(hasPhoto).length
  const placePhotos = async (files: File[], target: number | 'add' | 'auto') => {
    setPhotoError(null)
    const problems: string[] = []
    const ok: Array<{ url: string; name: string }> = []
    for (const file of files) {
      const r = await readPhoto(file)
      if ('error' in r) problems.push(r.error)
      else ok.push(r)
    }
    setForm(f => {
      const images = [...f.images]
      let room = MAX_PHOTOS - images.filter(hasPhoto).length
      for (const [n, photo] of ok.entries()) {
        const at = typeof target === 'number' && n === 0 ? target : target === 'auto' ? images.findIndex(i => i.slot !== 'extra' && !hasPhoto(i)) : -1
        const slot = at >= 0 ? images[at] : undefined
        if (slot) {
          if (!hasPhoto(slot)) room -= 1
          images[at] = { ...slot, url: photo.url, name: photo.name }
        } else if (room > 0) {
          images.push({ id: `${f.id}-x${Date.now()}${n}`, slot: 'extra', url: photo.url, name: photo.name })
          room -= 1
        } else problems.push(`${photo.name} wasn’t added: a product can have up to ${MAX_PHOTOS} photos.`)
      }
      return { ...f, images }
    })
    if (problems.length) setPhotoError(problems.join(' '))
  }
  const picker = usePhotoPicker((files, target) => void placePhotos(files, target))
  const removePhoto = (i: number) => setForm(f => ({
    ...f,
    images: f.images[i]?.slot === 'extra' ? f.images.filter((_, j) => j !== i) : f.images.map((img, j) => (j === i ? { id: img.id, slot: img.slot } : img)),
  }))
  const swapPhotos = (a: number, b: number) => setForm(f => {
    const images = [...f.images]
    const A = images[a]
    const B = images[b]
    if (!A || !B) return f
    images[a] = { ...A, url: B.url, name: B.name }
    images[b] = { ...B, url: A.url, name: A.name }
    return { ...f, images }
  })

  /* ----- actions ----- */
  const check = (mode: Mode) => {
    setAttempt(mode)
    const e = validate(form, mode, taken)
    if (Object.keys(e).length) {
      focusFirst(e, form)
      const n = Object.keys(e).length
      show(n === 1 ? 'One thing to fix before this can be saved.' : `${n} things to fix before this can be saved.`, 'warning')
      return false
    }
    return true
  }
  const persist = async (next: Product) => {
    try {
      const saved = await save.mutateAsync(next)
      const clean = { ...saved, images: normaliseImages(saved.images, saved.id), sizes: sortSizes(saved.sizes) }
      qc.setQueryData(keys.product(saved.id), saved)
      guard.current = false
      setForm(clean)
      setBaseline(clean)
      setServerErrors({})
      return clean
    } catch (err) {
      if (err instanceof ApiError && err.field === 'sizes') {
        setServerErrors({ sizes: err.message })
        focusFirst({ sizes: err.message }, form)
      }
      show(err instanceof Error ? err.message : 'Couldn’t save. Check your connection and try again.', 'error')
      return null
    }
  }
  const leaveTo = (path: string) => { guard.current = false; navigate(path) }

  const onSaveDraft = async () => {
    if (!check('draft')) return
    const saved = await persist(form)
    if (!saved) return
    setAttempt(null)
    show(isNew ? 'Draft saved. Finish it any time from the Drafts tab.' : 'Draft saved.')
    if (isNew) { setIsNew(false); guard.current = false; navigate(`/products/${saved.id}`, { replace: true }) }
  }
  const onSubmit = async () => {
    if (!check('submit')) return
    const saved = await persist(form)
    if (!saved) return
    try {
      await submit.mutateAsync([saved.id])
      show(form.status === 'rejected' ? 'Resubmitted. The review team usually replies within 1–2 working days.' : 'Sent for review. The review team usually replies within 1–2 working days.')
      leaveTo('/review')
    } catch (err) {
      show(err instanceof Error ? err.message : 'Saved, but it wasn’t submitted. Try again.', 'error')
    }
  }
  const onSaveLive = async () => {
    if (!check('submit')) return
    const content = contentChanged(form, baseline)
    const saved = await persist(form)
    if (!saved) return
    setAttempt(null)
    if (form.status === 'approved' && content) {
      try {
        await submit.mutateAsync([saved.id])
        setForm(f => ({ ...f, pendingEdit: true }))
        setBaseline(b => ({ ...b, pendingEdit: true }))
        show('Edit sent for review. The live version stays in the app until it is approved.')
      } catch (err) {
        show(err instanceof Error ? err.message : 'Saved, but the edit wasn’t sent for review. Try again.', 'error')
      }
    } else if (form.status === 'approved') show('Price and stock updated. They’re live in the app now.')
    else show('Changes saved. The product keeps its place in the review queue.')
  }
  const onArchive = async () => {
    try {
      await archive.mutateAsync([form.id])
      show(`${form.title || 'Product'} is archived. Find it in the Archived tab.`)
      setArchiveOpen(false)
      leaveTo('/products?tab=archived')
    } catch (err) {
      show(err instanceof Error ? err.message : 'Couldn’t archive. Try again.', 'error')
    }
  }

  /* ----- labels ----- */
  const live = form.status === 'approved'
  const inReview = form.status === 'pending_review'
  const primary = live || inReview
    ? { label: busy ? 'Saving…' : 'Save changes', icon: 'check' as const, run: onSaveLive }
    : { label: busy ? 'Sending…' : form.status === 'rejected' ? 'Resubmit for review' : 'Submit for review', icon: 'send' as const, run: onSubmit }
  const secondary = live
    ? { label: 'Discard changes', run: () => { setForm(baseline); setAttempt(null); setServerErrors({}) }, disabled: !dirty }
    : inReview ? null : { label: busy && !submit.isPending ? 'Saving…' : 'Save draft', run: onSaveDraft, disabled: false }
  const title = form.title.trim() || (isNew ? 'New product' : 'Untitled product')
  const savedLine = isNew ? 'New product · not saved yet' : `${form.sku} · ${dirty ? 'unsaved changes' : `last saved ${savedAgo(baseline.updatedAt)}`}`
  const savedShort = isNew ? 'Not saved yet' : `${form.sku} · ${dirty ? 'unsaved changes' : `saved ${savedAgo(baseline.updatedAt, true)}`}`

  const banner = (() => {
    if (form.status === 'rejected' && form.lastDecision?.reason) {
      return <Banner icon="info" title={form.lastDecision.reason}>Shazlo review team · {relativeTime(form.lastDecision.decidedAt)}</Banner>
    }
    if (inReview) return <Banner icon="clock" title="In review">Submitted {relativeTime(form.submittedAt ?? form.updatedAt).toLowerCase()}. The Shazlo review team usually decides within 1–2 working days. You can still fix details; saving keeps its place in the queue.</Banner>
    if (live && form.pendingEdit) return <Banner icon="clock" title="Your edit is in review">The live version stays in the app until the edit is approved. Price and stock changes still go live straight away.</Banner>
    if (form.status === 'archived') return <Banner icon="layers" title="Archived">This product isn’t shown in the app. Submit it for review to bring it back.</Banner>
    return null
  })()

  /* ----- cards ----- */
  const photos = (
    <Card pad={mobile ? 14 : 20} gap={mobile ? 12 : 16} id="pe-photos" tabIndex={-1} style={{ outline: 'none' }} aria-labelledby="pe-photos-title">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Text v="title" as="h2" id="pe-photos-title">Photos</Text>
        <Text v="caption" tone="subtle">3 required · up to {MAX_PHOTOS}</Text>
      </div>
      <div className="shz-tabs" style={{ display: 'flex', gap: mobile ? 10 : 12, flexWrap: mobile ? 'nowrap' : 'wrap', overflowX: mobile ? 'auto' : 'visible', margin: mobile ? '0 -14px' : 0, padding: mobile ? '0 14px' : 0, scrollbarWidth: 'none' }}>
        {form.images.map((img, i) => (
          <PhotoSlot
            key={img.id}
            img={img}
            index={i}
            mobile={mobile}
            highlight={img.slot !== 'extra' && !hasPhoto(img) && highlightMissing}
            onPick={idx => picker.open(idx)}
            onRemove={removePhoto}
            onSwap={swapPhotos}
          />
        ))}
        {!mobile && <AddPhotoSlot onClick={() => picker.open('add')} disabledReason={filledCount >= MAX_PHOTOS ? `A product can have up to ${MAX_PHOTOS} photos. Remove one to add another.` : undefined} />}
      </div>
      {mobile && (
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="sm" variant="secondary" icon="image" onClick={() => picker.open('auto', true)} style={{ minHeight: 44, flex: '1 1 0', minWidth: 0 }}>Take photo</Button>
          <Button size="sm" variant="secondary" icon="upload" onClick={() => picker.open('auto')} style={{ minHeight: 44, flex: '1 1 0', minWidth: 0 }}>From gallery</Button>
        </div>
      )}
      {(errors.images || photoError) && (
        <div id="pe-photos-error" role="alert" style={{ display: 'flex', alignItems: 'flex-start', gap: 4, color: kit.error }}>
          <Icon name="alert" size={12} strokeWidth={1.75} style={{ marginTop: 2 }} />
          <Text v="caption" tone="error">{[errors.images, photoError].filter(Boolean).join(' ')}</Text>
        </div>
      )}
      {!mobile && <Text v="caption" tone="subtle" as="p">JPG, PNG or WebP · max 10 MB · at least 1200 px on the long side. Drag to reorder; the first photo is the cover in the feed.</Text>}
      {picker.inputs}
    </Card>
  )

  const typeOptions = [
    ...(form.category ? [] : [{ value: '', label: 'Choose a type' }]),
    ...productTypes,
    ...(form.category && !productTypes.some(t => t.value === form.category) ? [{ value: form.category, label: form.category }] : []),
  ]
  const fabricOptions = [...(form.fabric ? [] : [{ value: '', label: 'Choose a fabric' }]), ...fabrics, ...(form.fabric && !fabrics.includes(form.fabric) ? [form.fabric] : [])]
  const typeSelect = <Select id="pe-type" label="Product type" options={typeOptions} value={form.category} onChange={e => patch({ category: e.target.value })} error={errors.category} style={{ flex: '1 1 0', minWidth: 0 }} />
  const genderSelect = <Select id="pe-gender" label="Gender" options={genders} value={form.gender} onChange={e => patch({ gender: e.target.value as Product['gender'] })} style={{ flex: '1 1 0', minWidth: 0 }} />
  const fabricSelect = <Select id="pe-fabric" label="Fabric" options={fabricOptions} value={form.fabric} onChange={e => patch({ fabric: e.target.value })} error={errors.fabric} style={{ flex: '1 1 0', minWidth: 0 }} />

  const details = (
    <Card pad={mobile ? 14 : 20} gap={mobile ? 14 : 16}>
      <Text v="title" as="h2">Details</Text>
      <TextInput id="pe-title" label="Title" value={form.title} onChange={e => { setTitle(e.target.value); setServerErrors({}) }} error={errors.title} maxLength={120} autoComplete="off" />
      <TextArea id="pe-description" label="Description" value={form.description} onChange={e => patch({ description: e.target.value })} error={errors.description} rows={2} maxLength={2000} style={{ minWidth: 0 }} />
      {mobile ? (
        <>
          {typeSelect}
          <div style={{ display: 'flex', gap: 10 }}>{genderSelect}{fabricSelect}</div>
        </>
      ) : (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>{typeSelect}{genderSelect}{fabricSelect}</div>
      )}
    </Card>
  )

  const mrp = <MoneyInput id="pe-mrp" label="MRP" value={form.mrp} onChange={v => patch({ mrp: v })} error={errors.mrp} />
  const price = <MoneyInput id="pe-price" label="Selling price" value={form.price} onChange={v => patch({ price: v })} error={errors.price} />
  const pricing = (
    <Card pad={mobile ? 14 : 20} gap={mobile ? 14 : 16}>
      <Text v="title" as="h2">Price</Text>
      {mobile ? (
        <>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>{mrp}{price}</div>
          <NetEarnings price={form.price} commissionPct={commission} mobile />
        </>
      ) : (
        <div style={{ display: 'flex', gap: 16, alignItems: errors.mrp || errors.price ? 'flex-start' : 'flex-end', flexWrap: 'wrap' }}>
          {mrp}{price}<NetEarnings price={form.price} commissionPct={commission} mobile={false} />
        </div>
      )}
    </Card>
  )

  const sizesError = errors.sizes && (
    <div role="alert" style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
      <Icon name="alert" size={12} color={kit.error} strokeWidth={1.75} style={{ marginTop: 2 }} />
      <Text v="caption" tone="error">{errors.sizes}</Text>
    </div>
  )
  const sizes = mobile ? (
    <Card pad="13px 13px 5px" gap={0}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 8 }}>
        <Text v="title" as="h2">Sizes and stock</Text>
        <AddSizeButton id="pe-sizes" used={form.sizes.map(s => s.size)} onAdd={addSize} />
      </div>
      {form.sizes.length === 0 && (
        <>
          <span aria-hidden style={{ height: 1, background: kit.line }} />
          <Text v="small" tone="muted" as="p" style={{ padding: '12px 0' }}>No sizes yet. Add each size you sell and how many you have.</Text>
        </>
      )}
      {form.sizes.map((s, i) => <SizeStepperRow key={s.size} size={s.size} stock={s.stock} onChange={v => changeSize(i, { stock: v })} />)}
      {sizesError && <div style={{ padding: '8px 0' }}>{sizesError}</div>}
    </Card>
  ) : (
    <Card gap={12}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text v="title" as="h2">Sizes and stock</Text>
        <AddSizeButton id="pe-sizes" used={form.sizes.map(s => s.size)} onAdd={addSize} />
      </div>
      {form.sizes.length ? (
        <SizesTable sizes={form.sizes} badSkus={badSkus} onChange={changeSize} onRemove={removeSize} />
      ) : (
        <div style={{ border: `1px dashed ${errors.sizes ? kit.error : kit.field}`, borderRadius: 8, padding: '20px 16px', textAlign: 'center' }}>
          <Text v="small" tone="muted">No sizes yet. Add each size you sell; we suggest a SKU you can change.</Text>
        </div>
      )}
      {sizesError}
    </Card>
  )

  const leaveDialog = (
    <Dialog
      open={blocker.state === 'blocked'}
      onClose={() => blocker.reset?.()}
      icon="alert"
      title="Leave without saving?"
      description="Your changes to this product haven’t been saved. If you leave now, they’re lost."
      actions={
        <>
          <Button variant="secondary" onClick={() => blocker.reset?.()}>Keep editing</Button>
          <Button variant="danger" onClick={() => blocker.proceed?.()}>Leave without saving</Button>
        </>
      }
    />
  )
  const archiveDialog = <ArchiveDialog open={archiveOpen} products={[form]} busy={archive.isPending} onClose={() => setArchiveOpen(false)} onConfirm={() => void onArchive()} />

  if (mobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', background: kit.canvas, minHeight: 'calc(100dvh - 56px)' }}>
        <TopBar crumbs={[{ label: 'Products', to: '/products' }, { label: title }]} />
        <MobilePageBar
          hideTabBar
          title={title}
          caption={savedShort}
          leading={<BarIcon label="Back to products" icon="arrowLeft" onClick={() => navigate('/products')} />}
          trailing={!isNew && form.status !== 'archived' ? <span style={{ marginRight: 4 }}><RowMenu label="More actions" size={22} actions={[{ label: 'Archive product', icon: 'layers', danger: true, onClick: () => setArchiveOpen(true) }]} /></span> : undefined}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '16px 16px calc(24px + 65px)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><ProductStatus product={form} editLabel="Edit in review" /></div>
          {banner}
          {photos}
          {details}
          {pricing}
          {sizes}
        </div>
        <MobileActionBar>
          {secondary && <Button variant="ghost" onClick={() => void secondary.run()} disabled={busy || secondary.disabled} style={{ minHeight: 44 }}>{secondary.label}</Button>}
          <Button variant="primary" icon={primary.icon} fullWidth onClick={() => void primary.run()} disabled={busy} style={{ minHeight: 44, flex: 1 }}>{primary.label}</Button>
        </MobileActionBar>
        {leaveDialog}
        {archiveDialog}
      </div>
    )
  }

  return (
    <Content style={{ gap: 20 }}>
      <TopBar crumbs={[{ label: 'Products', to: '/products' }, { label: title }]} />
      <PageHeader
        title={title}
        badge={<ProductStatus product={form} />}
        subtitle={savedLine}
        actions={
          <>
            {secondary && <Button variant="ghost" onClick={() => void secondary.run()} disabled={busy || secondary.disabled} title={live && !dirty ? 'Nothing to discard yet.' : undefined}>{secondary.label}</Button>}
            <Button variant="primary" icon={primary.icon} onClick={() => void primary.run()} disabled={busy}>{primary.label}</Button>
          </>
        }
      />
      {banner}
      <div className="shz-editor-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 24, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
          {photos}
          {details}
          {pricing}
          {sizes}
        </div>
        <aside aria-label="Review and returns" style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
          <HistoryCard productId={form.id} isNew={isNew} />
          <ReturnsCard returnable={form.returnable} returnDays={form.returnDays} onChange={v => patch(v)} />
          <ReviewRulesCard />
        </aside>
      </div>
      <style>{'@media (max-width: 1180px) { .shz-editor-grid { grid-template-columns: minmax(0, 1fr) !important; } }'}</style>
      {leaveDialog}
      {archiveDialog}
    </Content>
  )
}

/** Save and resubmit stay fixed at the bottom on phones (V-07m: p 12/16/20/16, the tab bar is hidden). */
function MobileActionBar({ children }: { children: ReactNode }) {
  return (
    <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 19, background: kit.surface, borderTop: `1px solid ${kit.line}`, display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px calc(20px + env(safe-area-inset-bottom))' }}>
      {children}
    </div>
  )
}

