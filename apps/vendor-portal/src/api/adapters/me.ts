/**
 * Build 2's `Me` is the session (`GET /v1/vendor/me`), the commission (`GET /v1/vendor/commission`,
 * its own route in vendor-api) and the setup checklist, which vendor-api does not keep: it is worked
 * out from the store details, the published brand page and the product counts
 * (`GET /v1/vendor/products?status=…&limit=1` totals).
 */
import type { Commission, CommissionState, Me, StoreDetails } from '../model'
import type { MeIn } from '../wire'
import { isoOrNull, oneOf } from './common'

/** Live products to aim for on Home's setup list. */
export const LIVE_TARGET = 10

const COMMISSION_STATES = ['not_set', 'proposed', 'sent_back', 'agreed'] as const satisfies readonly CommissionState[]

const bps = (value: unknown): number | null => (Number.isInteger(value) && (value as number) >= 0 ? (value as number) : null)

/** There is no default rate: anything unreadable is "not set". */
export function commissionFromApi(value: unknown): Commission {
  const c = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  return {
    state: oneOf(COMMISSION_STATES, c.state) ?? 'not_set',
    agreed_bps: bps(c.agreed_bps),
    proposed_bps: bps(c.proposed_bps),
    note: typeof c.note === 'string' ? c.note : null,
    updated_at: isoOrNull(c.updated_at),
  }
}

/** `pending` vendors can sign in and prepare; `rejected`, `suspended` and anything unknown cannot sell. */
export function vendorStatusFromApi(value: unknown): Me['vendor']['status'] {
  return value === 'approved' || value === 'pending' ? value : 'suspended'
}

export interface MeParts {
  me: MeIn
  /** `GET /v1/vendor/commission`; null when it could not be read (there is no default rate). */
  commission: unknown
  store: StoreDetails | null
  /** A version of the brand page has been approved. */
  brandLive: boolean
  /** Products not archived, and live ones. */
  counts: { all: number; approved: number }
}

export function meFromApi({ me, commission: rawCommission, store, brandLive, counts }: MeParts): Me {
  const commission = commissionFromApi(rawCommission)
  const email = typeof me.user?.email === 'string' ? me.user.email : ''
  const contact = store?.contact
  const isContact = contact !== null && contact !== undefined && contact.email.trim().toLowerCase() === email.trim().toLowerCase()
  return {
    vendor: {
      id: String(me.vendor?.id ?? ''),
      brand_name: String(me.vendor?.name ?? ''),
      status: vendorStatusFromApi(me.vendor?.status),
      approved_at: null,
      commission_bps: commission.agreed_bps,
      commission,
    },
    user: { id: String(me.user?.id ?? ''), name: isContact ? contact.name : email, email },
    role: me.user?.role === 'owner' ? 'vendor_owner' : 'vendor_staff',
    setup: {
      // vendor-api lets nobody sign in before the password is set.
      password_set: true,
      brand_page: brandLive,
      first_product: counts.all > 0,
      store_details: store?.complete === true,
      live_products: counts.approved,
      live_target: LIVE_TARGET,
    },
  }
}
