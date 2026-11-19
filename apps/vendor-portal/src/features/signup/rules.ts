import { MAX_PAISE, rupeesToPaise } from './money'

/**
 * The signup rules, mirroring vendor-api's `SignupRequest` (see `rules.test.ts`, which compares the
 * limits and patterns with `openapi.json`). The server checks everything again; these only give
 * answers next to the field before anything is sent.
 */
export const LIMITS = {
  brandName: 200,
  contactName: 200,
  email: 320,
  productType: 100,
  websiteOrInstagram: 300,
  passwordMax: 128,
} as const

/** vendor-api's `password_min_length` setting (not in the OpenAPI file); the server has the last word. */
export const PASSWORD_MIN_LENGTH = 12

export const EMAIL_PATTERN =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/
export const PHONE_PATTERN = /^\+?[0-9][0-9 ()-]{5,29}[0-9]$/

export interface SignupValues {
  brandName: string
  contactName: string
  email: string
  phone: string
  productType: string
  websiteOrInstagram: string
  priceMin: string
  priceMax: string
  password: string
  termsAccepted: boolean
}

export type SignupField = keyof SignupValues

export const EMPTY_SIGNUP: SignupValues = {
  brandName: '',
  contactName: '',
  email: '',
  phone: '',
  productType: '',
  websiteOrInstagram: '',
  priceMin: '',
  priceMax: '',
  password: '',
  termsAccepted: false,
}

/** The order the fields appear in, which is the order focus moves to the first error. */
export const SIGNUP_FIELD_ORDER: SignupField[] = [
  'brandName',
  'contactName',
  'email',
  'phone',
  'productType',
  'websiteOrInstagram',
  'priceMin',
  'priceMax',
  'password',
  'termsAccepted',
]

export type SignupErrors = Partial<Record<SignupField, string>>

function requiredText(value: string, label: string, max: number): string | undefined {
  const text = value.trim()
  if (text === '') return `Enter ${label}.`
  if (text.length > max) return `Use at most ${max} characters.`
  return undefined
}

/** The problems with the form, by field. Empty when the form can be sent. */
export function validateSignup(values: SignupValues): SignupErrors {
  const errors: SignupErrors = {}
  const set = (field: SignupField, message: string | undefined) => {
    if (message) errors[field] = message
  }

  set('brandName', requiredText(values.brandName, 'your brand name', LIMITS.brandName))
  set('contactName', requiredText(values.contactName, 'your name', LIMITS.contactName))
  set('productType', requiredText(values.productType, 'what you sell', LIMITS.productType))

  const email = values.email.trim()
  if (email === '') set('email', 'Enter your email address.')
  else if (email.length > LIMITS.email || !EMAIL_PATTERN.test(email)) {
    set('email', 'Enter a valid email address, such as name@brand.com.')
  }

  const phone = values.phone.trim()
  if (phone === '') set('phone', 'Enter your phone number.')
  else if (!PHONE_PATTERN.test(phone)) {
    set('phone', 'Enter a valid phone number, such as +91 98765 43210. It must start with a digit or +.')
  }

  if (values.websiteOrInstagram.trim().length > LIMITS.websiteOrInstagram) {
    set('websiteOrInstagram', `Use at most ${LIMITS.websiteOrInstagram} characters.`)
  }

  const min = values.priceMin.trim() === '' ? undefined : rupeesToPaise(values.priceMin)
  const max = values.priceMax.trim() === '' ? undefined : rupeesToPaise(values.priceMax)
  const priceHelp = `Enter an amount in rupees, like 499 or 1,299.50 (at most ${(MAX_PAISE / 100).toLocaleString('en-IN')}).`
  if (values.priceMin.trim() === '') set('priceMin', 'Enter your lowest price.')
  else if (min === null) set('priceMin', priceHelp)
  if (values.priceMax.trim() === '') set('priceMax', 'Enter your highest price.')
  else if (max === null) set('priceMax', priceHelp)
  if (typeof min === 'number' && typeof max === 'number' && max < min) {
    set('priceMax', 'The highest price cannot be lower than the lowest price.')
  }

  const password = values.password
  if (password === '') set('password', 'Choose a password.')
  else if (password.length < PASSWORD_MIN_LENGTH) {
    set('password', `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  } else if (password.length > LIMITS.passwordMax) {
    set('password', `Use at most ${LIMITS.passwordMax} characters.`)
  } else if (password.trim().toLowerCase() === email.toLowerCase()) {
    set('password', 'The password cannot be your email address.')
  }

  if (!values.termsAccepted) set('termsAccepted', 'Accept the terms to create your account.')
  return errors
}

/**
 * The request body for a form that passed {@link validateSignup}. Text is trimmed as the API trims
 * it; the password is sent exactly as typed; prices are whole paise.
 */
export function toSignupRequest(values: SignupValues) {
  const priceMin = rupeesToPaise(values.priceMin)
  const priceMax = rupeesToPaise(values.priceMax)
  if (priceMin === null || priceMax === null) {
    throw new RangeError('toSignupRequest needs a validated form.')
  }
  const website = values.websiteOrInstagram.trim()
  return {
    brand_name: values.brandName.trim(),
    contact_name: values.contactName.trim(),
    email: values.email.trim(),
    phone: values.phone.trim(),
    product_type: values.productType.trim(),
    ...(website === '' ? {} : { website_or_instagram: website }),
    price_min_paise: priceMin,
    price_max_paise: priceMax,
    password: values.password,
    terms_accepted: values.termsAccepted,
  }
}

/**
 * Where a server answer belongs on the form: the API's `422` field paths use the API's names
 * (`brand_name`), and two rules arrive as their own error codes instead of a field path.
 */
const SERVER_FIELD: Record<string, SignupField> = {
  brand_name: 'brandName',
  contact_name: 'contactName',
  email: 'email',
  phone: 'phone',
  product_type: 'productType',
  website_or_instagram: 'websiteOrInstagram',
  price_min_paise: 'priceMin',
  price_max_paise: 'priceMax',
  password: 'password',
  terms_accepted: 'termsAccepted',
}

export function serverErrorsToFields(
  fieldErrors: Record<string, string>,
  code: string,
  message: string,
): { fields: SignupErrors; form: string | undefined } {
  const fields: SignupErrors = {}
  let form: string | undefined
  for (const [key, text] of Object.entries(fieldErrors)) {
    const field = SERVER_FIELD[key]
    if (field) fields[field] ??= text
    else form ??= text
  }
  if (code === 'weak_password') fields.password ??= message
  if (code === 'terms_not_accepted') fields.termsAccepted ??= message
  return { fields, form }
}
