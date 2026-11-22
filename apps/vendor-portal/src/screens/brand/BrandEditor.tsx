import { zodResolver } from '@hookform/resolvers/zod'
import { Box, Button, Card, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, FormHelperText, Link, Skeleton, Stack, Typography, useMediaQuery } from '@mui/material'
import type { Theme } from '@mui/material/styles'
import { Banner, PageHeader, radius, SectionCard, shadow, StatusPill } from '@shazlo/ui'
import { Eye, EyeOff, Send } from 'lucide-react'
import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Link as RouterLink } from 'react-router'
import { ApiError } from '../../api/errors'
import type { Schemas } from '../../api/model'
import { useBrandPage, useDiscardBrandDraft, useMe, useSaveBrandDraft, useSubmitBrandPage } from '../../api/queries'
import { useCrumb } from '../../app/crumbs'
import { paths } from '../../app/paths'
import { brandCopy as copy } from '../../copy/brand'
import { SaveStatus, useAutosave } from '../../lib/autosave'
import { BrandPreview, PHONE_OUTLINE } from './BrandPreview'
import { BrandNameField, ImageInput, TextInput, touchTarget } from './fields'
import { brandSchema, changedFields, emptyProfile, forSaving, isEditableField, LIMITS, normaliseInstagram, toValues, type BrandValues, type Profile } from './schema'

type Page = Schemas['BrandPage']
type Outcome = { tone: 'success' | 'error'; title: string; link?: { to: string; label: string } }

// The form and a phone preview sit side by side only where both fit (≥ 1200 px with the sidebar);
// narrower screens get one column with the preview behind a button.
const useSideBySide = () => useMediaQuery((t: Theme) => t.breakpoints.up('lg'))

const columns = {
  display: 'grid',
  gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 3fr) minmax(320px, 2fr)' },
  gap: { xs: 3, lg: 5 },
  alignItems: 'start',
} as const
const SELLER_ADDED = ['logo_url', 'cover_url', 'tagline', 'story', 'instagram', 'website'] as const satisfies readonly (keyof BrandValues)[]
const pair = { display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 3 } as const

// Stable props for the memoised inputs.
const PLACE_INPUT: InputHTMLAttributes<HTMLInputElement> = { autoComplete: 'address-level2' }
const HANDLE_INPUT: InputHTMLAttributes<HTMLInputElement> = { autoComplete: 'off', autoCapitalize: 'none', spellCheck: false }
const URL_INPUT: InputHTMLAttributes<HTMLInputElement> = { inputMode: 'url', autoComplete: 'url', autoCapitalize: 'none', spellCheck: false }

export default function BrandEditor() {
  useCrumb(copy.crumb)
  const page = useBrandPage()
  const me = useMe()
  // Discarding swaps the whole form for a fresh one built from the live page, which then says so.
  const [generation, setGeneration] = useState(0)
  const [discarded, setDiscarded] = useState<string | null>(null)
  const data = page.data
  const brandName = data?.live?.brand_name ?? data?.draft?.brand_name ?? me.data?.vendor.brand_name

  if (data && (brandName !== undefined || !me.isPending)) {
    return (
      <BrandForm
        key={generation}
        page={data}
        brandName={brandName ?? ''}
        discarded={discarded}
        onDismissDiscarded={() => setDiscarded(null)}
        onDiscarded={(message) => {
          setDiscarded(message)
          setGeneration((g) => g + 1)
        }}
      />
    )
  }
  if (page.isError) {
    return (
      <>
        <PageHeader title={copy.title} />
        <Banner
          tone="error"
          title={copy.loadError}
          action={
            <Button variant="outlined" onClick={() => void page.refetch()} disabled={page.isFetching} sx={touchTarget}>
              {page.isFetching ? copy.retrying : copy.retry}
            </Button>
          }
        >
          {page.error.message}
        </Banner>
      </>
    )
  }
  return <BrandSkeleton />
}

function CardSkeleton({ rows }: { rows: number }) {
  return (
    <Card sx={{ px: { xs: 2, sm: 3 }, py: 2.5 }}>
      <Skeleton variant="text" width={140} height={28} />
      {Array.from({ length: rows }, (_, i) => (
        <Box key={i} sx={{ mt: 2.5 }}>
          <Skeleton variant="text" width={96} />
          <Skeleton variant="rounded" height={40} />
        </Box>
      ))}
    </Card>
  )
}

function BrandSkeleton() {
  const sideBySide = useSideBySide()
  return (
    <>
      <PageHeader title={copy.title} />
      <Box role="status" aria-label={copy.loading} aria-busy="true" sx={columns}>
        <Stack spacing={3}>
          <Card sx={{ px: { xs: 2, sm: 3 }, py: 2.5 }}>
            <Skeleton variant="text" width={140} height={28} />
            <Stack direction="row" spacing={2} sx={{ mt: 2.5, alignItems: 'center' }}>
              <Skeleton variant="circular" width={64} height={64} />
              <Skeleton variant="text" sx={{ flex: 1 }} />
            </Stack>
            <Skeleton variant="rounded" sx={{ mt: 3, aspectRatio: '8 / 3', height: 'auto' }} />
            {[0, 1, 2].map((i) => (
              <Box key={i} sx={{ mt: 2.5 }}>
                <Skeleton variant="text" width={96} />
                <Skeleton variant="rounded" height={i === 2 ? 112 : 40} />
              </Box>
            ))}
          </Card>
          <CardSkeleton rows={2} />
        </Stack>
        {sideBySide ? (
          <Box>
            <Skeleton variant="text" width={200} />
            <Skeleton variant="rounded" sx={{ ...PHONE_OUTLINE, height: 'auto', mx: 'auto', mt: 2 }} />
          </Box>
        ) : (
          <Skeleton variant="rounded" height={44} />
        )}
      </Box>
    </>
  )
}

function CollapsiblePreview({ draft, live }: { draft: Profile; live: Profile | null }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const Icon = open ? EyeOff : Eye
  return (
    <Box>
      <Button
        variant="outlined"
        fullWidth
        startIcon={<Icon size={18} strokeWidth={1.75} aria-hidden="true" />}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
        sx={touchTarget}
      >
        {open ? copy.preview.hide : copy.preview.show}
      </Button>
      {open && (
        <Box id={id} sx={{ mt: 3 }}>
          <BrandPreview draft={draft} live={live} />
        </Box>
      )}
    </Box>
  )
}

function DiscardDialog({ open, firstPage, working, error, onCancel, onConfirm }: { open: boolean; firstPage: boolean; working: boolean; error: string | null; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Dialog
      open={open}
      onClose={working ? undefined : onCancel}
      maxWidth="xs"
      fullWidth
      slotProps={{ paper: { elevation: 0, sx: { borderRadius: `${radius.sheet}px`, boxShadow: shadow.overlay } } }}
    >
      <DialogTitle sx={{ typography: 'h2', pb: 1 }}>{copy.discardDialog.title}</DialogTitle>
      <DialogContent>
        <DialogContentText variant="body1">{firstPage ? copy.discardDialog.bodyFirst : copy.discardDialog.body}</DialogContentText>
        {error && (
          <FormHelperText error role="alert" sx={{ mx: 0, mt: 1.5 }}>
            {error}
          </FormHelperText>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1, flexWrap: 'wrap' }}>
        <Button onClick={onCancel} disabled={working} sx={touchTarget}>
          {copy.discardDialog.keep}
        </Button>
        <Button variant="contained" color="error" onClick={onConfirm} disabled={working} sx={touchTarget}>
          {working ? copy.discardDialog.working : copy.discardDialog.confirm}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : copy.genericError
}

/** A refusal of some of the values (422), which the form shows on those fields. */
const refusedFields = (error: unknown): [keyof BrandValues, string][] =>
  error instanceof ApiError && error.status === 422 ? (Object.entries(error.fields).filter(([key]) => isEditableField(key)) as [keyof BrandValues, string][]) : []

/** Why sending for review did not work, in words that say what to do. */
function submitOutcome(error: unknown): Outcome {
  if (error instanceof ApiError && error.code === 'review_pending') return { tone: 'error', title: copy.errors.reviewPending }
  // vendor-api needs to know what the brand sells; Build 2 takes it from the store details.
  if (error instanceof ApiError && error.code === 'profile_incomplete') return { tone: 'error', title: copy.errors.needsStore, link: { to: paths.storeSection('brand'), label: copy.errors.needsStoreLink } }
  return { tone: 'error', title: messageOf(error) }
}

function BrandForm({
  page,
  brandName,
  discarded,
  onDismissDiscarded,
  onDiscarded,
}: {
  page: Page
  brandName: string
  discarded: string | null
  onDismissDiscarded: () => void
  onDiscarded: (message: string) => void
}) {
  const sideBySide = useSideBySide()
  const { live, review } = page
  // While a version is in review it stays as sent (main's rule). The seller may start a new draft
  // beside it, which saves as usual but can only be sent once the review is decided.
  const waiting = review.state === 'waiting'
  const [unlocked, setUnlocked] = useState(false)
  const editable = !waiting || unlocked

  const [initial] = useState(() => toValues(page.draft ?? live ?? emptyProfile(brandName)))
  const { control, handleSubmit, setError, formState } = useForm<BrandValues>({ resolver: zodResolver(brandSchema), defaultValues: initial, mode: 'onChange' })
  const values = useWatch({ control }) as BrandValues
  const valid = brandSchema.safeParse(values).success
  const changed = changedFields(values, live)
  // A first page has something to discard once the seller has added to it (the place comes from sign-up).
  const hasChanges = live ? changed.size > 0 : SELLER_ADDED.some((key) => Boolean(values[key]))

  // Options board pick: the draft saves a second after typing stops; invalid values are never saved.
  const saveDraft = useSaveBrandDraft()
  const failedSave = useRef<unknown>(null)
  const autosave = useAutosave({
    values,
    enabled: editable && valid,
    savedAt: page.draft_saved_at,
    // Leaving the page within the second still saves the last edit.
    flushOnUnmount: true,
    isInvalid: (error) => refusedFields(error).length > 0,
    save: async (next: BrandValues) => {
      try {
        await saveDraft.mutateAsync(forSaving(next))
        failedSave.current = null
      } catch (error) {
        failedSave.current = error
        // vendor-api refused a value: say so on the field now, not only when sending for review.
        for (const [key, message] of refusedFields(error)) setError(key, { type: 'server', message })
        throw error
      }
    },
  })

  // Submitting stays a click: save whatever is still waiting, then send the saved draft.
  const submit = useSubmitBrandPage()
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const outcomeRef = useRef<HTMLDivElement>(null)

  const fail = (error: unknown) => {
    setOutcome(submitOutcome(error))
    refusedFields(error).forEach(([key, message], i) => setError(key, { type: 'server', message }, { shouldFocus: i === 0 }))
  }

  // Sent once: a second press while the first is on its way (isSubmitting is a render late) does nothing.
  const sending = useRef(false)
  const sendForReview = async () => {
    if (sending.current) return
    sending.current = true
    setOutcome(null)
    try {
      await autosave.flush()
      if (failedSave.current) return fail(failedSave.current)
      await submit.mutateAsync()
      setUnlocked(false)
      setOutcome({ tone: 'success', title: live ? copy.banners.submitted : copy.banners.submittedFirst })
    } catch (error) {
      fail(error)
    } finally {
      sending.current = false
    }
  }
  // Checks the fields first; an invalid form focuses its first problem and sends nothing.
  const onSubmit = () => handleSubmit(sendForReview)()

  // The submit button disappears once the page is in review, and the discard dialog closes, so
  // focus moves to what happened.
  useEffect(() => {
    if (outcome?.tone === 'success' || discarded) outcomeRef.current?.focus()
  }, [outcome, discarded])

  const discard = useDiscardBrandDraft()
  const [confirming, setConfirming] = useState(false)
  const [discardError, setDiscardError] = useState<string | null>(null)
  const confirmDiscard = async () => {
    setDiscardError(null)
    // Let a pending save land first, so it cannot recreate the draft after the delete.
    if (valid) await autosave.flush()
    try {
      await discard.mutateAsync()
      onDiscarded(live ? copy.discarded : copy.discardedFirst)
    } catch (error) {
      setDiscardError(messageOf(error))
    }
  }

  const pill =
    review.state === 'waiting' ? (
      <StatusPill status="pending" />
    ) : !live ? (
      <StatusPill status="draft" label={copy.pill.notLive} />
    ) : changed.size > 0 ? (
      <StatusPill status="draft" label={copy.pill.changes(changed.size)} />
    ) : (
      <StatusPill status="live" />
    )

  // One flex-gap row of our own: PageHeader's Stack spacing leaves a margin on items that wrap.
  const row = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1.5, rowGap: 1 } as const
  const actions = !editable ? (
    <Box sx={row}>
      <Button variant="outlined" onClick={() => setUnlocked(true)} sx={touchTarget}>
        {copy.editNewDraft}
      </Button>
    </Box>
  ) : waiting ? (
    <Box sx={row}>
      <SaveStatus state={autosave.state} savedAt={autosave.savedAt} />
      <Typography variant="body2" color="textSecondary">
        {copy.waitForDecision}
      </Typography>
    </Box>
  ) : (
    <Box sx={row}>
      <SaveStatus state={autosave.state} savedAt={autosave.savedAt} />
      {hasChanges && (
        <Button
          onClick={() => {
            setDiscardError(null)
            setConfirming(true)
          }}
          sx={touchTarget}
        >
          {copy.discard}
        </Button>
      )}
      <Button variant="contained" startIcon={<Send size={18} strokeWidth={1.75} aria-hidden="true" />} onClick={() => void onSubmit()} disabled={formState.isSubmitting} sx={touchTarget}>
        {formState.isSubmitting ? copy.submitting : copy.submit}
      </Button>
    </Box>
  )

  const banners: ReactNode[] = []
  if (discarded && !outcome) {
    banners.push(
      <Box key="discarded" ref={outcomeRef} tabIndex={-1} sx={{ borderRadius: `${radius.card}px` }}>
        <Banner tone="success" title={discarded} onClose={onDismissDiscarded} />
      </Box>,
    )
  }
  if (outcome?.tone === 'success') {
    banners.push(
      <Box key="outcome" ref={outcomeRef} tabIndex={-1} sx={{ borderRadius: `${radius.card}px` }}>
        <Banner tone="success" title={outcome.title} onClose={() => setOutcome(null)} />
      </Box>,
    )
  } else if (review.state === 'waiting') {
    banners.push(<Banner key="review" tone="info" title={copy.banners.inReview} />)
  }
  if (outcome?.tone === 'error') {
    banners.push(
      <Banner key="outcome" tone="error" title={outcome.title} onClose={() => setOutcome(null)}>
        {outcome.link && (
          <Link component={RouterLink} to={outcome.link.to}>
            {outcome.link.label}
          </Link>
        )}
      </Banner>,
    )
  }
  if (review.state === 'rejected') {
    banners.push(
      <Banner key="sent-back" tone="warning" title={copy.banners.sentBack}>
        {/* The reviewer's words as written: line breaks kept, markup shown as text. */}
        {review.reason && <Box component="span" sx={{ whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>“{review.reason}” </Box>}
        {copy.banners.sentBackNext}
      </Banner>,
    )
  }

  const locked = !editable
  const handle = normaliseInstagram(values.instagram)
  const instagramHint = handle && values.instagram.trim() !== `@${handle}` ? copy.shopping.instagramSaves(handle) : undefined
  return (
    <>
      <PageHeader title={copy.title} status={pill} subtitle={live ? copy.subtitle : copy.subtitleFirst} actions={actions} />
      {banners.length > 0 && <Stack spacing={1.5} sx={{ mb: { xs: 3, md: 4 } }}>{banners}</Stack>}
      <Box sx={columns}>
        <Stack spacing={3} sx={{ minWidth: 0 }}>
          <SectionCard title={copy.identity.title}>
            <Stack spacing={3}>
              <ImageInput control={control} name="logo_url" changed={changed.has('logo_url')} disabled={locked} brandName={brandName} />
              <ImageInput control={control} name="cover_url" changed={changed.has('cover_url')} disabled={locked} brandName={brandName} />
              <Box sx={pair}>
                <BrandNameField value={initial.brand_name} />
                <TextInput control={control} name="based_in" label={copy.identity.basedIn} changed={changed.has('based_in')} disabled={locked} htmlInput={PLACE_INPUT} />
              </Box>
              <TextInput control={control} name="tagline" label={copy.identity.tagline} changed={changed.has('tagline')} disabled={locked} max={LIMITS.tagline} />
              <TextInput control={control} name="story" label={copy.identity.story} changed={changed.has('story')} disabled={locked} max={LIMITS.story} multiline />
            </Stack>
          </SectionCard>
          <SectionCard title={copy.shopping.title}>
            <Stack spacing={3}>
              <Box sx={pair}>
                <TextInput control={control} name="instagram" label={copy.shopping.instagram} changed={changed.has('instagram')} disabled={locked} htmlInput={HANDLE_INPUT} hint={instagramHint} />
                <TextInput control={control} name="website" label={copy.shopping.website} changed={changed.has('website')} disabled={locked} htmlInput={URL_INPUT} />
              </Box>
              {/* Returns and delivery are store details now (spec §5); the preview reads them from there. */}
              <Typography variant="body1" color="textSecondary">
                {copy.shopping.fromStore}{' '}
                <Link component={RouterLink} to={paths.storeDetails}>
                  {copy.shopping.fromStoreLink}
                </Link>
              </Typography>
            </Stack>
          </SectionCard>
        </Stack>
        {sideBySide ? (
          <Box sx={{ position: 'sticky', top: 80 }}>
            <BrandPreview draft={values} live={live} />
          </Box>
        ) : (
          <CollapsiblePreview draft={values} live={live} />
        )}
      </Box>
      <DiscardDialog open={confirming} firstPage={!live} working={discard.isPending} error={discardError} onCancel={() => setConfirming(false)} onConfirm={() => void confirmDiscard()} />
    </>
  )
}
