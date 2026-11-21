import { z } from 'zod'
import type { components } from '../api/schema'
import { commissionCopy, rateErrors } from '../copy/vendors'

type Commission = components['schemas']['Commission']

// The API counts commission in basis points; people read and type percentages ("12", "12.5").
export const MAX_RATE = 40

export function formatRate(bps: number): string {
  return `${(bps / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}%`
}

// "12.5" for 1250: what the rate field starts with.
export function rateText(bps: number | null | undefined): string {
  return bps == null ? '' : String(bps / 100)
}

// Some phone keypads (and people) type a decimal comma: "12,5" is 12.5%.
const toNumber = (text: string) => Number(text.trim().replace(',', '.'))

export function toBps(text: string): number {
  return Math.round(toNumber(text) * 100)
}

// A typed rate: required, a number with up to two decimals (point or comma), 0–40%.
export const rateField = z
  .string()
  .trim()
  .min(1, rateErrors.required)
  .regex(/^\d+([.,]\d{1,2})?$/, rateErrors.number)
  .refine((v) => toNumber(v) <= MAX_RATE, rateErrors.range)

// Whether two commissions say the same thing (an API answer may be a new object with equal values).
export const sameCommission = (a: Commission, b: Commission) =>
  a.state === b.state && a.agreed_bps === b.agreed_bps && a.proposed_bps === b.proposed_bps && a.note === b.note && a.updated_at === b.updated_at

// The newest "sent back" in a vendor's history: who wrote the note the brand is reading.
export function lastSentBack<T extends { event: string; at: string }>(history: readonly T[]): T | undefined {
  let newest: T | undefined
  for (const entry of history) {
    // Compare instants: "15:00+05:30" is earlier than "10:00Z" though it sorts later as text.
    if (entry.event === 'commission_sent_back' && (!newest || Date.parse(entry.at) > Date.parse(newest.at))) newest = entry
  }
  return newest
}

// A proposal waits for Shazlo: the list shows it as a pill, not as the rate in force.
export const waitingProposal = (c: Commission): number | null => (c.state === 'proposed' && c.proposed_bps != null ? c.proposed_bps : null)

// One line for exports: "12%", "10% proposed", "12% · 10% proposed" or "Not set".
export function commissionText(c: Commission): string {
  const proposed = waitingProposal(c)
  const agreed = c.agreed_bps == null ? null : formatRate(c.agreed_bps)
  if (proposed != null) return agreed ? commissionCopy.agreedAndProposed(agreed, formatRate(proposed)) : commissionCopy.proposed(formatRate(proposed))
  return agreed ?? commissionCopy.notSet
}
