import { describe, expect, it } from 'vitest'
import type { StoreDetails } from '../model'
import type { MeOut } from '../wire'
import { commissionFromApi, LIVE_TARGET, meFromApi, vendorStatusFromApi } from './me'

const me: MeOut = {
  user: { id: 'u-1', email: 'kiran@kalkistudio.in', role: 'owner', last_login_at: null },
  vendor: { id: 'v-1', name: 'Kalki Studio', slug: 'kalki-studio', status: 'approved', commission: { state: 'agreed', agreed_bps: 1200, proposed_bps: null, note: null } },
}

const store = { contact: { name: 'Kiran Shah', phone: '9825012345', email: 'Kiran@KalkiStudio.in' }, complete: true } as StoreDetails

describe('meFromApi', () => {
  it('puts the session, the store details and the product counts together', () => {
    expect(meFromApi({ me, store, brandLive: true, counts: { all: 27, approved: 18 } })).toEqual({
      vendor: {
        id: 'v-1',
        brand_name: 'Kalki Studio',
        status: 'approved',
        approved_at: null,
        commission_bps: 1200,
        commission: { state: 'agreed', agreed_bps: 1200, proposed_bps: null, note: null, updated_at: null },
      },
      user: { id: 'u-1', name: 'Kiran Shah', email: 'kiran@kalkistudio.in' },
      role: 'vendor_owner',
      setup: { password_set: true, brand_page: true, first_product: true, store_details: true, live_products: 18, live_target: LIVE_TARGET },
    })
  })

  it('names a staff member by email, since vendor-api keeps no name for them', () => {
    const staff: MeOut = { ...me, user: { ...me.user, email: 'asha@kalkistudio.in', role: 'staff' } }
    const result = meFromApi({ me: staff, store, brandLive: false, counts: { all: 0, approved: 0 } })
    expect(result.user.name).toBe('asha@kalkistudio.in')
    expect(result.role).toBe('vendor_staff')
    expect(result.setup).toMatchObject({ brand_page: false, first_product: false, live_products: 0 })
  })

  it('counts the store details as not done while they cannot be read', () => {
    expect(meFromApi({ me, store: null, brandLive: false, counts: { all: 0, approved: 0 } }).setup.store_details).toBe(false)
  })

  it('treats an unknown role as staff, the least it can do', () => {
    const odd: MeOut = { ...me, user: { ...me.user, role: 'superuser' } }
    expect(meFromApi({ me: odd, store, brandLive: true, counts: { all: 1, approved: 1 } }).role).toBe('vendor_staff')
  })
})

describe('vendorStatusFromApi', () => {
  it('keeps approved and pending, and treats anything else as suspended', () => {
    expect(vendorStatusFromApi('approved')).toBe('approved')
    expect(vendorStatusFromApi('pending')).toBe('pending')
    expect(vendorStatusFromApi('suspended')).toBe('suspended')
    expect(vendorStatusFromApi('on_holiday')).toBe('suspended')
  })
})

describe('commissionFromApi', () => {
  it('has no default rate: a missing commission is "not set"', () => {
    expect(commissionFromApi(undefined)).toEqual({ state: 'not_set', agreed_bps: null, proposed_bps: null, note: null, updated_at: null })
  })

  it('reads an unknown state as not set but keeps an agreed rate it can read', () => {
    expect(commissionFromApi({ state: 'renegotiating', agreed_bps: 1000, proposed_bps: 'x', note: 5 } as never)).toEqual({
      state: 'not_set',
      agreed_bps: 1000,
      proposed_bps: null,
      note: null,
      updated_at: null,
    })
  })

  it('keeps the note of a sent-back proposal', () => {
    expect(commissionFromApi({ state: 'sent_back', agreed_bps: null, proposed_bps: 800, note: 'We can do 10%.' })).toMatchObject({ state: 'sent_back', proposed_bps: 800, note: 'We can do 10%.' })
  })
})
