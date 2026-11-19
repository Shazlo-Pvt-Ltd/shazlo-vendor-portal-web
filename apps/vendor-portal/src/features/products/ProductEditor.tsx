import { Alert, Box, Button, FormControlLabel, InputAdornment, MenuItem, Stack, Switch, TextField, Typography } from '@mui/material'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { api } from '../../api'
import { ApiError } from '../../api/errors'
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges'
import { useConfirm } from '../../ui/ConfirmDialog'
import { useToast } from '../../ui/Toast'
import { formatDate } from '../brand/review'
import { friendlyError } from '../errors'
import { editingState } from './editing'
import {
  FIELD_ORDER,
  GENDERS,
  LIMITS,
  NO_ERRORS,
  VARIANT_FIELD_ORDER,
  describeMissing,
  hasErrors,
  missingForSubmit,
  newProductValues,
  sameContent,
  serverErrorsToFields,
  toBody,
  toCreateBody,
  toValues,
  validateProduct,
  type ProductErrors,
  type ProductField,
  type ProductValues,
  type VariantField,
} from './form'
import { IMAGES_ID, ImagesEditor, altFieldId } from './ImagesEditor'
import { RevisionPanel } from './RevisionPanel'
import type { ProductDetail } from './status'
import { VARIANTS_ID, VariantsEditor, variantFieldId } from './VariantsEditor'

const LIST_PATH = '/v1/vendor/products'
const PRODUCT_PATH = '/v1/vendor/products/{product_id}'

const FIELD_ID: Record<ProductField, string> = {
  sku: 'product-sku',
  title: 'product-title',
  description: 'product-description',
  category: 'product-category',
  subcategory: 'product-subcategory',
  gender: 'product-gender',
  fabric: 'product-fabric',
  weight: 'product-weight',
  returnDays: 'product-return-days',
  variants: VARIANTS_ID,
  images: IMAGES_ID,
}

/** The element of the first problem on the page, in the order the vendor reads it. */
function firstProblemId(errors: ProductErrors, values: ProductValues): string | undefined {
  for (const field of FIELD_ORDER) {
    if (field === 'variants') {
      if (errors.fields.variants) return FIELD_ID.variants
      for (const variant of values.variants) {
        const row = errors.variants[variant.key]
        if (!row) continue
        const first = VARIANT_FIELD_ORDER.find((name) => row[name])
        return variantFieldId(variant.key, first ?? 'sku')
      }
    } else if (field === 'images') {
      if (errors.fields.images) return FIELD_ID.images
      const image = values.images.find((item) => errors.images[item.assetId])
      if (image) return altFieldId(image.assetId)
    } else if (errors.fields[field]) {
      return FIELD_ID[field]
    }
  }
  return undefined
}

/** Values the server saved, as the form shows them. Picture addresses come from the answer. */
function savedValues(product: ProductDetail): ProductValues | undefined {
  const revision = product.working ?? product.live
  return revision ? toValues(product.sku, revision) : undefined
}

interface Props {
  /** The product being edited; none to create one. */
  product?: ProductDetail
}

/**
 * The product form, shared by `/products/new` and `/products/:id`. It sends the whole revision on
 * every save (the API replaces it). Editing an approved product never changes what shoppers see:
 * the live version is shown beside the form and the edits become a new version that goes live
 * when approved. A version in review, and an archived product, are read-only.
 * The parent gives it `key={product.id}`, so another product starts it afresh.
 */
export function ProductEditor({ product }: Props) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const toast = useToast()
  const create = api.useMutation('post', LIST_PATH)
  const update = api.useMutation('put', PRODUCT_PATH)
  const submit = api.useMutation('post', '/v1/vendor/products/{product_id}/submit')

  const creating = product === undefined
  const state = product ? editingState(product) : undefined
  const readOnly = state?.readOnly ?? false

  const [saved, setSaved] = useState<ProductValues>(() => (product ? savedValues(product) : undefined) ?? newProductValues())
  const [values, setValues] = useState<ProductValues>(saved)
  const [errors, setErrors] = useState<ProductErrors>(NO_ERRORS)
  const [formError, setFormError] = useState<string | undefined>()
  const [focusRequest, setFocusRequest] = useState(0)

  const dirty = !readOnly && !sameContent(values, saved)
  const busy = create.isPending || update.isPending || submit.isPending
  const allowNavigation = useUnsavedChanges(dirty, 'You have changes to this product that are not saved. If you leave now, they are lost.')

  useEffect(() => {
    if (focusRequest === 0) return
    const id = firstProblemId(errors, values)
    if (id) document.getElementById(id)?.focus()
  }, [focusRequest]) // only when an attempt to save or submit asks for it

  function change<K extends keyof ProductValues>(key: K, value: ProductValues[K], field?: ProductField) {
    setValues((current) => ({ ...current, [key]: value }))
    if (field && errors.fields[field]) setErrors((current) => ({ ...current, fields: { ...current.fields, [field]: undefined } }))
  }

  function clearVariantError(key: string, field: VariantField | 'row') {
    setErrors((current) => {
      const row = current.variants[key]
      if (!row?.[field]) return current
      return { ...current, variants: { ...current.variants, [key]: { ...row, [field]: undefined } } }
    })
  }

  function clearImageError(assetId: string) {
    setErrors((current) => {
      if (!current.images[assetId]) return current
      const images = { ...current.images }
      delete images[assetId]
      return { ...current, images }
    })
  }

  function showErrors(problems: ProductErrors) {
    setErrors(problems)
    setFocusRequest((n) => n + 1)
  }

  function refreshProduct(id: string) {
    void queryClient.invalidateQueries({ queryKey: ['get', LIST_PATH] })
    void queryClient.invalidateQueries({ queryKey: api.queryOptions('get', PRODUCT_PATH, { params: { path: { product_id: id } } }).queryKey })
  }

  function remember(result: ProductDetail) {
    queryClient.setQueryData(api.queryOptions('get', PRODUCT_PATH, { params: { path: { product_id: result.id } } }).queryKey, result)
    void queryClient.invalidateQueries({ queryKey: ['get', LIST_PATH] })
  }

  /** Words for a failed save or submit; field problems go next to their fields. */
  function explain(caught: unknown, attempted: ProductValues) {
    if (caught instanceof ApiError) {
      switch (caught.code) {
        case 'sku_taken':
          setFormError(
            creating
              ? 'You already use one of these SKUs on another product: the product SKU or a variant SKU. Letter case does not count, and archived products keep theirs. Choose different SKUs.'
              : 'You already use one of these variant SKUs on another product. Letter case does not count, and archived products keep theirs. Choose a different SKU.',
          )
          return
        case 'product_in_review':
          setFormError('A version of this product is in review, so it cannot be changed until our team decides. Your changes are still here; copy anything you need.')
          if (product) refreshProduct(product.id)
          return
        case 'product_archived':
          setFormError('This product is archived, so it cannot be changed or submitted.')
          if (product) refreshProduct(product.id)
          return
        case 'product_incomplete': {
          const missing = describeMissing(missingForSubmit(attempted)) || 'an active variant and an image'
          showErrors(validateMissing(attempted))
          setFormError(`To submit, add ${missing}.`)
          return
        }
        case 'nothing_to_submit':
          setFormError('There is nothing new to submit. Change something first, then submit again.')
          if (product) refreshProduct(product.id)
          return
      }
      if (caught.status === 422) {
        const { errors: problems, form } = serverErrorsToFields(caught.fieldErrors, attempted, caught.message)
        setErrors(problems)
        setFormError(form)
        if (hasErrors(problems)) setFocusRequest((n) => n + 1)
        return
      }
    }
    setFormError(friendlyError(caught).message)
  }

  /** Saves the whole revision (creating the product the first time). Returns the product, or nothing when it failed. */
  async function persist(): Promise<ProductDetail | undefined> {
    setFormError(undefined)
    const problems = validateCurrent()
    if (hasErrors(problems)) {
      showErrors(problems)
      return undefined
    }
    setErrors(NO_ERRORS)
    const attempted = values
    try {
      const result = product
        ? await update.mutateAsync({ params: { path: { product_id: product.id } }, body: toBody(attempted) })
        : await create.mutateAsync({ body: toCreateBody(attempted) })
      remember(result)
      const next = savedValues(result) ?? attempted
      setSaved(next)
      setValues(next)
      return result
    } catch (caught) {
      explain(caught, attempted)
      return undefined
    }
  }

  function validateCurrent(forSubmit = false): ProductErrors {
    return validateProduct(values, { forSubmit, creating })
  }

  function goTo(result: ProductDetail) {
    allowNavigation()
    void navigate(`/products/${result.id}`, { replace: true })
  }

  async function onSave() {
    const result = await persist()
    if (!result) return
    toast.success(creating ? 'Product created' : 'Product saved')
    if (creating) goTo(result)
  }

  async function onSubmit() {
    setFormError(undefined)
    const problems = validateCurrent(true)
    if (hasErrors(problems)) {
      showErrors(problems)
      const missing = describeMissing(missingForSubmit(values))
      if (missing) setFormError(`To submit, add ${missing}.`)
      return
    }
    const go = await confirm({
      title: 'Submit this product for review?',
      message: (
        <>
          Our team will review this version. Until they decide, it cannot be changed.
          {state?.live ? ' The live product stays as it is until this version is approved.' : ' It goes on sale once it is approved.'} If
          it is not approved, you will see the reason here and can fix it and submit again.
          {creating ? ' The product is created first.' : dirty ? ' Your unsaved changes are saved first.' : ''}
        </>
      ),
      confirmLabel: 'Submit for review',
    })
    if (!go) return
    let target = product
    if (creating || dirty) {
      target = await persist()
      if (!target) return
    }
    if (!target) return
    const attempted = values
    try {
      const result = await submit.mutateAsync({ params: { path: { product_id: target.id } } })
      remember(result)
      toast.success('Submitted for review')
      if (creating) goTo(result)
    } catch (caught) {
      if (creating) {
        // The product exists now: carry on on its own page, where the reason is shown again.
        toast.error('The product was created, but it could not be submitted. Open it to try again.')
        goTo(target)
        return
      }
      explain(caught, attempted)
    }
  }

  const field = (name: ProductField) => ({ id: FIELD_ID[name], error: errors.fields[name] !== undefined })
  const help = (name: ProductField, hint?: string) => errors.fields[name] ?? hint
  const canSubmit = !readOnly && !busy && (creating || dirty || (state?.unsubmitted ?? false))
  const live = state?.live ?? null
  const showLive = live !== null && !state?.archived
  const working = product?.working

  return (
    <Box
      sx={{
        display: 'grid',
        gap: 3,
        gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: showLive ? 'minmax(0, 3fr) minmax(0, 2fr)' : 'minmax(0, 1fr)' },
        alignItems: 'start',
      }}
    >
      <Box component="form" noValidate aria-label={creating ? 'New product' : 'Product'} onSubmit={(event) => { event.preventDefault(); void onSave() }}>
        <Stack spacing={2.5}>
          {state?.archived ? (
            <Alert severity="info">
              <strong>This product is archived.</strong> It is not on sale and cannot be changed. Its SKU stays reserved.
            </Alert>
          ) : null}
          {showLive && !state?.inReview ? (
            <Alert severity="info">
              <strong>This product is live.</strong> Editing creates a new version. The live product does not change until it is approved.
            </Alert>
          ) : null}
          {state?.inReview && working ? (
            <Alert severity="info">
              <strong>Version {working.version} is in review</strong>
              {working.submitted_at ? ` since ${formatDate(working.submitted_at)}` : ''}. It cannot be changed until our team decides.
              {showLive ? ' The live product stays as it is meanwhile.' : ''}
            </Alert>
          ) : null}
          {state?.rejected ? (
            <Alert severity="warning">
              <strong>Version {state.rejected.version} was not approved.</strong>{' '}
              <Box component="span" sx={{ whiteSpace: 'pre-line' }}>
                {state.rejected.reason ?? 'No reason was given.'}
              </Box>{' '}
              Fix it and submit again.{showLive ? ' The live product is unchanged.' : ''}
            </Alert>
          ) : null}
          {formError ? (
            <Alert severity="error" role="alert">
              {formError}
            </Alert>
          ) : null}

          <Box component="fieldset" disabled={readOnly || busy} sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}>
            <Stack spacing={2.5}>
              <Typography component="h2" variant="h6">
                Details
              </Typography>
              <TextField
                {...field('sku')}
                label="Product SKU"
                required={creating}
                value={values.sku}
                onChange={(event) => change('sku', event.target.value, 'sku')}
                helperText={help('sku', creating ? 'Your own code for this product, for example KURTA-001. It cannot change later.' : 'The SKU cannot change.')}
                slotProps={{ htmlInput: { maxLength: LIMITS.sku, readOnly: !creating, spellCheck: false } }}
                fullWidth
              />
              <TextField
                {...field('title')}
                label="Title"
                required
                value={values.title}
                onChange={(event) => change('title', event.target.value, 'title')}
                helperText={help('title')}
                slotProps={{ htmlInput: { maxLength: LIMITS.title } }}
                fullWidth
              />
              <TextField
                {...field('description')}
                label="Description"
                multiline
                minRows={4}
                value={values.description}
                onChange={(event) => change('description', event.target.value, 'description')}
                helperText={help('description', `${values.description.length} of ${LIMITS.description} characters.`)}
                slotProps={{ htmlInput: { maxLength: LIMITS.description } }}
                fullWidth
              />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  {...field('category')}
                  label="Category"
                  required
                  value={values.category}
                  onChange={(event) => change('category', event.target.value, 'category')}
                  helperText={help('category', 'For example kurtas')}
                  slotProps={{ htmlInput: { maxLength: LIMITS.category } }}
                  fullWidth
                />
                <TextField
                  {...field('subcategory')}
                  label="Subcategory"
                  value={values.subcategory}
                  onChange={(event) => change('subcategory', event.target.value, 'subcategory')}
                  helperText={help('subcategory', 'For example straight kurtas')}
                  slotProps={{ htmlInput: { maxLength: LIMITS.subcategory } }}
                  fullWidth
                />
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  {...field('gender')}
                  select
                  label="For"
                  required
                  value={values.gender}
                  onChange={(event) => change('gender', event.target.value as ProductValues['gender'], 'gender')}
                  helperText={help('gender')}
                  fullWidth
                >
                  {GENDERS.map((gender) => (
                    <MenuItem key={gender.value} value={gender.value}>
                      {gender.label}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  {...field('fabric')}
                  label="Fabric"
                  value={values.fabric}
                  onChange={(event) => change('fabric', event.target.value, 'fabric')}
                  helperText={help('fabric', 'For example cotton')}
                  slotProps={{ htmlInput: { maxLength: LIMITS.fabric } }}
                  fullWidth
                />
                <TextField
                  {...field('weight')}
                  label="Weight"
                  value={values.weight}
                  onChange={(event) => change('weight', event.target.value, 'weight')}
                  helperText={help('weight', 'Packed, for shipping')}
                  slotProps={{ input: { endAdornment: <InputAdornment position="end">g</InputAdornment> }, htmlInput: { inputMode: 'numeric' } }}
                  fullWidth
                />
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'flex-start' } }}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={values.returnable}
                      onChange={(event) => {
                        const returnable = event.target.checked
                        // Not returnable: the window means nothing, so it is cleared (the API clears it too).
                        setValues((current) => ({ ...current, returnable, returnDays: returnable ? current.returnDays : '' }))
                        if (!returnable) setErrors((current) => ({ ...current, fields: { ...current.fields, returnDays: undefined } }))
                      }}
                    />
                  }
                  label="Shoppers can return it"
                  sx={{ minWidth: { sm: 240 } }}
                />
                <TextField
                  {...field('returnDays')}
                  label="Return window"
                  required={values.returnable}
                  disabled={!values.returnable}
                  value={values.returnDays}
                  onChange={(event) => change('returnDays', event.target.value, 'returnDays')}
                  helperText={help('returnDays', values.returnable ? `Days after delivery, from 0 to ${LIMITS.maxReturnDays}` : 'Only for a product that can be returned')}
                  slotProps={{ input: { endAdornment: <InputAdornment position="end">days</InputAdornment> }, htmlInput: { inputMode: 'numeric' } }}
                  fullWidth
                />
              </Stack>

              <VariantsEditor
                variants={values.variants}
                errors={errors.variants}
                listError={errors.fields.variants}
                onChange={(next) => {
                  setValues((current) => ({ ...current, variants: next }))
                  if (errors.fields.variants) setErrors((current) => ({ ...current, fields: { ...current.fields, variants: undefined } }))
                }}
                onFieldEdited={clearVariantError}
              />
            </Stack>
          </Box>

          <ImagesEditor
            images={values.images}
            errors={errors.images}
            listError={errors.fields.images}
            disabled={readOnly || busy}
            onChange={(next) => {
              setValues((current) => ({ ...current, images: next }))
              if (errors.fields.images) setErrors((current) => ({ ...current, fields: { ...current.fields, images: undefined } }))
            }}
            onAltEdited={clearImageError}
          />

          {readOnly ? null : (
            <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
              <Button type="submit" variant="contained" disabled={busy || (!creating && !dirty)}>
                {create.isPending || update.isPending ? 'Saving…' : creating ? 'Create product' : 'Save changes'}
              </Button>
              <Button variant="outlined" onClick={() => void onSubmit()} disabled={!canSubmit}>
                {submit.isPending ? 'Submitting…' : creating ? 'Create and submit for review' : 'Submit for review'}
              </Button>
              {dirty && !creating ? (
                <Typography variant="body2" color="text.secondary" role="status">
                  Unsaved changes
                </Typography>
              ) : null}
            </Stack>
          )}
          {!readOnly && !creating && !dirty && !state?.unsubmitted ? (
            <Typography variant="body2" color="text.secondary">
              {state?.rejected ? 'Change something, then submit it again.' : 'Make a change to submit a new version for review.'}
            </Typography>
          ) : null}
        </Stack>
      </Box>

      {showLive && live ? (
        <RevisionPanel revision={live} title="Live version" description={`Version ${live.version}. This is what shoppers see now.`} />
      ) : null}
    </Box>
  )
}

/** Only the "what a submission needs" problems, for a `422 product_incomplete` from the server. */
function validateMissing(values: ProductValues): ProductErrors {
  const missing = missingForSubmit(values)
  return {
    fields: {
      ...(missing.variant ? { variants: 'Add at least one active variant before you submit.' } : {}),
      ...(missing.image ? { images: 'Add at least one image before you submit.' } : {}),
    },
    variants: {},
    images: {},
  }
}
