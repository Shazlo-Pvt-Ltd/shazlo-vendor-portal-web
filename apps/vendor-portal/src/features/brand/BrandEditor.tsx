import { Alert, Autocomplete, Box, Button, Chip, InputAdornment, Stack, TextField, Typography } from '@mui/material'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api, apiQueryKey } from '../../api'
import { ApiError } from '../../api/errors'
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges'
import { useConfirm } from '../../ui/ConfirmDialog'
import { useToast } from '../../ui/Toast'
import { friendlyError } from '../errors'
import { ImageUploader } from '../uploads/ImageUploader'
import { BrandPreview } from './BrandPreview'
import { formatDate, type LatestReview } from './review'
import {
  BRAND_FIELD_ORDER,
  LIMITS,
  normaliseInstagram,
  sameContent,
  serverErrorsToFields,
  toBody,
  toValues,
  validateBrand,
  type BrandDraft,
  type BrandErrors,
  type BrandField,
  type BrandValues,
} from './rules'

const DRAFT_PATH = '/v1/vendor/brand-profile'

const FIELD_ID: Record<BrandField, string> = {
  brandName: 'brand-name',
  tagline: 'brand-tagline',
  about: 'brand-about',
  logo: 'brand-logo',
  banner: 'brand-banner',
  website: 'brand-website',
  instagram: 'brand-instagram',
  categories: 'brand-categories',
  priceMin: 'brand-price-min',
  priceMax: 'brand-price-max',
}

interface Props {
  draft: BrandDraft
  latest: LatestReview | undefined
}

/**
 * The brand page's draft: a form, a live preview beside it (below it on a phone), save and
 * submit. A version in review is shown locked: editing it needs a deliberate "Edit a new draft".
 * The parent gives it `key={draft.id}`, so a new draft (after a submission) starts it afresh.
 */
export function BrandEditor({ draft, latest }: Props) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const toast = useToast()
  const save = api.useMutation('put', DRAFT_PATH)
  const submit = api.useMutation('post', '/v1/vendor/brand-profile/submit')

  const [saved, setSaved] = useState<BrandValues>(() => toValues(draft))
  const [values, setValues] = useState<BrandValues>(saved)
  const [errors, setErrors] = useState<BrandErrors>({})
  const [formError, setFormError] = useState<string | undefined>()
  const [unlocked, setUnlocked] = useState(false)
  const [focusRequest, setFocusRequest] = useState(0)
  const [uploaderResets, setUploaderResets] = useState({ logo: 0, banner: 0 })

  const inReview = draft.in_review_version !== null
  const locked = inReview && !unlocked
  const dirty = !sameContent(values, saved)
  const busy = save.isPending || submit.isPending

  // Leaving with unsaved edits: in the app (a link, back) and out of it (closing the tab).
  useUnsavedChanges(dirty, 'You have changes to your brand page that are not saved. If you leave now, they are lost.')

  useEffect(() => {
    if (focusRequest === 0) return
    const first = BRAND_FIELD_ORDER.find((field) => errors[field])
    if (first) document.getElementById(FIELD_ID[first])?.focus()
  }, [focusRequest]) // only when an attempt to save or submit asks for it

  function change<K extends keyof BrandValues>(key: K, value: BrandValues[K], field?: BrandField) {
    setValues((current) => ({ ...current, [key]: value }))
    if (field && errors[field]) setErrors((current) => ({ ...current, [field]: undefined }))
  }

  function showErrors(problems: BrandErrors) {
    setErrors(problems)
    setFocusRequest((n) => n + 1)
  }

  /** Saves the whole draft. Returns whether it worked; the reason is on screen when it did not. */
  async function saveDraft(): Promise<boolean> {
    setFormError(undefined)
    const problems = validateBrand(values)
    if (Object.keys(problems).length > 0) {
      showErrors(problems)
      return false
    }
    setErrors({})
    try {
      const result = await save.mutateAsync({ body: toBody(values) })
      const next = { ...toValues(result), logoUrl: values.logoUrl ?? result.logo_url, bannerUrl: values.bannerUrl ?? result.banner_url }
      setSaved(next)
      setValues(next)
      queryClient.setQueryData(api.queryOptions('get', DRAFT_PATH).queryKey, result)
      return true
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 422) {
        const { fields, form } = serverErrorsToFields(caught.fieldErrors, caught.message)
        setErrors(fields)
        setFormError(form)
        if (Object.keys(fields).length > 0) setFocusRequest((n) => n + 1)
      } else {
        setFormError(friendlyError(caught).message)
      }
      return false
    }
  }

  async function onSave() {
    if (await saveDraft()) toast.success('Brand page saved')
  }

  function refreshAfterDecision() {
    for (const path of [DRAFT_PATH, '/v1/vendor/brand-profile/published', '/v1/vendor/submissions']) {
      void queryClient.invalidateQueries({ queryKey: apiQueryKey(path) })
    }
  }

  async function onSubmit() {
    setFormError(undefined)
    // The API needs a category to submit: say so before asking it.
    const problems = validateBrand(values, { forSubmit: true })
    if (Object.keys(problems).length > 0) {
      showErrors(problems)
      return
    }
    const go = await confirm({
      title: 'Submit your brand page for review?',
      message: (
        <>
          Our team will review this version. Until they decide, you cannot submit another one, and the page shoppers see
          does not change. You can keep editing a new draft meanwhile. If it is not approved, you will see the reason here and
          can fix it and submit again.
          {dirty ? ' Your unsaved changes are saved first.' : ''}
        </>
      ),
      confirmLabel: 'Submit for review',
    })
    if (!go) return
    if (dirty && !(await saveDraft())) return
    try {
      await submit.mutateAsync({})
      toast.success('Submitted for review')
      refreshAfterDecision()
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'review_pending') {
        setFormError('A version of your brand page is already waiting for a decision. Wait for it; you can keep editing a new draft.')
        refreshAfterDecision()
      } else if (caught instanceof ApiError && caught.code === 'nothing_to_submit') {
        setFormError('There is nothing new to submit. Change something first, then submit again.')
        refreshAfterDecision()
      } else if (caught instanceof ApiError && caught.status === 422 && caught.code === 'profile_incomplete') {
        showErrors({ categories: 'Add at least one category before you submit, for example kurtas.' })
      } else if (caught instanceof ApiError && caught.status === 422) {
        const { fields, form } = serverErrorsToFields(caught.fieldErrors, caught.message)
        setErrors(fields)
        setFormError(form)
      } else {
        setFormError(friendlyError(caught).message)
      }
    }
  }

  const field = (name: BrandField) => ({ id: FIELD_ID[name], error: errors[name] !== undefined })
  const help = (name: BrandField, hint?: string) => errors[name] ?? hint
  const handle = normaliseInstagram(values.instagram)

  return (
    <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) minmax(0, 1fr)' }, alignItems: 'start' }}>
      <Box component="form" noValidate aria-label="Brand page" onSubmit={(event) => { event.preventDefault(); void onSave() }}>
        <Stack spacing={2.5}>
          {inReview ? (
            <Alert
              severity="info"
              action={
                locked ? (
                  <Button color="inherit" size="small" onClick={() => setUnlocked(true)}>
                    Edit a new draft
                  </Button>
                ) : undefined
              }
            >
              <strong>Version {draft.in_review_version} is in review</strong>
              {latest?.status === 'pending' ? ` since ${formatDate(latest.submitted_at)}` : ''}. It cannot be changed.{' '}
              {locked
                ? 'To make more changes, start a new draft; it will not affect the review.'
                : 'You are editing a new draft. You can submit it after the decision.'}
            </Alert>
          ) : null}
          {!inReview && latest?.status === 'rejected' ? (
            <Alert severity="warning">
              <strong>Version {latest.version} was not approved.</strong> {latest.reason ?? 'No reason was given.'} Fix it and submit again.
            </Alert>
          ) : null}
          {formError ? (
            <Alert severity="error" role="alert">
              {formError}
            </Alert>
          ) : null}

          <Box component="fieldset" disabled={locked || busy} sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}>
            <Stack spacing={2.5}>
              <TextField
                {...field('brandName')}
                label="Brand name"
                required
                value={values.brandName}
                onChange={(event) => change('brandName', event.target.value, 'brandName')}
                helperText={help('brandName')}
                slotProps={{ htmlInput: { maxLength: LIMITS.brandName } }}
                fullWidth
              />
              <TextField
                {...field('tagline')}
                label="Tagline"
                value={values.tagline}
                onChange={(event) => change('tagline', event.target.value, 'tagline')}
                helperText={help('tagline', 'One short line, for example "Block prints, made slowly".')}
                slotProps={{ htmlInput: { maxLength: LIMITS.tagline } }}
                fullWidth
              />
              <TextField
                {...field('about')}
                label="About your brand"
                multiline
                minRows={4}
                value={values.about}
                onChange={(event) => change('about', event.target.value, 'about')}
                helperText={help('about', `${values.about.length} of ${LIMITS.about} characters.`)}
                slotProps={{ htmlInput: { maxLength: LIMITS.about } }}
                fullWidth
              />

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <ImageUploader
                    key={`logo-${uploaderResets.logo}`}
                    kind="brand_logo"
                    label="Brand logo"
                    currentUrl={values.logoUrl}
                    onUploaded={(asset) => setValues((current) => ({ ...current, logoAssetId: asset.id, logoUrl: asset.url }))}
                  />
                  {values.logoAssetId ? (
                    <Button size="small" sx={{ mt: 1 }} onClick={() => { setValues((c) => ({ ...c, logoAssetId: null, logoUrl: null })); setUploaderResets((r) => ({ ...r, logo: r.logo + 1 })) }}>
                      Remove logo
                    </Button>
                  ) : null}
                  {errors.logo ? <Typography color="error" variant="caption" role="alert">{errors.logo}</Typography> : null}
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <ImageUploader
                    key={`banner-${uploaderResets.banner}`}
                    kind="brand_banner"
                    label="Banner"
                    currentUrl={values.bannerUrl}
                    onUploaded={(asset) => setValues((current) => ({ ...current, bannerAssetId: asset.id, bannerUrl: asset.url }))}
                  />
                  {values.bannerAssetId ? (
                    <Button size="small" sx={{ mt: 1 }} onClick={() => { setValues((c) => ({ ...c, bannerAssetId: null, bannerUrl: null })); setUploaderResets((r) => ({ ...r, banner: r.banner + 1 })) }}>
                      Remove banner
                    </Button>
                  ) : null}
                  {errors.banner ? <Typography color="error" variant="caption" role="alert">{errors.banner}</Typography> : null}
                </Box>
              </Stack>

              <TextField
                {...field('website')}
                label="Website"
                type="url"
                autoComplete="url"
                value={values.website}
                onChange={(event) => change('website', event.target.value, 'website')}
                helperText={help('website', 'Starts with https://')}
                slotProps={{ htmlInput: { maxLength: LIMITS.website, inputMode: 'url' } }}
                fullWidth
              />
              <TextField
                {...field('instagram')}
                label="Instagram"
                value={values.instagram}
                onChange={(event) => change('instagram', event.target.value, 'instagram')}
                helperText={help('instagram', handle ? `We will save this as @${handle}` : 'Your name, like @atelier.rao, or the address of your profile.')}
                fullWidth
              />

              <Autocomplete
                multiple
                freeSolo
                autoSelect
                options={[] as string[]}
                value={values.categories}
                onChange={(_event, next) => change('categories', next, 'categories')}
                renderValue={(items, getItemProps) =>
                  items.map((item, index) => {
                    const { key, ...props } = getItemProps({ index })
                    return <Chip key={key} size="small" label={item} {...props} />
                  })
                }
                renderInput={(params) => (
                  <TextField
                    {...params}
                    {...field('categories')}
                    label="Categories"
                    required
                    helperText={help('categories', 'Type a category and press Enter, for example kurtas. Up to 20.')}
                  />
                )}
              />

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  {...field('priceMin')}
                  label="Lowest price"
                  required
                  value={values.priceMin}
                  onChange={(event) => change('priceMin', event.target.value, 'priceMin')}
                  helperText={help('priceMin')}
                  slotProps={{ input: { startAdornment: <InputAdornment position="start">₹</InputAdornment> }, htmlInput: { inputMode: 'decimal' } }}
                  fullWidth
                />
                <TextField
                  {...field('priceMax')}
                  label="Highest price"
                  required
                  value={values.priceMax}
                  onChange={(event) => change('priceMax', event.target.value, 'priceMax')}
                  helperText={help('priceMax')}
                  slotProps={{ input: { startAdornment: <InputAdornment position="start">₹</InputAdornment> }, htmlInput: { inputMode: 'decimal' } }}
                  fullWidth
                />
              </Stack>
            </Stack>
          </Box>

          <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
            <Button type="submit" variant="contained" disabled={locked || busy || !dirty}>
              {save.isPending ? 'Saving…' : 'Save draft'}
            </Button>
            <Button variant="outlined" onClick={() => void onSubmit()} disabled={locked || inReview || busy}>
              {submit.isPending ? 'Submitting…' : 'Submit for review'}
            </Button>
            {dirty && !locked ? (
              <Typography variant="body2" color="text.secondary" role="status">
                Unsaved changes
              </Typography>
            ) : null}
          </Stack>
          {inReview && !locked ? (
            <Typography variant="body2" color="text.secondary">
              You can submit again once version {draft.in_review_version} has been decided.
            </Typography>
          ) : null}
        </Stack>
      </Box>

      <BrandPreview values={values} title="Live preview" />
    </Box>
  )
}
