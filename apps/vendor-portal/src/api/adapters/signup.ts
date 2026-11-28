/**
 * Sign-up: Build 2's seven steps (`VendorApplication`) become vendor-api's `POST /v1/auth/signup`
 * with the store details (proposed). A 422's keys come back under the steps' names, so the screen
 * can send the seller to the step with the problem.
 */
import { remapFieldErrors } from '../errors'
import type { VendorApplication } from '../model'
import type { SignupBody } from '../wire'
import { storeFieldKey } from './storeDetails'
import { textOrNull } from './common'

export function signupBodyFromApplication(app: VendorApplication): SignupBody {
  return {
    brand_name: app.brand_name.trim(),
    contact_name: app.owner_name.trim(),
    email: app.email.trim(),
    phone: app.phone.trim(),
    password: app.password ?? '',
    terms_accepted: app.agreed_terms === true,
    price_rule_accepted: app.agreed_price_rule === true,
    website_or_instagram: textOrNull(app.instagram_or_website),
    sells: app.sells,
    city: app.city.trim(),
    ...(app.proposed_commission_bps !== undefined ? { proposed_commission_bps: app.proposed_commission_bps } : {}),
    store_details: {
      delivery: app.delivery,
      returns: app.returns,
      payment: app.pay_on_delivery,
      payout: app.payout,
      business: { legal_name: textOrNull(app.legal_name), gstin: textOrNull(app.gstin) },
    },
  }
}

const TOP_LEVEL: Record<string, string> = {
  contact_name: 'owner_name',
  website_or_instagram: 'instagram_or_website',
  terms_accepted: 'agreed_terms',
  price_rule_accepted: 'agreed_price_rule',
}

/** The sign-up form's name for a field vendor-api names in a 422. */
export function signupField(key: string): string {
  if (key in TOP_LEVEL) return TOP_LEVEL[key]!
  if (!key.startsWith('store_details.')) return key
  const [section, ...rest] = key.slice('store_details.'.length).split('.')
  const inner = rest.length > 0 ? storeFieldKey(rest.join('.')) : ''
  switch (section) {
    case 'payment':
      return inner ? `pay_on_delivery.${inner}` : 'pay_on_delivery'
    case 'business':
      return inner || 'legal_name'
    default:
      return inner ? `${section}.${inner}` : (section ?? key)
  }
}

export function signupErrors(error: unknown): unknown {
  return remapFieldErrors(error, signupField)
}
