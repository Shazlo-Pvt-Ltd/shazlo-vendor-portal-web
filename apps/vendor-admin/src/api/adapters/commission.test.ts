import { describe, expect, it } from 'vitest'
import type { components } from '../schema'
import { toCommission, withCommission } from './commission'

type Out = components['schemas']['CommissionOut']
const out = (over: Partial<Out>): Out => ({ state: 'not_set', agreed_bps: null, proposed_bps: null, note: null, updated_at: null, ...over })
const AT = '2026-11-20T10:00:00Z'

describe('toCommission', () => {
  it('not_set: no rates, no note, no date', () => {
    expect(toCommission(out({}))).toEqual({ state: 'not_set', agreed_bps: null, proposed_bps: null, note: null, updated_at: null })
  })

  it('proposed: the proposal waits and the agreed rate stays in force', () => {
    expect(toCommission(out({ state: 'proposed', agreed_bps: 1200, proposed_bps: 1000, updated_at: AT }))).toEqual({ state: 'proposed', agreed_bps: 1200, proposed_bps: 1000, note: null, updated_at: AT })
  })

  it('sent_back: keeps Shazlo’s note and the rejected proposal', () => {
    const c = toCommission(out({ state: 'sent_back', agreed_bps: 1500, proposed_bps: 800, note: 'We can do 12% with Shazlo delivery.', updated_at: AT }))
    expect(c).toMatchObject({ state: 'sent_back', agreed_bps: 1500, proposed_bps: 800, note: 'We can do 12% with Shazlo delivery.' })
  })

  it('agreed: the rate in force, no proposal', () => {
    expect(toCommission(out({ state: 'agreed', agreed_bps: 1250, note: 'Agreed on the call.', updated_at: AT }))).toEqual({ state: 'agreed', agreed_bps: 1250, proposed_bps: null, note: 'Agreed on the call.', updated_at: AT })
  })

  it('takes the ends of the range: 0% is a rate, 40% is the most', () => {
    expect(toCommission(out({ state: 'agreed', agreed_bps: 0 })).agreed_bps).toBe(0)
    expect(toCommission(out({ state: 'agreed', agreed_bps: 4000 })).agreed_bps).toBe(4000)
  })

  it('shows no rate rather than a wrong one (out of range or not whole)', () => {
    for (const bad of [-1, 4001, 12.5, Number.NaN]) expect(toCommission(out({ state: 'agreed', agreed_bps: bad })).agreed_bps, String(bad)).toBeNull()
  })

  it('reads a state it does not know as not_set, and a blank note as none', () => {
    expect(toCommission(out({ state: 'paused' })).state).toBe('not_set')
    expect(toCommission(out({ state: 'agreed', agreed_bps: 1000, note: '   ' })).note).toBeNull()
  })
})

describe('withCommission', () => {
  it('replaces only the commission and the agreed rate of the vendor', () => {
    const vendor = { id: 'v1', brand_name: 'Kalki', history: [1], commission: toCommission(out({ state: 'proposed', agreed_bps: 1200, proposed_bps: 1000 })), commission_bps: 1200 as number | null }
    const next = withCommission(vendor, toCommission(out({ state: 'agreed', agreed_bps: 1000 })))
    expect(next).toMatchObject({ id: 'v1', brand_name: 'Kalki', history: [1], commission_bps: 1000, commission: { state: 'agreed', agreed_bps: 1000, proposed_bps: null } })
    expect(vendor.commission_bps).toBe(1200)
  })
})
