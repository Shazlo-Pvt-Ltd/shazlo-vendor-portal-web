import { zodResolver } from '@hookform/resolvers/zod'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, IconButton, Link, ListItemIcon, Menu, MenuItem, Stack, Typography, useMediaQuery } from '@mui/material'
import type { Theme } from '@mui/material/styles'
import { Banner, neutral, PageHeader, radius, StatusPill, useSnackbar, type PillStatus } from '@shazlo/ui'
import { Archive, MoreHorizontal } from 'lucide-react'
import { useCallback, useEffect, useEffectEvent, useId, useRef, useState, type ReactNode } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useNavigate } from 'react-router'
import { ApiError, type Schemas } from '../../../api/client'
import { useArchiveProduct, useBrandPage, useCreateProduct, useMe, useSubmitProduct, useUpdateProduct } from '../../../api/queries'
import { paths } from '../../../app/paths'
import { productEditorCopy } from '../../../copy/productEditor'
import { SaveStatus, useAutosave } from '../../../lib/autosave'
import { formatRelative } from '../../../lib/format'
import { productPills } from '../../../lib/status'
import { DetailsCard } from './DetailsCard'
import { columnsSx } from './EditorSkeleton'
import { baseOf, editorSchema, toInput, toValues, type EditorValues } from './form'
import { missingAngles, PhotosCard, photoSlotId } from './PhotosCard'
import { PriceCard } from './PriceCard'
import { HistoryCard, LiveNote, ReturnsCard } from './SideCards'
import { SizesField, sizesFocusId } from './SizesCard'

type Product = Schemas['Product']
type Problem = { key: string; text: string }

const copy = productEditorCopy

// 422 `fields` from submit, in the order the cards sit on the page.
const FIELD_ORDER = ['images', 'title', 'description', 'category', 'gender', 'fabric', 'mrp_paise', 'price_paise', 'variants']
const FORM_FIELD: Partial<Record<string, keyof EditorValues>> = { title: 'title', description: 'description', category: 'category', gender: 'gender', fabric: 'fabric', mrp_paise: 'mrp', price_paise: 'price' }
const NO_IMAGES: Product['images'] = []
const rank = (key: string) => (FIELD_ORDER.includes(key) ? FIELD_ORDER.indexOf(key) : FIELD_ORDER.length)

// The editor for one product. `product` is null on /products/new until the first save creates it;
// the same instance then carries on (the parent keeps its key) so focus and typing are not lost.
export function Editor({ product, onCreated, onStale }: { product: Product | null; onCreated?: (id: string) => void; onStale?: () => void }) {
  const navigate = useNavigate()
  const notify = useSnackbar()
  const idPrefix = useId()
  const menuId = useId()
  const dialogTitleId = useId()
  const dialogBodyId = useId()
  const twoColumn = useMediaQuery((t: Theme) => t.breakpoints.up('lg'))
  const compact = !useMediaQuery((t: Theme) => t.breakpoints.up('md'))
  const commissionBps = useMe().data?.vendor.commission_bps
  const brandPage = useBrandPage().data
  const policy = (brandPage?.live ?? brandPage?.draft)?.return_policy

  const [created, setCreated] = useState<Product | null>(null)
  const current = product ?? created
  const id = current?.id ?? ''
  const status = current?.status ?? 'draft'
  const live = status === 'approved'

  const [defaultValues] = useState(() => toValues(product))
  const [resolver] = useState(() => zodResolver(editorSchema(product?.status === 'approved')))
  const form = useForm<EditorValues>({ defaultValues, resolver, mode: 'onTouched' })
  const { control, getValues, setError, clearErrors, setFocus, trigger } = form
  const values = useWatch({ control }) as EditorValues

  const [locked, setLocked] = useState(false)
  const [outcome, setOutcome] = useState<'sent' | 'changesSent' | null>(null)
  const [problems, setProblems] = useState<Problem[] | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [imagesProblem, setImagesProblem] = useState<string | null>(null)
  const [variantsProblem, setVariantsProblem] = useState<string | null>(null)
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)
  const [creating, setCreating] = useState<{ busy: boolean; failedFor: string | null }>({ busy: false, failedFor: null })
  const clearVariantsProblem = useCallback(() => setVariantsProblem(null), [])

  const inReview = status === 'pending_review' || Boolean(current?.edit_in_review)
  const readOnly = locked || inReview || status === 'archived'

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

  // ---- new product: created once the seller types a title ------------------------------------
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

  // ---- submit ----------------------------------------------------------------------------------
  const submit = useSubmitProduct(id)

  function focusProblem(key: string | undefined) {
    if (!key) return
    const field = FORM_FIELD[key]
    if (field) return setFocus(field)
    if (key === 'variants') return document.getElementById(sizesFocusId(idPrefix))?.focus()
    if (key === 'images') {
      const angle = missingAngles(current?.images ?? [])[0]
      if (angle) document.getElementById(photoSlotId(idPrefix, angle))?.focus()
    }
  }

  function showProblems(fields: Record<string, string>) {
    const keys = Object.keys(fields).sort((a, b) => rank(a) - rank(b))
    setProblems(keys.map((key) => ({ key, text: `${copy.fieldLabels[key] ?? key}: ${fields[key]}` })))
    for (const key of keys) {
      const field = FORM_FIELD[key]
      if (field) setError(field, { type: 'server', message: fields[key] })
    }
    setImagesProblem(fields.images ?? null)
    setVariantsProblem(fields.variants ?? null)
    focusProblem(keys[0])
  }

  async function onSubmit() {
    setActionError(null)
    setProblems(null)
    if (!(await trigger(['mrp', 'price'], { shouldFocus: true }))) return
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
      setImagesProblem(null)
      setVariantsProblem(null)
      clearErrors()
    } catch (error) {
      if (error instanceof ApiError && error.status === 422 && Object.keys(error.fields).length) {
        showProblems(error.fields)
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
      notify(copy.archive.done)
      void navigate(paths.products)
    } catch (error) {
      setArchiveError(error instanceof Error ? error.message : copy.banners.unsaved)
    }
  }

  // ---- header ----------------------------------------------------------------------------------
  const pills: PillStatus[] = current ? productPills({ ...current, publishing: false }) : ['draft']
  const mainLabel = status === 'rejected' ? copy.submit.rejected : live ? copy.submit.approved : copy.submit.draft
  let saveNote: ReactNode = null
  if (!current) {
    saveNote = creating.busy ? <SaveStatus component="span" state="saving" savedAt={null} /> : creating.failedFor !== null ? <Box component="span" sx={{ color: 'error.main' }}>{copy.save.createFailed}</Box> : null
  } else if (!locked) {
    saveNote = <SaveStatus component="span" state={autosave.state} savedAt={autosave.savedAt} />
  }
  const subtitle = current ? (
    <>
      <Typography component="span" variant="mono" sx={{ fontSize: '0.8125rem' }}>
        {current.sku}
      </Typography>
      {saveNote && ' · '}
      {saveNote}
    </>
  ) : (
    saveNote ?? copy.newSubtitle
  )

  const showMore = Boolean(current) && status !== 'archived'
  const showMain = Boolean(current) && !readOnly
  const actions = showMore || showMain ? (
    <>
      {showMore && (
        <IconButton
          aria-label={copy.moreActions}
          aria-haspopup="menu"
          aria-controls={menuAnchor ? menuId : undefined}
          aria-expanded={menuAnchor ? 'true' : undefined}
          onClick={(event) => setMenuAnchor(event.currentTarget)}
          sx={{ width: compact ? 44 : 40, height: compact ? 44 : 40, border: `1px solid ${neutral.lineStrong}`, borderRadius: `${radius.control}px`, color: neutral.ink }}
        >
          <MoreHorizontal size={18} strokeWidth={1.5} aria-hidden="true" />
        </IconButton>
      )}
      {showMain && (
        <Button variant="contained" size="large" onClick={() => void onSubmit()} disabled={submit.isPending} sx={{ flex: { xs: 1, md: 'none' }, minHeight: 44 }}>
          {submit.isPending ? copy.submit.sending : mainLabel}
        </Button>
      )}
    </>
  ) : undefined

  // ---- banners ---------------------------------------------------------------------------------
  const banners: ReactNode[] = []
  if (problems) {
    banners.push(
      <Banner key="problems" tone="error" title={copy.banners.problems} onClose={() => setProblems(null)}>
        <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
          {problems.map((p) => (
            <li key={p.key}>
              <Link component="button" type="button" variant="body2" onClick={() => focusProblem(p.key)} sx={{ textAlign: 'left', verticalAlign: 'baseline', color: 'inherit', textDecorationColor: 'currentColor' }}>
                {p.text}
              </Link>
            </li>
          ))}
        </Box>
      </Banner>,
    )
  }
  if (actionError) {
    banners.push(
      <Banner key="action-error" tone="error" title={actionError} action={!readOnly && <Button onClick={() => void onSubmit()}>{copy.banners.retry}</Button>} onClose={() => setActionError(null)} />,
    )
  }
  if (outcome) {
    banners.push(<Banner key="outcome" tone="success" title={outcome === 'sent' ? copy.banners.sent : copy.banners.changesSent} />)
  } else if (locked) {
    banners.push(<Banner key="locked" tone="info" title={copy.banners.locked} />)
  } else if (status === 'pending_review') {
    banners.push(<Banner key="pending" tone="info" title={copy.banners.pending} />)
  } else if (current?.edit_in_review) {
    banners.push(<Banner key="edit" tone="info" title={copy.banners.editInReview} />)
  } else if (status === 'archived') {
    banners.push(<Banner key="archived" tone="info" title={copy.banners.archived} />)
  } else if (status === 'rejected' && current?.review.reason) {
    banners.push(
      <Banner key="sent-back" tone="warning" title={`“${current.review.reason}”`}>
        {copy.banners.reviewedBy(current.review.at ? formatRelative(current.review.at) : '')}
      </Banner>,
    )
  }

  return (
    <>
      <PageHeader
        title={current ? current.title || copy.untitled : copy.newTitle}
        status={
          <Stack direction="row" spacing={1}>
            {pills.map((pill) => (
              <StatusPill key={pill} status={pill} />
            ))}
          </Stack>
        }
        subtitle={subtitle}
        actions={actions}
      />
      {banners.length > 0 && (
        <Stack spacing={1.5} sx={{ mb: 3 }}>
          {banners}
        </Stack>
      )}

      <Box data-testid="editor-columns" data-layout={twoColumn ? 'two-column' : 'single'} sx={columnsSx(twoColumn)}>
        <Stack spacing={3} sx={{ minWidth: 0 }}>
          <PhotosCard
            productId={current?.id ?? null}
            images={current?.images ?? NO_IMAGES}
            readOnly={readOnly}
            flagMissing={status === 'rejected' || imagesProblem !== null}
            problem={imagesProblem}
            compact={compact}
            idPrefix={idPrefix}
          />
          <DetailsCard form={form} readOnly={readOnly} />
          <PriceCard form={form} readOnly={readOnly} live={live} commissionBps={commissionBps} />
          <SizesField control={control} onEdit={clearVariantsProblem} sku={current?.sku ?? null} readOnly={readOnly} problem={variantsProblem} compact={compact} idPrefix={idPrefix} />
        </Stack>
        <Stack spacing={3} sx={{ minWidth: 0 }}>
          {live && <LiveNote />}
          {current && <HistoryCard history={current.history} />}
          <ReturnsCard form={form} policy={policy} readOnly={readOnly} />
        </Stack>
      </Box>

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
}
