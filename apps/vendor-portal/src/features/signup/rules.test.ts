// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  EMAIL_PATTERN,
  EMPTY_SIGNUP,
  LIMITS,
  PASSWORD_MIN_LENGTH,
  PHONE_PATTERN,
  SIGNUP_FIELD_ORDER,
  serverErrorsToFields,
  toSignupRequest,
  validateSignup,
  type SignupValues,
} from './rules'

const valid: SignupValues = {
  brandName: 'Kala Kurtas',
  contactName: 'Asha Rao',
  email: 'asha@kala.example',
  phone: '+91 98765 43210',
  productType: 'kurtas',
  websiteOrInstagram: '@kalakurtas',
  priceMin: '499',
  priceMax: '2,999.50',
  password: 'a-long-enough-password',
  termsAccepted: true,
}

describe('validateSignup', () => {
  it('accepts a complete form, with the optional field empty too', () => {
    expect(validateSignup(valid)).toEqual({})
    expect(validateSignup({ ...valid, websiteOrInstagram: '' })).toEqual({})
  })

  it('asks for every required field on an empty form', () => {
    const errors = validateSignup(EMPTY_SIGNUP)
    expect(Object.keys(errors).sort()).toEqual(
      ['brandName', 'contactName', 'email', 'phone', 'productType', 'priceMin', 'priceMax', 'password', 'termsAccepted'].sort(),
    )
    expect(errors.websiteOrInstagram).toBeUndefined()
  })

  it.each(['plainaddress', 'a@b', 'a b@c.com', '@c.com', 'ü@c.com', 'a@@c.com'])('refuses the email %j', (email) => {
    expect(validateSignup({ ...valid, email }).email).toBeTruthy()
  })

  it.each(['12345', 'abcdefghij', '++9198765432', '98765 4321x', '(022) 2345-6789'])('refuses the phone %j', (phone) => {
    expect(validateSignup({ ...valid, phone }).phone).toBeTruthy()
  })

  it.each(['9876543210', '+91 98765 43210', '022 2345-6789'])('accepts the phone %j', (phone) => {
    expect(validateSignup({ ...valid, phone }).phone).toBeUndefined()
  })

  it('requires the highest price to be at least the lowest', () => {
    expect(validateSignup({ ...valid, priceMin: '500', priceMax: '499.99' }).priceMax).toMatch(/cannot be lower/)
    expect(validateSignup({ ...valid, priceMin: '500', priceMax: '500' }).priceMax).toBeUndefined()
  })

  it('refuses prices that are not amounts', () => {
    expect(validateSignup({ ...valid, priceMin: '12.345' }).priceMin).toBeTruthy()
    expect(validateSignup({ ...valid, priceMax: 'free' }).priceMax).toBeTruthy()
  })

  it('applies the password policy: length, upper bound and not the email address', () => {
    expect(validateSignup({ ...valid, password: 'x'.repeat(PASSWORD_MIN_LENGTH - 1) }).password).toBeTruthy()
    expect(validateSignup({ ...valid, password: 'x'.repeat(PASSWORD_MIN_LENGTH) }).password).toBeUndefined()
    expect(validateSignup({ ...valid, password: 'x'.repeat(LIMITS.passwordMax + 1) }).password).toBeTruthy()
    expect(validateSignup({ ...valid, email: 'longenough@brand.example', password: ' LongEnough@Brand.example ' }).password).toMatch(
      /email/,
    )
  })

  it('does not trim the password but does count spaces', () => {
    expect(validateSignup({ ...valid, password: ' '.repeat(PASSWORD_MIN_LENGTH) }).password).toBeUndefined()
  })

  it('requires the terms to be accepted', () => {
    expect(validateSignup({ ...valid, termsAccepted: false }).termsAccepted).toBeTruthy()
  })

  it('refuses text over the API limits', () => {
    expect(validateSignup({ ...valid, brandName: 'x'.repeat(LIMITS.brandName + 1) }).brandName).toBeTruthy()
    expect(validateSignup({ ...valid, productType: 'x'.repeat(LIMITS.productType + 1) }).productType).toBeTruthy()
    expect(validateSignup({ ...valid, websiteOrInstagram: 'x'.repeat(LIMITS.websiteOrInstagram + 1) }).websiteOrInstagram).toBeTruthy()
  })

  it('treats whitespace-only text as empty', () => {
    expect(validateSignup({ ...valid, brandName: '   ' }).brandName).toBeTruthy()
  })

  it('lists every field in the order focus should move', () => {
    expect([...SIGNUP_FIELD_ORDER].sort()).toEqual(Object.keys(EMPTY_SIGNUP).sort())
  })
})

describe('toSignupRequest', () => {
  it('sends trimmed text, the password as typed, and prices as exact integer paise', () => {
    const body = toSignupRequest({ ...valid, brandName: '  Kala Kurtas ', password: ' spaced password ', priceMin: '99.90', priceMax: '1,000' })
    expect(body.brand_name).toBe('Kala Kurtas')
    expect(body.password).toBe(' spaced password ')
    expect(body.price_min_paise).toBe(9990)
    expect(body.price_max_paise).toBe(100000)
    expect(Number.isInteger(body.price_min_paise) && Number.isInteger(body.price_max_paise)).toBe(true)
    expect(JSON.stringify(body)).toContain('"price_min_paise":9990,')
  })

  it('leaves the optional field out when it is blank', () => {
    expect('website_or_instagram' in toSignupRequest({ ...valid, websiteOrInstagram: '  ' })).toBe(false)
    expect(toSignupRequest(valid).website_or_instagram).toBe('@kalakurtas')
  })

  it('refuses a form that was not validated', () => {
    expect(() => toSignupRequest({ ...valid, priceMin: 'abc' })).toThrow(RangeError)
  })
})

describe('serverErrorsToFields', () => {
  it('maps the API field names to the form fields', () => {
    const { fields, form } = serverErrorsToFields({ brand_name: 'bad', price_max_paise: 'too big', _form: 'price_max_paise must not be below price_min_paise' }, 'validation_error', 'x')
    expect(fields).toEqual({ brandName: 'bad', priceMax: 'too big' })
    expect(form).toBe('price_max_paise must not be below price_min_paise')
  })

  it('puts the weak-password and terms answers on their fields', () => {
    expect(serverErrorsToFields({}, 'weak_password', 'Password is too common').fields.password).toBe('Password is too common')
    expect(serverErrorsToFields({}, 'terms_not_accepted', 'Accept the terms').fields.termsAccepted).toBe('Accept the terms')
  })
})

describe('the rules match vendor-api', () => {
  const spec = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../../../../services/vendor-api/openapi.json', import.meta.url)), 'utf8'),
  ) as { components: { schemas: Record<string, { properties: Record<string, Record<string, unknown>> }> } }
  const signup = spec.components.schemas.SignupRequest!.properties
  const resend = spec.components.schemas.ResendRequest!.properties

  it('uses the API\'s email and phone patterns', () => {
    expect(EMAIL_PATTERN.source).toBe(signup.email!.pattern)
    expect(EMAIL_PATTERN.source).toBe(resend.email!.pattern)
    expect(PHONE_PATTERN.source).toBe(signup.phone!.pattern)
  })

  it('uses the API\'s length limits', () => {
    expect(LIMITS.brandName).toBe(signup.brand_name!.maxLength)
    expect(LIMITS.contactName).toBe(signup.contact_name!.maxLength)
    expect(LIMITS.email).toBe(signup.email!.maxLength)
    expect(LIMITS.productType).toBe(signup.product_type!.maxLength)
    expect(LIMITS.passwordMax).toBe(signup.password!.maxLength)
    const website = signup.website_or_instagram!.anyOf as Array<{ maxLength?: number }>
    expect(LIMITS.websiteOrInstagram).toBe(website.find((option) => option.maxLength)!.maxLength)
  })

  it('uses the API\'s price ceiling', async () => {
    const { MAX_PAISE } = await import('./money')
    expect(MAX_PAISE).toBe(signup.price_min_paise!.maximum)
    expect(MAX_PAISE).toBe(signup.price_max_paise!.maximum)
  })

  it('sends exactly the fields the API accepts', () => {
    expect(Object.keys(toSignupRequest(valid)).sort()).toEqual(Object.keys(signup).sort())
  })
})
