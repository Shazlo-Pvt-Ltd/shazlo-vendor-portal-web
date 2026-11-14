import { Alert, Box, Button, Checkbox, FormControl, FormControlLabel, FormHelperText, InputAdornment, Link as MuiLink, Stack, TextField, Typography } from '@mui/material'
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link } from 'react-router'
import { api } from '../../api'
import { ApiError } from '../../api/errors'
import { PRIVACY_URL, TERMS_URL } from '../../config/links'
import { usePageTitle } from '../../hooks/usePageTitle'
import { PasswordField } from '../../security/PasswordField'
import { SafeLink } from '../../security/SafeLink'
import { registerSensitiveReset } from '../../security/sensitiveState'
import { friendlyError } from '../errors'
import { ResendVerification } from './ResendVerification'
import {
  EMPTY_SIGNUP,
  LIMITS,
  PASSWORD_MIN_LENGTH,
  SIGNUP_FIELD_ORDER,
  serverErrorsToFields,
  toSignupRequest,
  validateSignup,
  type SignupErrors,
  type SignupField,
  type SignupValues,
} from './rules'
import { useCountdown } from './useCountdown'

const FIELD_ID: Record<SignupField, string> = {
  brandName: 'signup-brand-name',
  contactName: 'signup-contact-name',
  email: 'signup-email',
  phone: 'signup-phone',
  productType: 'signup-product-type',
  websiteOrInstagram: 'signup-website',
  priceMin: 'signup-price-min',
  priceMax: 'signup-price-max',
  password: 'signup-password',
  termsAccepted: 'signup-terms',
}

/**
 * The vendor signup form. The server always answers `202`, so the confirmation never says whether
 * the address was already registered.
 */
export function SignupPage() {
  usePageTitle('Create your vendor account')
  const [values, setValues] = useState<SignupValues>(EMPTY_SIGNUP)
  const [errors, setErrors] = useState<SignupErrors>({})
  const [formError, setFormError] = useState<string | undefined>()
  const [submittedEmail, setSubmittedEmail] = useState<string | undefined>()
  const [focusRequest, setFocusRequest] = useState(0)
  const countdown = useCountdown()
  const signup = api.useMutation('post', '/v1/auth/signup')
  const heading = useRef<HTMLHeadingElement>(null)

  // A typed password must not outlive the session or the screen.
  useEffect(() => registerSensitiveReset(() => setValues(EMPTY_SIGNUP)), [])

  // Move focus to the first field with a problem, in page order, after an attempt to submit.
  useEffect(() => {
    if (focusRequest === 0) return
    const first = SIGNUP_FIELD_ORDER.find((field) => errors[field])
    if (first) document.getElementById(FIELD_ID[first])?.focus()
  }, [focusRequest])

  useEffect(() => {
    if (submittedEmail !== undefined) heading.current?.focus()
  }, [submittedEmail])

  function change<K extends SignupField>(field: K, value: SignupValues[K]) {
    setValues((current) => ({ ...current, [field]: value }))
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }))
  }

  const text = (field: Exclude<SignupField, 'termsAccepted'>) => (event: ChangeEvent<HTMLInputElement>) =>
    change(field, event.target.value)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (signup.isPending || countdown.active) return
    setFormError(undefined)
    const problems = validateSignup(values)
    if (Object.keys(problems).length > 0) {
      setErrors(problems)
      setFocusRequest((n) => n + 1)
      return
    }
    setErrors({})
    try {
      await signup.mutateAsync({ body: toSignupRequest(values) })
      setSubmittedEmail(values.email.trim())
      setValues(EMPTY_SIGNUP)
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 422) {
        const { fields, form } = serverErrorsToFields(caught.fieldErrors, caught.code, caught.message)
        setErrors(fields)
        if (Object.keys(fields).length === 0) setFormError(form ?? caught.message)
        else setFormError(form)
        setFocusRequest((n) => n + 1)
        return
      }
      const friendly = friendlyError(caught)
      setFormError(friendly.message)
      if (friendly.retryAfter) countdown.start(friendly.retryAfter)
    }
  }

  if (submittedEmail !== undefined) {
    return (
      <Box component="main" sx={{ p: 2, maxWidth: 560, mx: 'auto', mt: { xs: 2, sm: 6 } }}>
        <Typography component="h1" variant="h4" gutterBottom tabIndex={-1} ref={heading}>
          Check your email
        </Typography>
        <Typography sx={{ mb: 2 }}>
          We've sent a message to <strong>{submittedEmail}</strong>. Open it and follow the link to verify your address,
          then sign in.
        </Typography>
        <Typography sx={{ mb: 2 }}>The message can take a few minutes. Look in your spam folder too.</Typography>
        <ResendVerification initialEmail={submittedEmail} />
        <Typography sx={{ mt: 3 }}>
          <MuiLink component={Link} to="/login">
            Go to sign in
          </MuiLink>
        </Typography>
      </Box>
    )
  }

  const busy = signup.isPending
  const throttled = countdown.active
  const field = (name: SignupField) => ({
    id: FIELD_ID[name],
    error: errors[name] !== undefined,
    helperText: errors[name],
  })

  return (
    <Box component="main" sx={{ p: 2, maxWidth: 560, mx: 'auto', mt: { xs: 1, sm: 4 }, minWidth: 0 }}>
      <Typography component="h1" variant="h4" gutterBottom>
        Create your vendor account
      </Typography>
      <Typography sx={{ mb: 2 }}>
        Tell us about your brand. We review every new vendor before anything goes live.
      </Typography>

      {formError ? (
        <Alert severity="error" role="alert" sx={{ mb: 2 }}>
          {formError}
        </Alert>
      ) : null}
      {throttled ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <span style={visuallyHidden}>Too many attempts. Try again in about {countdown.remaining} seconds.</span>
          <span aria-hidden="true">Too many attempts. Try again in {countdown.remaining} s.</span>
        </Alert>
      ) : null}

      <Box component="form" onSubmit={submit} noValidate aria-label="Create your vendor account">
        <Stack spacing={2}>
          <TextField {...field('brandName')} label="Brand name" name="brand_name" autoComplete="organization" required value={values.brandName} onChange={text('brandName')} slotProps={{ htmlInput: { maxLength: LIMITS.brandName } }} fullWidth />
          <TextField {...field('contactName')} label="Your name" name="contact_name" autoComplete="name" required value={values.contactName} onChange={text('contactName')} slotProps={{ htmlInput: { maxLength: LIMITS.contactName } }} fullWidth />
          <TextField {...field('email')} label="Email address" name="email" type="email" autoComplete="email" required value={values.email} onChange={text('email')} slotProps={{ htmlInput: { inputMode: 'email', maxLength: LIMITS.email } }} fullWidth />
          <TextField {...field('phone')} label="Phone number" name="phone" type="tel" autoComplete="tel" required value={values.phone} onChange={text('phone')} slotProps={{ htmlInput: { inputMode: 'tel', maxLength: 31 } }} fullWidth />
          <TextField
            {...field('productType')}
            label="What do you sell?"
            name="product_type"
            required
            value={values.productType}
            onChange={text('productType')}
            slotProps={{ htmlInput: { maxLength: LIMITS.productType } }}
            {...(errors.productType ? {} : { helperText: 'For example: kurtas, sarees, jewellery.' })}
            fullWidth
          />
          <TextField
            {...field('websiteOrInstagram')}
            label="Website or Instagram (optional)"
            name="website_or_instagram"
            autoComplete="url"
            value={values.websiteOrInstagram}
            onChange={text('websiteOrInstagram')}
            slotProps={{ htmlInput: { maxLength: LIMITS.websiteOrInstagram } }}
            fullWidth
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField {...field('priceMin')} label="Lowest price" name="price_min" required value={values.priceMin} onChange={text('priceMin')} slotProps={{ input: { startAdornment: <InputAdornment position="start">₹</InputAdornment> }, htmlInput: { inputMode: 'decimal' } }} fullWidth />
            <TextField {...field('priceMax')} label="Highest price" name="price_max" required value={values.priceMax} onChange={text('priceMax')} slotProps={{ input: { startAdornment: <InputAdornment position="start">₹</InputAdornment> }, htmlInput: { inputMode: 'decimal' } }} fullWidth />
          </Stack>
          <PasswordField
            id={FIELD_ID.password}
            purpose="new"
            label="Password"
            name="password"
            required
            value={values.password}
            onChange={text('password')}
            error={errors.password !== undefined}
            helperText={errors.password ?? `At least ${PASSWORD_MIN_LENGTH} characters.`}
            fullWidth
          />
          <FormControl error={errors.termsAccepted !== undefined}>
            <FormControlLabel
              control={
                <Checkbox
                  id={FIELD_ID.termsAccepted}
                  name="terms_accepted"
                  checked={values.termsAccepted}
                  onChange={(event) => change('termsAccepted', event.target.checked)}
                  slotProps={{ input: { 'aria-describedby': errors.termsAccepted ? 'signup-terms-error' : undefined } }}
                />
              }
              label={
                <span>
                  I accept the <SafeLink href={TERMS_URL}>terms</SafeLink> and have read the{' '}
                  <SafeLink href={PRIVACY_URL}>privacy policy</SafeLink>.
                </span>
              }
            />
            {errors.termsAccepted ? <FormHelperText id="signup-terms-error">{errors.termsAccepted}</FormHelperText> : null}
          </FormControl>
          <Button type="submit" variant="contained" size="large" disabled={busy || throttled}>
            {busy ? 'Creating your account…' : 'Create account'}
          </Button>
        </Stack>
      </Box>
      <Typography sx={{ mt: 3 }}>
        Already have an account?{' '}
        <MuiLink component={Link} to="/login">
          Sign in
        </MuiLink>
      </Typography>
    </Box>
  )
}

const visuallyHidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const
