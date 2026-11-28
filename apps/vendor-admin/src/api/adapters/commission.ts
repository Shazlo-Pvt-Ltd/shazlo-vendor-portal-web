import type { components } from '../schema'
import type * as M from '../model'

type CommissionOut = components['schemas']['CommissionOut']

const STATES: readonly M.CommissionState[] = ['not_set', 'proposed', 'sent_back', 'agreed']

// A rate is whole basis points, 0 to 4000 (40%). Anything else is a fault in the answer: show no rate
// rather than a wrong one.
const rate = (bps: number | null | undefined): number | null => (typeof bps === 'number' && Number.isInteger(bps) && bps >= 0 && bps <= 4000 ? bps : null)

/**
 * vendor-api's `CommissionOut` as the screens read it. `state` is a plain string on the wire, so an
 * unknown one reads as `not_set` (no rate is better than a guess); a blank note is no note.
 */
export function toCommission(wire: CommissionOut): M.Commission {
  const state = STATES.find((s) => s === wire.state) ?? 'not_set'
  const note = wire.note?.trim()
  return { state, agreed_bps: rate(wire.agreed_bps), proposed_bps: rate(wire.proposed_bps), note: note ? note : null, updated_at: wire.updated_at ?? null }
}

/** The vendor as the screens hold it, with its commission replaced by a newer answer (`commission_bps` is the agreed rate). */
export function withCommission<V extends { commission: M.Commission; commission_bps: number | null }>(vendor: V, commission: M.Commission): V {
  return { ...vendor, commission, commission_bps: commission.agreed_bps }
}
