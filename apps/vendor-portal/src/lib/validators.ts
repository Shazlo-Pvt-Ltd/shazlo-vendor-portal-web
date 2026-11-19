// Format checks for Indian business details, shared by the screens and the mock API (src/mocks),
// so both accept and reject exactly the same input. Pure functions with no copy: messages live in
// src/copy/catalog.ts and the field checks that use them in src/lib/storeDetails.ts.

// ---- phone, email, links -------------------------------------------------------------------

// Indian mobiles: ten digits starting 6–9, typed with or without +91 / 0 and spaces or dashes.
export function normalisePhone(raw: string): string | null {
  let digits = raw.replace(/[\s\-().]/g, '')
  if (digits.startsWith('+91')) digits = digits.slice(3)
  else if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2)
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  return /^[6-9]\d{9}$/.test(digits) ? digits : null
}

export function isValidEmail(raw: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw.trim())
}

const HANDLE = /^@?(?!.*\.\.)[a-z0-9._]{1,30}$/i
const WEBSITE = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i

// An Instagram handle (@kalki.studio) or a website (kalkistudio.in, https://…).
export function isValidLink(raw: string): boolean {
  const v = raw.trim()
  return HANDLE.test(v) || WEBSITE.test(v)
}

// ---- PIN code ------------------------------------------------------------------------------

export const PIN_PATTERN = /^[1-9]\d{5}$/

export function normalisePin(raw: string): string {
  return raw.replace(/\s/g, '')
}

export function isValidPin(raw: string): boolean {
  return PIN_PATTERN.test(normalisePin(raw))
}

// ---- IFSC ----------------------------------------------------------------------------------

// Four letters for the bank, a zero, then six letters or digits for the branch (RBI format).
export const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/

export function normaliseIfsc(raw: string): string {
  return raw.replace(/\s/g, '').toUpperCase()
}

// Accepts lower case and spaces ("hdfc 0001234"); check the normalised code against the pattern.
export function isValidIfsc(raw: string): boolean {
  return IFSC_PATTERN.test(normaliseIfsc(raw))
}

// ---- bank account --------------------------------------------------------------------------

export function normaliseAccountNumber(raw: string): string {
  return raw.replace(/[\s-]/g, '')
}

// Indian bank account numbers are 9 to 18 digits.
export function isValidAccountNumber(raw: string): boolean {
  return /^\d{9,18}$/.test(normaliseAccountNumber(raw))
}

export function accountLast4(raw: string): string {
  return normaliseAccountNumber(raw).slice(-4)
}

// "•••• 4821", for showing a saved account.
export function maskAccountNumber(last4: string): string {
  return `•••• ${last4}`
}

// ---- UPI -----------------------------------------------------------------------------------

// name@handle, like kalki.studio@okhdfcbank. UPI IDs are not case-sensitive; we keep lower case.
const UPI_PATTERN = /^[a-z0-9][a-z0-9._-]{1,255}@[a-z][a-z0-9]{1,63}$/

export function normaliseUpiId(raw: string): string {
  return raw.trim().toLowerCase()
}

export function isValidUpiId(raw: string): boolean {
  return UPI_PATTERN.test(normaliseUpiId(raw))
}

// "kalki.studio@okhdfcbank" → "ka•••@okhdfcbank": enough to recognise, not enough to reuse.
export function maskUpiId(raw: string): string {
  const id = normaliseUpiId(raw)
  const at = id.lastIndexOf('@')
  if (at < 0) return '•••'
  const name = id.slice(0, at)
  return `${name.slice(0, name.length > 2 ? 2 : 1)}•••${id.slice(at)}`
}

// ---- GSTIN ---------------------------------------------------------------------------------

// 2-digit state code, the 10-character PAN, entity number, Z, check character.
const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
const BASE36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

export function normaliseGstin(raw: string): string {
  return raw.replace(/\s/g, '').toUpperCase()
}

// The 15th character of a GSTIN, computed from the first 14 (GSTN's mod-36 check).
export function gstinCheckChar(first14: string): string {
  let sum = 0
  for (let i = 0; i < 14; i++) {
    const value = BASE36.indexOf(first14[i] ?? '') * (i % 2 === 0 ? 1 : 2)
    sum += Math.floor(value / 36) + (value % 36)
  }
  return BASE36[(36 - (sum % 36)) % 36]!
}

// State codes 01–38, 97 (other territory) or 99 (centre), the right shape, and the check character.
export function isValidGstin(raw: string): boolean {
  const g = normaliseGstin(raw)
  if (!GSTIN_PATTERN.test(g)) return false
  const state = Number(g.slice(0, 2))
  if (!((state >= 1 && state <= 38) || state === 97 || state === 99)) return false
  return gstinCheckChar(g.slice(0, 14)) === g[14]
}
