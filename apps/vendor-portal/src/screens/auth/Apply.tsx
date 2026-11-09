import { styled } from '@mui/material/styles'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button, Checkbox, Icon, kit, Row, Rule, Select, Stack, Text, TextArea, TextInput, TextLink, textStyle } from '@shazlo/ui/components'
import { api, ApiError, type ApplicationInput } from '../../api'
import { rupees } from '../../lib/format'
import { AuthLayout, PARTNERS_EMAIL } from './AuthLayout'
import { PRICE_MAX, PriceRange, ProductTypePicker } from './applyFields'
import { AuthCard, Chip, errorMessage, focusField, FormAlert, isEmail } from './parts'

// Penpot V-02 · Apply to sell. Notes: fields from flow V1; duplicate email or phone is caught
// inline (never a second application); submitting shows a confirmation state ("We’ll reply
// within 2 working days") and sends a receipt email; commercial terms are shown before submit.

export const cities = ['Ahmedabad', 'Mumbai', 'Delhi NCR', 'Bengaluru', 'Jaipur', 'Kolkata', 'Hyderabad', 'Chennai', 'Pune', 'Surat', 'Vadodara', 'Lucknow', 'Other']

interface FormState {
  brandName: string
  city: string
  instagram: string
  productTypes: string[]
  low: number
  high: number
  ownerName: string
  phone: string
  email: string
  about: string
  /** Not part of ApplicationInput: the API records consent by accepting the submission. */
  agreed: boolean
}

type FieldKey = 'brandName' | 'city' | 'instagram' | 'productTypes' | 'ownerName' | 'phone' | 'email' | 'agreed'
type Errors = Partial<Record<FieldKey, string>>

/** Visual order, so focus lands on the first problem on the page. */
const fieldOrder: Array<[FieldKey, string]> = [
  ['brandName', 'apply-brand'],
  ['city', 'apply-city'],
  ['instagram', 'apply-instagram'],
  ['productTypes', 'apply-types'],
  ['ownerName', 'apply-owner'],
  ['phone', 'apply-phone'],
  ['email', 'apply-email'],
  ['agreed', 'apply-agree'],
]

const empty: FormState = {
  brandName: '', city: '', instagram: '', productTypes: [], low: 1200, high: 4500, ownerName: '', phone: '', email: '', about: '', agreed: false,
}

const phoneDigits = (s: string) => s.replace(/[\s()-]/g, '')
const isIndianMobile = (s: string) => /^(\+?91)?0?[6-9]\d{9}$/.test(phoneDigits(s))

function validate(f: FormState): Errors {
  const e: Errors = {}
  if (!f.brandName.trim()) e.brandName = 'Enter your brand name.'
  if (!f.city) e.city = 'Choose the city you ship from.'
  if (!f.instagram.trim()) e.instagram = 'Add your Instagram handle or website so we can see your work.'
  if (!f.productTypes.length) e.productTypes = 'Choose at least one thing you sell.'
  if (!f.ownerName.trim()) e.ownerName = 'Enter the owner’s full name.'
  if (!f.phone.trim()) e.phone = 'Enter a WhatsApp number we can reach you on.'
  else if (!isIndianMobile(f.phone)) e.phone = 'Enter a 10-digit Indian mobile number, like 98250 41376.'
  if (!f.email.trim()) e.email = 'Enter your email address.'
  else if (!isEmail(f.email)) e.email = 'Enter an email address, like you@yourlabel.in.'
  if (!f.agreed) e.agreed = 'Agree to the seller terms to send your application.'
  return e
}

function toInput(f: FormState): ApplicationInput {
  return {
    brandName: f.brandName.trim(),
    ownerName: f.ownerName.trim(),
    phone: phoneDigits(f.phone),
    email: f.email.trim(),
    city: f.city,
    instagram: f.instagram.trim(),
    productTypes: f.productTypes,
    priceRange: `${rupees(f.low)}–${rupees(f.high)}${f.high >= PRICE_MAX ? '+' : ''}`,
    about: f.about.trim(),
  }
}

/* ---------- layout ---------- */

const Body = styled('div')({
  display: 'flex',
  alignItems: 'flex-start',
  gap: 64,
  padding: '16px 120px 40px',
  '@media (max-width: 1279.95px)': { gap: 40, padding: '16px 40px 40px' },
  '@media (max-width: 1023.95px)': { flexDirection: 'column', alignItems: 'stretch', gap: 32, padding: '16px 24px 32px' },
  '@media (max-width: 600px)': { padding: '8px 16px 24px', gap: 24 },
})

const Pair = styled('div')({
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 16,
  alignItems: 'start',
  '@media (max-width: 640px)': { gridTemplateColumns: 'minmax(0, 1fr)' },
})

/** Shows the "Choose a city" prompt in the caption colour until a city is picked. */
const EmptyAware = styled('div')({
  minWidth: 0,
  '&[data-empty="true"] select': { color: kit.subtle },
  '& option': { color: kit.ink },
})

const Aside = styled('aside')({
  width: 360,
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 24,
  '@media (max-width: 1023.95px)': { width: 'auto' },
})

const Submit = styled('div')({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  flexWrap: 'wrap',
  '@media (max-width: 600px)': { '& > button': { width: '100%', minHeight: 44 } },
})

export function Apply() {
  const [form, setForm] = useState<FormState>(empty)
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState<{ reference: string; email: string; brandName: string } | null>(null)

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm(f => ({ ...f, [key]: value }))
    // Clear a field's error as soon as it is edited.
    if (key in errors) setErrors(e => ({ ...e, [key]: undefined }))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (pending) return
    const found = validate(form)
    setErrors(found)
    setFormError(null)
    const first = fieldOrder.find(([k]) => found[k])
    if (first) return focusField(first[1])

    setPending(true)
    try {
      const input = toInput(form)
      const { reference } = await api.apply(input)
      setDone({ reference, email: input.email, brandName: input.brandName })
    } catch (err) {
      setPending(false)
      const field = err instanceof ApiError ? fieldOrder.find(([k]) => k === err.field) : undefined
      if (field && err instanceof ApiError) {
        setErrors({ [field[0]]: err.message })
        focusField(field[1])
      } else {
        setFormError(errorMessage(err))
      }
    }
  }

  return (
    <AuthLayout
      footer={false}
      center={false}
      aside={(
        <Row gap={4}>
          <Text v="small" tone="muted">Already approved?</Text>
          <TextLink to="/sign-in" underline>Sign in</TextLink>
        </Row>
      )}
    >
      <Body>
        <AuthCard gap={28} style={{ flex: '1 1 auto', maxWidth: 'none' }}>
          {done ? <Submitted {...done} /> : (
            <>
              <Stack gap={8}>
                <Text v="overline" tone="subtle">About 4 minutes</Text>
                <Text v="display" as="h1">Apply to sell on Shazlo</Text>
                <Text v="small" tone="muted" as="p">Tell us about your label. Our team reviews every application within 2 working days.</Text>
              </Stack>
              <form onSubmit={submit} noValidate aria-label="Seller application" style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
                {formError && <FormAlert title="Your application wasn’t sent">{formError}</FormAlert>}
                <Stack as="section" aria-labelledby="apply-brand-heading" gap={16}>
                  <Text v="title" as="h2" id="apply-brand-heading">Your brand</Text>
                  <Pair>
                    <TextInput id="apply-brand" label="Brand name" autoComplete="organization" value={form.brandName} onChange={e => set('brandName', e.target.value)} error={errors.brandName} />
                    <EmptyAware data-empty={!form.city}>
                      <Select
                        id="apply-city"
                        label="City"
                        value={form.city}
                        onChange={e => set('city', e.target.value)}
                        error={errors.city}
                        options={[{ value: '', label: 'Choose a city' }, ...cities]}
                      />
                    </EmptyAware>
                  </Pair>
                  <Pair>
                    <TextInput id="apply-instagram" label="Instagram or website" autoComplete="url" spellCheck={false} value={form.instagram} onChange={e => set('instagram', e.target.value)} error={errors.instagram} />
                    <ProductTypePicker id="apply-types" value={form.productTypes} onChange={v => set('productTypes', v)} error={errors.productTypes} />
                  </Pair>
                  <PriceRange low={form.low} high={form.high} onChange={(low, high) => setForm(f => ({ ...f, low, high }))} />
                </Stack>
                <Stack as="section" aria-labelledby="apply-contact-heading" gap={16}>
                  <Text v="title" as="h2" id="apply-contact-heading">Contact</Text>
                  <Pair>
                    <TextInput id="apply-owner" label="Owner name" autoComplete="name" value={form.ownerName} onChange={e => set('ownerName', e.target.value)} error={errors.ownerName} />
                    <TextInput
                      id="apply-phone"
                      label="Phone (WhatsApp)"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      value={form.phone}
                      onChange={e => set('phone', e.target.value)}
                      helper="We use this for order and pickup updates."
                      error={errors.phone}
                    />
                  </Pair>
                  <TextInput id="apply-email" label="Email" type="email" inputMode="email" autoComplete="email" spellCheck={false} value={form.email} onChange={e => set('email', e.target.value)} error={errors.email} />
                  <TextArea id="apply-about" label="About your label (optional)" rows={3} value={form.about} onChange={e => set('about', e.target.value)} />
                </Stack>
                <Stack gap={6}>
                  <Submit>
                    <Checkbox
                      id="apply-agree"
                      label="I agree to the seller terms and a 15% commission per sale"
                      checked={form.agreed}
                      onChange={e => set('agreed', e.target.checked)}
                      aria-invalid={errors.agreed ? true : undefined}
                      aria-describedby={errors.agreed ? 'apply-agree-error' : undefined}
                      style={{ alignItems: 'flex-start' }}
                    />
                    <Button type="submit" variant="primary" icon="arrowRight" disabled={pending}>{pending ? 'Sending…' : 'Submit application'}</Button>
                  </Submit>
                  {errors.agreed && (
                    <Text v="caption" tone="error" id="apply-agree-error" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Icon name="alert" size={12} strokeWidth={1.75} />{errors.agreed}
                    </Text>
                  )}
                </Stack>
              </form>
            </>
          )}
        </AuthCard>
        <HowItWorks submitted={Boolean(done)} />
      </Body>
    </AuthLayout>
  )
}

/* ---------- success ---------- */

function Submitted({ reference, email, brandName }: { reference: string; email: string; brandName: string }) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [])
  const next: Array<{ icon: 'clock' | 'mail' | 'package'; text: string }> = [
    { icon: 'clock', text: 'Our team looks at your label, photos and prices, and replies within 2 working days.' },
    { icon: 'mail', text: `If ${brandName} is approved, we email ${email} an invite to set your password.` },
    { icon: 'package', text: 'Then you add your products. Each one is reviewed before it goes live.' },
  ]
  return (
    <Stack gap={24} role="status">
      <Chip>Application received</Chip>
      <Stack gap={8}>
        <Text v="display" as="h1" ref={heading} tabIndex={-1} style={{ outline: 'none' }}>We’ll reply within 2 working days</Text>
        <Text v="small" tone="muted" as="p">
          Thanks for applying, {brandName}. We’ve sent a receipt to {email}. Your reference is <Text v="mono" tone="ink">{reference}</Text>.
        </Text>
      </Stack>
      <Rule />
      <Stack gap={14}>
        <Text v="overline" tone="subtle" as="h2">What happens next</Text>
        {next.map(n => (
          <Row key={n.icon} gap={12} align="flex-start">
            <Icon name={n.icon} size={16} color={kit.muted} style={{ marginTop: 1 }} />
            <Text v="small" as="p">{n.text}</Text>
          </Row>
        ))}
      </Stack>
      <Row gap={4} wrap>
        <Text v="small" tone="muted">Questions meanwhile?</Text>
        <a href={`mailto:${PARTNERS_EMAIL}`} className="shz-link" style={{ ...textStyle.label, color: kit.link, textDecoration: 'underline', textUnderlineOffset: 2 }}>{PARTNERS_EMAIL}</a>
      </Row>
    </Stack>
  )
}

/* ---------- right column ---------- */

const steps = [
  { title: 'Apply', body: 'Takes about 4 minutes. No listing fee.' },
  { title: 'Review', body: 'We check your label and reply within 2 working days.' },
  { title: 'Get your login', body: 'Approved sellers get an invite email to set a password.' },
  { title: 'List products', body: 'Add photos, sizes and stock. Each product is reviewed before it goes live.' },
]

const terms = [
  ['Commission', '15% per delivered order'],
  ['Listing fee', 'None'],
  ['Payouts', 'Monthly statement'],
  ['Launch city', 'Ahmedabad'],
] as const

function HowItWorks({ submitted }: { submitted: boolean }) {
  return (
    <Aside aria-labelledby="apply-how-heading">
      <Text v="heading" as="h2" id="apply-how-heading">How selling on Shazlo works</Text>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 24 }}>
        {steps.map((s, i) => {
          const done = submitted && i === 0
          return (
            <li key={s.title} style={{ display: 'flex', gap: 14 }}>
              <span
                aria-hidden
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 999,
                  border: `1px solid ${done ? kit.brown : kit.ink}`,
                  background: done ? kit.brown : 'transparent',
                  color: done ? kit.offWhite : kit.ink,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {done ? <Icon name="check" size={14} /> : <Text v="label" style={{ color: 'inherit' }}>{i + 1}</Text>}
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <Text v="button">{s.title}{done && <span className="shz-visually-hidden"> (done)</span>}</Text>
                <Text v="small" tone="muted">{s.body}</Text>
              </span>
            </li>
          )
        })}
      </ol>
      <dl style={{ margin: 0, background: kit.chip, borderRadius: 8, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {terms.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <Text v="small" tone="muted" as="dt">{k}</Text>
            <Text v="label" as="dd" style={{ margin: 0, textAlign: 'right' }}>{v}</Text>
          </div>
        ))}
      </dl>
    </Aside>
  )
}
