import { Box, InputAdornment, Link, Stack, Typography } from '@mui/material'
import { link as linkColour } from '@shazlo/ui'
import { CircleCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import { ApiError } from '../../../api/errors'
import type { Schemas } from '../../../api/model'
import { useIfsc } from '../../../api/queries'
import { catalogCopy } from '../../../copy/catalog'
import { storeCopy as copy } from '../../../copy/store'
import { DELIVERY_DAYS, DELIVERY_MODES, PAYOUT_METHODS, REFUND_DAYS, RETURN_CONDITIONS, RETURN_WINDOWS, type FieldErrors } from '../../../lib/storeDetails'
import { CheckGroup, CheckOption, ChoiceGroup, FieldGroup, keyboards, PlacesField, TextInput, type Option } from './controls'
import {
  fieldId,
  type BrandAnswers,
  type BusinessAnswers,
  type CommissionChoice,
  type ContactAnswers,
  type DeliveryAnswers,
  type PaymentAnswers,
  type PayoutAnswers,
  type ReturnsAnswers,
  type SignupBusinessAnswers,
  type TermsAnswers,
  type Topic,
  type TopicAnswers,
} from './model'

// The fields of each store-details topic (spec §5). Sign-up (V-02) shows them one topic per page
// with Continue; Store details (/store/details/:section) shows one with Save. The page owns the
// answers and the checks; these only draw them.

export type FieldsProps<A> = { values: A; onChange: (next: A) => void; errors: FieldErrors }

const stack = { spacing: 3 } as const

// ---- Your brand -------------------------------------------------------------------------------

const SELLS: Option<Schemas['Sells']>[] = (['women', 'men', 'both'] as const).map((value) => ({ value, label: catalogCopy.sells[value] }))

// `storeName`: 'edit' in sign-up; on Store details the name is read-only (Shazlo changes it on request).
export function BrandFields({ values, onChange, errors, storeName }: FieldsProps<BrandAnswers> & { storeName: 'edit' | 'show' }) {
  const set = (patch: Partial<BrandAnswers>) => onChange({ ...values, ...patch })
  const b = copy.brand
  return (
    <Stack {...stack}>
      {storeName === 'edit' ? (
        <TextInput path="brand_name" label={b.storeName} value={values.brand_name} onChange={(brand_name) => set({ brand_name })} error={errors.brand_name} hint={b.storeNameHint} autoComplete="organization" />
      ) : (
        <Box>
          <Typography variant="body2" color="textSecondary">
            {b.storeName}
          </Typography>
          <Typography variant="body1" sx={{ mt: 0.25, overflowWrap: 'anywhere' }}>
            {values.brand_name}
          </Typography>
          <Link href={`mailto:${copy.partnersEmail}`} variant="body2" sx={{ display: 'inline-flex', alignItems: 'center', minHeight: 44 }}>
            {b.storeNameFixed}
          </Link>
        </Box>
      )}
      <ChoiceGroup path="sells" legend={b.sells} value={values.sells} options={SELLS} onChange={(sells) => set({ sells })} error={errors.sells} row />
      <TextInput path="city" label={b.city} value={values.city} onChange={(city) => set({ city })} error={errors.city} hint={b.cityHint} autoComplete="address-level2" />
      <TextInput
        path="instagram_or_website"
        label={b.link}
        value={values.instagram_or_website}
        onChange={(instagram_or_website) => set({ instagram_or_website })}
        error={errors.instagram_or_website}
        hint={b.linkHint}
        autoComplete="url"
        attrs={keyboards.plain}
      />
    </Stack>
  )
}

// ---- Contact ----------------------------------------------------------------------------------

export function ContactFields({ values, onChange, errors }: FieldsProps<ContactAnswers>) {
  const set = (patch: Partial<ContactAnswers>) => onChange({ ...values, ...patch })
  const c = copy.contact
  return (
    <Stack {...stack}>
      <TextInput path="name" label={c.name} value={values.name} onChange={(name) => set({ name })} error={errors.name} hint={c.nameHint} autoComplete="name" />
      <TextInput path="phone" label={c.phone} type="tel" value={values.phone} onChange={(phone) => set({ phone })} error={errors.phone} hint={c.phoneHint} autoComplete="tel" attrs={keyboards.tel} />
      <TextInput path="email" label={c.email} type="email" value={values.email} onChange={(email) => set({ email })} error={errors.email} hint={c.emailHint} autoComplete="email" attrs={keyboards.email} />
    </Stack>
  )
}

// ---- Delivery ---------------------------------------------------------------------------------

const MODES: Option<Schemas['Delivery']['mode']>[] = DELIVERY_MODES.map((value) => ({ value, ...catalogCopy.delivery.modes[value] }))
const AREAS: Option<'all' | 'chosen'>[] = [
  { value: 'all', label: catalogCopy.delivery.allIndia },
  { value: 'chosen', label: catalogCopy.delivery.places },
]
const DAYS: Option<Schemas['DeliveryDays']>[] = DELIVERY_DAYS.map((value) => ({ value, label: catalogCopy.delivery.days[value] }))

// Shazlo delivery asks for the pickup address; delivering yourself asks where and how fast.
export function DeliveryFields({ values, onChange, errors }: FieldsProps<DeliveryAnswers>) {
  const set = (patch: Partial<DeliveryAnswers>) => onChange({ ...values, ...patch })
  const setAddress = (patch: Partial<DeliveryAnswers['pickup_address']>) => set({ pickup_address: { ...values.pickup_address, ...patch } })
  const d = copy.delivery
  const a = values.pickup_address
  const chosen = values.areas.all_india === false
  // "Add a place" is about the place field once chosen places is picked; before that, the choice.
  const areasOnPlaces = chosen && Boolean(errors.areas)
  return (
    <Stack {...stack}>
      <ChoiceGroup path="mode" legend={d.mode} value={values.mode} options={MODES} onChange={(mode) => set({ mode })} error={errors.mode} />
      {values.mode === 'shazlo' && (
        <FieldGroup legend={d.pickup} hint={d.pickupHint}>
          <TextInput path="pickup_address.line1" label={d.line1} value={a.line1} onChange={(line1) => setAddress({ line1 })} error={errors['pickup_address.line1']} autoComplete="address-line1" />
          <TextInput path="pickup_address.area" label={d.area} value={a.area} onChange={(area) => setAddress({ area })} error={errors['pickup_address.area']} autoComplete="address-line2" />
          <TextInput path="pickup_address.city" label={d.city} value={a.city} onChange={(city) => setAddress({ city })} error={errors['pickup_address.city']} autoComplete="address-level2" />
          <Box sx={{ maxWidth: { sm: 240 } }}>
            <TextInput path="pickup_address.pin" label={d.pin} value={a.pin} onChange={(pin) => setAddress({ pin })} error={errors['pickup_address.pin']} autoComplete="postal-code" attrs={keyboards.numeric} />
          </Box>
        </FieldGroup>
      )}
      {values.mode === 'own' && (
        <>
          <Box>
            <ChoiceGroup
              path={areasOnPlaces ? 'areas-choice' : 'areas'}
              legend={d.areas}
              value={values.areas.all_india === null ? '' : values.areas.all_india ? 'all' : 'chosen'}
              options={AREAS}
              onChange={(v) => set({ areas: { ...values.areas, all_india: v === 'all' } })}
              error={areasOnPlaces ? undefined : errors.areas}
            />
            {chosen && (
              <Box sx={{ mt: 1.5, pl: { xs: 0, sm: 4 } }}>
                <PlacesField
                  path={areasOnPlaces ? 'areas' : 'areas.places'}
                  places={values.areas.places}
                  typed={values.place}
                  onChange={(places, place) => set({ areas: { ...values.areas, places }, place })}
                  error={errors['areas.places'] ?? (areasOnPlaces ? errors.areas : undefined)}
                />
              </Box>
            )}
          </Box>
          <ChoiceGroup path="delivery_days" legend={d.days} value={values.delivery_days} options={DAYS} onChange={(delivery_days) => set({ delivery_days })} error={errors.delivery_days} row />
        </>
      )}
    </Stack>
  )
}

// ---- Returns ----------------------------------------------------------------------------------

const WINDOWS: Option<Schemas['ReturnWindowDays']>[] = RETURN_WINDOWS.map((value) => ({ value, label: catalogCopy.returns.windows[value] }))
const CONDITIONS: Option<Schemas['ReturnCondition']>[] = RETURN_CONDITIONS.map((value) => ({ value, label: catalogCopy.returns.conditions[value] }))
const REFUNDS: Option<Schemas['RefundDays']>[] = REFUND_DAYS.map((value) => ({ value, label: catalogCopy.returns.refunds[value] }))

// "No returns" hides the conditions and the refund time.
export function ReturnsFields({ values, onChange, errors }: FieldsProps<ReturnsAnswers>) {
  const set = (patch: Partial<ReturnsAnswers>) => onChange({ ...values, ...patch })
  const r = copy.returns
  const takesReturns = values.window_days !== null && values.window_days !== 0
  return (
    <Stack {...stack}>
      <ChoiceGroup path="window_days" legend={r.window} value={values.window_days} options={WINDOWS} onChange={(window_days) => set({ window_days })} error={errors.window_days} row />
      {takesReturns && (
        <>
          <ChoiceGroup path="condition" legend={r.condition} value={values.condition} options={CONDITIONS} onChange={(condition) => set({ condition })} error={errors.condition} />
          <ChoiceGroup path="refund_days" legend={r.refund} value={values.refund_days} options={REFUNDS} onChange={(refund_days) => set({ refund_days })} error={errors.refund_days} />
        </>
      )}
    </Stack>
  )
}

// ---- Payment on delivery ------------------------------------------------------------------------

export function PaymentFields({ values, onChange, errors }: FieldsProps<PaymentAnswers>) {
  const p = catalogCopy.payOnDelivery
  return (
    <CheckGroup legend={copy.payment.legend} hint={copy.payment.hint} error={errors.pay_on_delivery}>
      <CheckOption id={fieldId('pay_on_delivery')} label={p.cash} checked={values.cash} onChange={(cash) => onChange({ ...values, cash })} />
      <CheckOption label={p.upi} checked={values.upi} onChange={(upi) => onChange({ ...values, upi })} />
    </CheckGroup>
  )
}

// ---- Payouts ------------------------------------------------------------------------------------

const METHODS: Option<Schemas['PayoutInput']['method']>[] = PAYOUT_METHODS.map((value) => ({ value, label: catalogCopy.payoutMethods[value] }))

// The bank and branch for a well-formed IFSC, as a check that the code is right. A bank vendor-api
// does not list yet is pointed out (a typo shows up here) without stopping the seller: vendor-api
// takes a payout to any well-formed IFSC.
function IfscBank({ ifsc }: { ifsc: string }) {
  const lookup = useIfsc(ifsc)
  const notListed = lookup.error instanceof ApiError && lookup.error.code === 'ifsc_unknown'
  return (
    <Box role="status" sx={{ minHeight: 0 }}>
      {lookup.data && (
        <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 1, color: linkColour.text }}>
          <CircleCheck size={16} strokeWidth={1.75} aria-hidden="true" />
          {lookup.data.branch ? copy.payout.ifscFound(lookup.data.bank, lookup.data.branch) : lookup.data.bank}
        </Typography>
      )}
      {notListed && (
        <Typography variant="body2" sx={{ mt: 1, color: 'text.secondary' }}>
          {copy.payout.ifscNotListed}
        </Typography>
      )}
    </Box>
  )
}

// Bank account (holder, number twice, IFSC) or UPI ID. `accountNote` explains, in sign-up, that the
// account number is not kept on the device.
export function PayoutFields({ values, onChange, errors, accountNote }: FieldsProps<PayoutAnswers> & { accountNote?: ReactNode }) {
  const set = (patch: Partial<PayoutAnswers>) => onChange({ ...values, ...patch })
  const p = copy.payout
  return (
    <Stack {...stack}>
      <ChoiceGroup path="method" legend={p.method} value={values.method} options={METHODS} onChange={(method) => set({ method })} error={errors.method} row />
      {values.method === 'bank' && (
        <>
          <TextInput path="holder_name" label={p.holder} value={values.holder_name} onChange={(holder_name) => set({ holder_name })} error={errors.holder_name} hint={p.holderHint} autoComplete="name" />
          <TextInput path="account_number" label={p.account} value={values.account_number} onChange={(account_number) => set({ account_number })} error={errors.account_number} hint={accountNote} autoComplete="off" attrs={keyboards.numeric} />
          <TextInput
            path="account_number_again"
            label={p.accountAgain}
            value={values.account_number_again}
            onChange={(account_number_again) => set({ account_number_again })}
            error={errors.account_number_again}
            hint={p.accountAgainHint}
            autoComplete="off"
            attrs={keyboards.numeric}
          />
          <Box>
            <TextInput path="ifsc" label={p.ifsc} value={values.ifsc} onChange={(ifsc) => set({ ifsc })} error={errors.ifsc} hint={p.ifscHint} autoComplete="off" attrs={keyboards.ifsc} />
            <IfscBank ifsc={values.ifsc} />
          </Box>
        </>
      )}
      {values.method === 'upi' && (
        <TextInput path="upi_id" label={p.upi} value={values.upi_id} onChange={(upi_id) => set({ upi_id })} error={errors.upi_id} hint={p.upiHint} autoComplete="off" attrs={keyboards.upi} />
      )}
    </Stack>
  )
}

// ---- Business details ---------------------------------------------------------------------------

export function BusinessFields({ values, onChange, errors }: FieldsProps<BusinessAnswers>) {
  const set = (patch: Partial<BusinessAnswers>) => onChange({ ...values, ...patch })
  const b = copy.business
  return (
    <Stack {...stack}>
      <TextInput path="legal_name" label={b.legalName} value={values.legal_name} onChange={(legal_name) => set({ legal_name })} error={errors.legal_name} hint={b.legalNameHint} autoComplete="organization" />
      <TextInput path="gstin" label={b.gstin} value={values.gstin} onChange={(gstin) => set({ gstin })} error={errors.gstin} hint={b.gstinHint} autoComplete="off" attrs={keyboards.code} />
    </Stack>
  )
}

// Sign-up asks every business answer: the legal name, whether the business is registered for GST
// (a seller below the threshold says so), and the number when it is.
type Registered = 'yes' | 'no'

export function SignupBusinessFields({ values, onChange, errors }: FieldsProps<SignupBusinessAnswers>) {
  const set = (patch: Partial<SignupBusinessAnswers>) => onChange({ ...values, ...patch })
  const b = copy.signupBusiness
  const registered: Option<Registered>[] = [
    { value: 'yes', label: b.gstYes },
    { value: 'no', label: b.gstNo, hint: b.gstNoHint },
  ]
  return (
    <Stack {...stack}>
      <TextInput path="legal_name" label={b.legalName} value={values.legal_name} onChange={(legal_name) => set({ legal_name })} error={errors.legal_name} hint={b.legalNameHint} autoComplete="organization" />
      <ChoiceGroup
        path="gst_registered"
        legend={b.gst}
        value={values.gst_registered === null ? '' : values.gst_registered ? 'yes' : 'no'}
        options={registered}
        onChange={(v) => set({ gst_registered: v === 'yes' })}
        error={errors.gst_registered}
      />
      {values.gst_registered === true && (
        <Box sx={{ maxWidth: { sm: 360 } }}>
          <TextInput path="gstin" label={b.gstin} value={values.gstin} onChange={(gstin) => set({ gstin })} error={errors.gstin} hint={b.gstinHint} autoComplete="off" attrs={keyboards.code} />
        </Box>
      )}
    </Stack>
  )
}

// ---- Commission and agreements (sign-up only) ----------------------------------------------------

export function TermsFields({ values, onChange, errors }: FieldsProps<TermsAnswers>) {
  const set = (patch: Partial<TermsAnswers>) => onChange({ ...values, ...patch })
  const t = copy.terms
  const choices: Option<CommissionChoice>[] = [
    { value: 'propose', label: t.propose },
    { value: 'team', label: t.team, hint: t.teamHint },
  ]
  return (
    <Stack {...stack}>
      <ChoiceGroup path="commission_choice" legend={t.commission} value={values.commission_choice} options={choices} onChange={(commission_choice) => set({ commission_choice })} error={errors.commission_choice} />
      {values.commission_choice === 'propose' && (
        <Box sx={{ maxWidth: { sm: 360 } }}>
          <TextInput
            path="commission"
            label={t.rate}
            value={values.commission}
            onChange={(commission) => set({ commission })}
            error={errors.commission}
            hint={t.rateHint}
            autoComplete="off"
            attrs={keyboards.decimal}
            end={<InputAdornment position="end">%</InputAdornment>}
          />
        </Box>
      )}
      <CheckGroup legend={t.agreements}>
        <CheckOption
          id={fieldId('agreed_terms')}
          checked={values.agreed_terms}
          onChange={(agreed_terms) => set({ agreed_terms })}
          error={errors.agreed_terms}
          label={
            <>
              {t.sellerTerms}{' '}
              <Link href={t.sellerTermsHref} target="_blank" rel="noreferrer">
                {t.sellerTermsLink}
              </Link>
            </>
          }
        />
        <CheckOption id={fieldId('agreed_price_rule')} checked={values.agreed_price_rule} onChange={(agreed_price_rule) => set({ agreed_price_rule })} error={errors.agreed_price_rule} label={t.priceRule} />
      </CheckGroup>
    </Stack>
  )
}

// ---- any one topic -------------------------------------------------------------------------------

// The fields of one topic, for pages that are told which topic to show (Store details' edit page).
export function TopicFields<T extends Topic>({
  topic,
  values,
  onChange,
  errors,
  storeName = 'show',
  accountNote,
}: {
  topic: T
  values: TopicAnswers[T]
  onChange: (next: TopicAnswers[T]) => void
  errors: FieldErrors
  storeName?: 'edit' | 'show'
  accountNote?: ReactNode
}) {
  const props = { errors, onChange: onChange as (next: unknown) => void }
  switch (topic) {
    case 'brand': return <BrandFields {...props} values={values as BrandAnswers} storeName={storeName} />
    case 'contact': return <ContactFields {...props} values={values as ContactAnswers} />
    case 'delivery': return <DeliveryFields {...props} values={values as DeliveryAnswers} />
    case 'returns': return <ReturnsFields {...props} values={values as ReturnsAnswers} />
    case 'payment': return <PaymentFields {...props} values={values as PaymentAnswers} />
    case 'payout': return <PayoutFields {...props} values={values as PayoutAnswers} accountNote={accountNote} />
    case 'business': return <BusinessFields {...props} values={values as BusinessAnswers} />
  }
  return null
}
