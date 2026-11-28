import type { Schemas } from '../api/model'
import { catalogCopy } from '../copy/catalog'
import { payout } from './format'

// Commission is agreed per brand (spec §6): there is no default rate anywhere. Rates travel as
// basis points (1200 = 12%); sellers type and read percentages.

export type Commission = Schemas['Commission']

export const COMMISSION_MAX_BPS = 4000

// Null when the rate is a whole number of basis points from 0 to 4000 (0–40%), else the message.
export function checkCommissionBps(bps: unknown): string | null {
  return Number.isInteger(bps) && (bps as number) >= 0 && (bps as number) <= COMMISSION_MAX_BPS ? null : catalogCopy.errors.commission.range
}

// 1200 → "12%", 1250 → "12.5%", 1225 → "12.25%".
export function formatBps(bps: number): string {
  return `${Number((bps / 100).toFixed(2))}%`
}

// What a seller types ("12", "12.5", "12.5 %") → basis points; null when it is not a percentage
// with at most two decimals. Range is checked separately (checkCommissionBps).
export function parsePercent(text: string): number | null {
  const clean = text.replace(/[%\s]/g, '')
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(clean)) return null
  return Math.round(Number(clean) * 100)
}

// The rate in force, or null while none is agreed (whatever is proposed).
export function agreedBps(commission: Commission | null | undefined): number | null {
  return commission?.agreed_bps ?? null
}

// "You receive ₹X after Y% commission (₹Z)": null until there is both a price and an agreed rate.
export function sellerReceives(pricePaise: number | null | undefined, commission: Commission | null | undefined): { bps: number; commission: number; receive: number } | null {
  const bps = agreedBps(commission)
  if (bps === null || !pricePaise) return null
  return { bps, ...payout(pricePaise, bps) }
}
