import { z } from 'zod'
import type * as M from '../api/model'
import { commissionCopy, rateErrors } from '../copy/vendors'

type Commission = M.Commission

// The API counts commission in basis points; people read and type percentages ("12", "12.5").
export const MAX_RATE = 40

export function formatRate(bps: number): string {
  return `${(bps / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}%`
}

// "12.5" for 1250: what the rate field starts with.
export function rateText(bps: number | null | undefined): string {
  return bps == null ? '' : String(bps / 100)
}

export function toBps(text: string): number {
  return Math.round(Number(text.trim()) * 100)
}

// A typed rate: required, a number with up to two decimals, 0–40%.
export const rateField = z
  .string()
  .trim()
  .min(1, rateErrors.required)
  .regex(/^\d+(\.\d{1,2})?$/, rateErrors.number)
  .refine((v) => Number(v) <= MAX_RATE, rateErrors.range)

// A proposal waits for Shazlo: the list shows it as a pill, not as the rate in force.
export const waitingProposal = (c: Commission): number | null => (c.state === 'proposed' && c.proposed_bps != null ? c.proposed_bps : null)

// One line for exports: "12%", "10% proposed", "12% · 10% proposed" or "Not set".
export function commissionText(c: Commission): string {
  const proposed = waitingProposal(c)
  const agreed = c.agreed_bps == null ? null : formatRate(c.agreed_bps)
  if (proposed != null) return agreed ? commissionCopy.agreedAndProposed(agreed, formatRate(proposed)) : commissionCopy.proposed(formatRate(proposed))
  return agreed ?? commissionCopy.notSet
}
