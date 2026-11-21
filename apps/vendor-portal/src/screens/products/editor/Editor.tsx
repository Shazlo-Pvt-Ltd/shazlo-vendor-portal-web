import { Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, IconButton, ListItemIcon, Menu, MenuItem, Stack, Typography } from '@mui/material'
import { Banner, neutral, PageHeader, radius } from '@shazlo/ui'
import { Archive, MoreHorizontal } from 'lucide-react'
import { Fragment, useCallback, useEffect, useEffectEvent, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Link as RouterLink, useNavigate } from 'react-router'
import { ApiError } from '../../../api/errors'
import type { Schemas } from '../../../api/model'
import { useArchiveProduct, useCreateProduct, useMe, useSubmitProduct, useUpdateProduct } from '../../../api/queries'
import { paths } from '../../../app/paths'
import { productEditorCopy } from '../../../copy/productEditor'
import { productsCopy } from '../../../copy/products'
import { SaveStatus, useAutosave } from '../../../lib/autosave'
import { missingNamedPhotos, NAMED_PHOTO_ANGLES, productProblems, SUBMIT_REQUIREMENTS, TRYON_REQUIRED, tryonCount, type SubmitRequirement } from '../../../lib/catalog'
import { formatCount, formatINR, formatRelative } from '../../../lib/format'
import { FORM_MAX_WIDTH, useNavMode } from '../../../shell/layout'
import { StickyFooter } from '../../../shell/StickyFooter'
import { useFullScreenTask } from '../../../shell/task'
import { ProductStatus, statusWords } from '../status'
import { AboutSection, NameField } from './AboutSection'
import { columnsSx } from './EditorSkeleton'
import { baseOf, editorResolver, forSubmit, parseRupees, stockOf, toInput, toValues, type EditorValues } from './form'
import { fieldId, firstEmptyTryonId, slotId, STEP_OF, STEPS, type Problems } from './layout'
import { PhotosSection } from './PhotosSection'
import { PriceSection } from './PriceSection'
import { CheckPage, ProblemSummary, type SummaryRow } from './Problems'
import { HistoryCard, LiveNote, ReturnsNote } from './SideCards'
import { SizesSection } from './SizesSection'
import { usePhotoUploads } from './usePhotoUploads'

type Product = Schemas['Product']

const copy = productEditorCopy
const NO_IMAGES: Product['images'] = []
const CHECK = STEPS.length
const stepName = (step: number) => (step < CHECK ? copy.steps.names[STEPS[step]!] : copy.check.title)

// The editor for one product (V-07). `product` is null on /products/new until the first save
// creates it; the same instance then carries on (the parent keeps its key) so focus and typing are
// not lost. Phones get the four parts one per screen, then a check page (spec §7); wider screens
// keep the Build 2 single page, in two columns from 1024 px.
export function Editor({ product, onCreated, onStale }: { product: Product | null; onCreated?: (id: string) => void; onStale?: () => void }) {
  const navigate = useNavigate()
  const idPrefix = useId()
  const menuId = useId()
  const dialogTitleId = useId()
  const dialogBodyId = useId()
  const mode = useNavMode()
  const phone = mode === 'phone'
  const me = useMe().data
  const commission = me?.vendor.commission ?? null
  const storeDetailsComplete = me?.setup.store_details ?? true

  const [created, setCreated] = useState<Product | null>(null)
  const current = product ?? created
  const id = current?.id ?? ''
  const status = current?.status ?? 'draft'
  const live = status === 'approved'
  // A new product on a phone also asks for its name on the Photos step: photos need a saved draft.
  const [startedNew] = useState(product === null)

  const [defaultValues] = useState(() => toValues(product))
  const [resolver] = useState(() => editorResolver(product?.status === 'approved'))
  const form = useForm<EditorValues>({ defaultValues, resolver, mode: 'onSubmit' })
  const { control, getValues, trigger } = form
  const values = useWatch({ control }) as EditorValues

  const [locked, setLocked] = useState(false)
  const [outcome, setOutcome] = useState<'sent' | 'changesSent' | null>(null)
  // What the last refused send listed; each one shows until it is fixed.
  const [asked, setAsked] = useState<{ keys: SubmitRequirement[]; fields: Record<string, string> } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)
  const [creating, setCreating] = useState<{ busy: boolean; failedFor: string | null }>({ busy: false, failedFor: null })
  const [step, setStep] = useState(0)
  const summaryRef = useRef<HTMLDivElement>(null)
  const pendingFocus = useRef<string | null>(null)

  const inReview = status === 'pending_review' || Boolean(current?.edit_in_review)
  const readOnly = locked || inReview || status === 'archived'
  const images = current?.images ?? NO_IMAGES
  const uploads = usePhotoUploads(current?.id ?? null)

  // ---- autosave ------------------------------------------------------------------------------
  const update = useUpdateProduct(id)
  const lastSaveError = useRef<unknown>(null)
  const autosave = useAutosave<Schemas['ProductInput']>({
    values: toInput(values, baseOf(current)),
    enabled: Boolean(current) && !readOnly,
    savedAt: product?.updated_at ?? null,
    save: async (input) => {
      try {
        await update.mutateAsync(input)
        lastSaveError.current = null
      } catch (error) {
        lastSaveError.current = error
        if (error instanceof ApiError && error.status === 409) {
          setLocked(true)
          onStale?.()
        }
        throw error
      }
    },
  })
  const { flush } = autosave

  // Leaving within the second after an edit still saves it.
  const flushOnLeave = useEffectEvent(() => {
    if (current && !readOnly) void flush()
  })
  useEffect(() => () => flushOnLeave(), [])

  // ---- new product: created once the seller types a name -------------------------------------
  const create = useCreateProduct()
  const createDraft = useEffectEvent(async () => {
    const snapshot = getValues()
    setCreating({ busy: true, failedFor: null })
    try {
      const made = await create.mutateAsync(toInput(snapshot, baseOf(null)))
      setCreated(made)
      autosave.reset(toInput(snapshot, baseOf(made)), made.updated_at)
      onCreated?.(made.id)
      void navigate(paths.product(made.id), { replace: true })
    } catch {
      setCreating({ busy: false, failedFor: snapshot.title })
    }
  })
  const title = values.title
  useEffect(() => {
    if (current || creating.busy || !title.trim() || title === creating.failedFor) return
    const timer = setTimeout(() => void createDraft(), 1000)
    return () => clearTimeout(timer)
  }, [current, creating, title])

  // ---- what is missing -------------------------------------------------------------------------
  const missingNow = useMemo(() => productProblems(forSubmit(values, images), { storeDetailsComplete }), [values, images, storeDetailsComplete])
  const shownNow: Problems = {}
  for (const key of asked?.keys ?? []) {
    // Store details are fixed on their own page, so the server's word stands until the next send.
    const message = key === 'store_details' ? (missingNow.store_details ?? asked?.fields.store_details) : missingNow[key]
    if (message) shownNow[key] = message
  }
  // The same object while nothing changes, so the memoised sections skip re-rendering as the
  // seller types.
  const shownKey = JSON.stringify(shownNow)
  const shown = useMemo(() => JSON.parse(shownKey) as Problems, [shownKey])

  // Where a problem link takes the seller: the field, the first empty photo slot or try-on slot.
  function targetOf(key: SubmitRequirement): string {
    if (key === 'photos') return slotId(idPrefix, missingNamedPhotos(images)[0] ?? 'front')
    if (key === 'tryon') return firstEmptyTryonId(idPrefix)
    return fieldId(idPrefix, key)
  }

  function goTo(key: SubmitRequirement) {
    const target = targetOf(key)
    const where = STEP_OF[key]
    if (phone && where && STEPS.indexOf(where) !== step) {
      pendingFocus.current = target
      setStep(STEPS.indexOf(where))
      return
    }
    document.getElementById(target)?.focus()
  }

  // ---- phone steps -----------------------------------------------------------------------------
  const toStep = (next: number) => {
    pendingFocus.current = null
    setStep(next)
    window.scrollTo(0, 0)
  }
  useEffect(() => {
    if (!pendingFocus.current) return
    document.getElementById(pendingFocus.current)?.focus()
    pendingFocus.current = null
  }, [step])
  // The top bar's Back goes one step back; from the first step it leaves for Products.
  useFullScreenTask({ back: { label: stepName(step - 1), onClick: () => toStep(step - 1) }, enabled: phone && step > 0 })

  // Price and MRP formats are checked on Next and Send (spec §8), never while typing.
  async function pricesOk(): Promise<boolean> {
    if (readOnly || (await trigger(['price', 'mrp']))) return true
    const target = fieldId(idPrefix, form.getFieldState('price').error ? 'price_paise' : 'mrp')
    if (phone && STEPS[step] !== 'price') {
      pendingFocus.current = target
      setStep(STEPS.indexOf('price'))
    } else document.getElementById(target)?.focus()
    return false
  }

  async function onNext() {
    if (STEPS[step] === 'price' && !(await pricesOk())) return
    toStep(step + 1)
  }

  // ---- send for review -------------------------------------------------------------------------
  const submit = useSubmitProduct(id)

  async function onSubmit() {
    setActionError(null)
    if (!(await pricesOk())) return
    lastSaveError.current = null
    await flush()
    const saveError = lastSaveError.current
    if (saveError) {
      if (!(saveError instanceof ApiError && saveError.status === 409)) setActionError(copy.banners.unsaved)
      return
    }
    try {
      const result = await submit.mutateAsync()
      setOutcome(result.status === 'approved' ? 'changesSent' : 'sent')
      setAsked(null)
    } catch (error) {
      if (error instanceof ApiError && error.status === 422 && Object.keys(error.fields).length) {
        setAsked({ keys: SUBMIT_REQUIREMENTS.filter((k) => k in error.fields), fields: error.fields })
        if (!phone) setTimeout(() => summaryRef.current?.focus(), 0)
      } else {
        setActionError(error instanceof Error ? error.message : copy.banners.unsaved)
        if (error instanceof ApiError && error.status === 409) onStale?.()
      }
    }
  }

  // ---- archive ---------------------------------------------------------------------------------
  const archive = useArchiveProduct(id)
  async function onArchive() {
    setArchiveError(null)
    try {
      if (!readOnly) await flush()
      await archive.mutateAsync()
      setConfirmOpen(false)
      void navigate(paths.products, { state: { notice: copy.archive.done } })
    } catch (error) {
      setArchiveError(error instanceof Error ? error.message : copy.banners.unsaved)
    }
  }

  // ---- header ----------------------------------------------------------------------------------
  const mainLabel = status === 'rejected' ? copy.submit.rejected : live ? copy.submit.approved : copy.submit.draft
  let saveNote: ReactNode = null
  if (!current) {
    saveNote = creating.busy ? <SaveStatus component="span" state="saving" savedAt={null} /> : creating.failedFor !== null ? <Box component="span" sx={{ color: 'error.main' }}>{copy.save.createFailed}</Box> : null
  } else if (!locked) {
    saveNote = <SaveStatus component="span" state={autosave.state} savedAt={autosave.savedAt} />
  }
  const joined = (...parts: ReactNode[]) => {
    const kept = parts.filter(Boolean)
    return kept.length
      ? kept.map((part, i) => (
          <Fragment key={i}>
            {i > 0 && ' · '}
            {part}
          </Fragment>
        ))
      : null
  }

  const showMore = Boolean(current) && status !== 'archived'
  const showMain = Boolean(current) && !readOnly
  const moreButton = showMore ? (
    <IconButton
      aria-label={copy.moreActions}
      aria-haspopup="menu"
      aria-controls={menuAnchor ? menuId : undefined}
      aria-expanded={menuAnchor ? 'true' : undefined}
      onClick={(event) => setMenuAnchor(event.currentTarget)}
      sx={{ width: 44, height: 44, border: `1px solid ${neutral.lineStrong}`, borderRadius: `${radius.control}px`, color: neutral.ink }}
    >
      <MoreHorizontal size={18} strokeWidth={1.5} aria-hidden="true" />
    </IconButton>
  ) : null

  // ---- banners ---------------------------------------------------------------------------------
  const statusBanners: ReactNode[] = []
  if (outcome) {
    statusBanners.push(<Banner key="outcome" tone="success" title={outcome === 'sent' ? copy.banners.sent : copy.banners.changesSent} />)
  } else if (locked) {
    statusBanners.push(<Banner key="locked" tone="info" title={copy.banners.locked} />)
  } else if (status === 'pending_review') {
    statusBanners.push(<Banner key="pending" tone="info" title={copy.banners.pending} />)
  } else if (current?.edit_in_review) {
    statusBanners.push(<Banner key="edit" tone="info" title={copy.banners.editInReview} />)
  } else if (status === 'archived') {
    statusBanners.push(<Banner key="archived" tone="info" title={copy.banners.archived} />)
  } else if (status === 'rejected' && current?.review.reason) {
    statusBanners.push(
      <Banner key="sent-back" tone="warning" title={`“${current.review.reason}”`}>
        {copy.banners.reviewedBy(current.review.at ? formatRelative(current.review.at) : '')}
      </Banner>,
    )
  }
  const errorBanner = actionError ? (
    <Banner key="action-error" tone="error" title={actionError} action={!readOnly && <Button onClick={() => void onSubmit()}>{copy.banners.retry}</Button>} onClose={() => setActionError(null)} />
  ) : null
  const hasShown = Object.keys(shown).length > 0
  const summary = hasShown ? <ProblemSummary key="problems" ref={summaryRef} problems={shown} onGo={goTo} /> : null

  // ---- the four parts --------------------------------------------------------------------------
  const focusName = useCallback(() => document.getElementById(fieldId(idPrefix, 'title'))?.focus(), [idPrefix])
  const sections = (plain: boolean): Record<(typeof STEPS)[number], ReactNode> => ({
    photos: (
      <PhotosSection
        productId={current?.id ?? null}
        images={images}
        uploads={uploads}
        readOnly={readOnly}
        problems={shown}
        flagMissing={status === 'rejected'}
        idPrefix={idPrefix}
        showCamera={mode !== 'desktop'}
        onAddName={focusName}
        plain={plain}
        lead={
          plain && startedNew ? (
            <Box sx={{ mb: 3 }}>
              <NameField form={form} readOnly={readOnly} problem={shown.title} idPrefix={idPrefix} />
            </Box>
          ) : undefined
        }
      />
    ),
    about: <AboutSection form={form} readOnly={readOnly} problems={shown} idPrefix={idPrefix} plain={plain} />,
    sizes: <SizesSection control={control} sku={current?.sku ?? null} readOnly={readOnly} problems={shown} idPrefix={idPrefix} plain={plain} />,
    price: <PriceSection form={form} readOnly={readOnly} live={live} commission={commission} problems={shown} idPrefix={idPrefix} plain={plain} />,
  })

  const menus = (
    <>
      <Menu id={menuId} anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        <MenuItem
          onClick={() => {
            setMenuAnchor(null)
            setArchiveError(null)
            setConfirmOpen(true)
          }}
        >
          <ListItemIcon>
            <Archive size={16} strokeWidth={1.5} aria-hidden="true" />
          </ListItemIcon>
          {copy.archive.menu}
        </MenuItem>
      </Menu>

      <Dialog open={confirmOpen} onClose={() => !archive.isPending && setConfirmOpen(false)} aria-labelledby={dialogTitleId} aria-describedby={dialogBodyId} slotProps={{ paper: { sx: { borderRadius: `${radius.sheet}px`, maxWidth: 440 } } }}>
        <DialogTitle id={dialogTitleId} sx={{ typography: 'h2', pt: 3 }}>
          {copy.archive.title}
        </DialogTitle>
        <DialogContent>
          <DialogContentText id={dialogBodyId} sx={{ color: 'text.primary' }}>
            {copy.archive.body}
          </DialogContentText>
          {archiveError && (
            <Typography role="alert" variant="body2" color="error.main" sx={{ mt: 1.5 }}>
              {archiveError}
            </Typography>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
          <Button variant="outlined" onClick={() => setConfirmOpen(false)} disabled={archive.isPending}>
            {copy.archive.cancel}
          </Button>
          <Button variant="contained" color="error" onClick={() => void onArchive()} disabled={archive.isPending}>
            {copy.archive.confirm}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )

  const productName = current ? current.title || copy.untitled : copy.newTitle

  // ---- phones: one part per screen, then the check page ----------------------------------------
  if (phone) {
    const onCheck = step === CHECK
    const footerMain = onCheck ? (
      showMain && !outcome ? (
        <Button variant="contained" onClick={() => void onSubmit()} disabled={submit.isPending}>
          {submit.isPending ? copy.submit.sending : mainLabel}
        </Button>
      ) : outcome ? (
        <Button variant="outlined" component={RouterLink} to={paths.products}>
          {productsCopy.title}
        </Button>
      ) : null
    ) : (
      <Button variant="contained" onClick={() => void onNext()}>
        {step === CHECK - 1 ? copy.steps.toCheck : copy.steps.next}
      </Button>
    )

    const rows: SummaryRow[] = STEPS.map((key, i) => {
      let value: string
      if (key === 'photos') {
        const added = NAMED_PHOTO_ANGLES.filter((a) => images.some((img) => img.angle === a)).length + Math.min(tryonCount(images), TRYON_REQUIRED)
        value = copy.check.photos(added, NAMED_PHOTO_ANGLES.length + TRYON_REQUIRED)
      } else if (key === 'about') {
        value = [values.title.trim(), values.gender, values.category, values.mainColour].filter(Boolean).join(' · ') || copy.check.notAdded
      } else if (key === 'sizes') {
        const total = values.sizes.reduce((n, r) => n + stockOf(r.stock), 0)
        value = values.sizes.length ? copy.check.sizes(values.sizes.length, formatCount(total)) : copy.check.notAdded
      } else {
        const price = parseRupees(values.price)
        value = price.ok && price.paise ? formatINR(price.paise) : copy.check.notAdded
      }
      return { step: copy.steps.names[key], value, onChange: () => toStep(i) }
    })

    return (
      <>
        <PageHeader
          eyebrow={
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', minHeight: 44, mb: 0.5 }}>
              <Typography variant="body2" color="text.secondary">
                {onCheck ? '' : copy.steps.of(step + 1, STEPS.length)}
              </Typography>
              {moreButton}
            </Stack>
          }
          title={stepName(step)}
          subtitle={joined(productName, current ? statusWords(current) : null, saveNote)}
        />
        <Stack spacing={1.5} sx={{ mb: errorBanner || (step === 0 && statusBanners.length) ? 3 : 0 }}>
          {errorBanner}
          {step === 0 && statusBanners}
        </Stack>
        {onCheck ? <CheckPage problems={missingNow} onGo={goTo} rows={rows} readOnly={readOnly} banners={statusBanners.length ? <Stack spacing={1.5}>{statusBanners}</Stack> : undefined} /> : sections(true)[STEPS[step]!]}
        {!onCheck && STEPS[step] === 'price' && (
          <Box sx={{ mt: 3 }}>
            <ReturnsNote plain />
          </Box>
        )}
        <StickyFooter>
          {step > 0 && (
            <Button variant="outlined" onClick={() => toStep(step - 1)}>
              {copy.steps.back}
            </Button>
          )}
          {footerMain}
        </StickyFooter>
        {menus}
      </>
    )
  }

  // ---- 600 px and up: the single-page editor ---------------------------------------------------
  const desktop = mode === 'desktop'
  const actions =
    showMore || showMain ? (
      <>
        {moreButton}
        {showMain && (
          <Button variant="contained" size="large" onClick={() => void onSubmit()} disabled={submit.isPending} sx={{ minHeight: 44 }}>
            {submit.isPending ? copy.submit.sending : mainLabel}
          </Button>
        )}
      </>
    ) : undefined
  const page = sections(false)
  const banners = [summary, errorBanner, ...statusBanners].filter(Boolean)

  return (
    <Box sx={desktop ? undefined : { maxWidth: FORM_MAX_WIDTH, mx: 'auto' }}>
      <PageHeader
        title={productName}
        status={current ? <ProductStatus product={current} variant="body1" /> : undefined}
        subtitle={current ? joined(copy.code(current.sku), saveNote) : (saveNote ?? copy.newSubtitle)}
        actions={actions}
      />
      {banners.length > 0 && (
        <Stack spacing={1.5} sx={{ mb: 3 }}>
          {banners}
        </Stack>
      )}
      <Box data-testid="editor-columns" data-layout={desktop ? 'two-column' : 'single'} sx={columnsSx(desktop)}>
        <Stack spacing={3} sx={{ minWidth: 0 }}>
          {page.photos}
          {page.about}
          {page.sizes}
          {page.price}
        </Stack>
        <Stack spacing={3} sx={{ minWidth: 0 }}>
          {live && <LiveNote />}
          {current && <HistoryCard history={current.history} />}
          <ReturnsNote />
        </Stack>
      </Box>
      {menus}
    </Box>
  )
}
