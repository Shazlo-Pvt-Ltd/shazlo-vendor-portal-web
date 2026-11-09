const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
const num = new Intl.NumberFormat('en-IN')
const dayMonth = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' })
const dayMonthYear = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

/** ₹2,499 — or an em dash when there is no price yet. */
export const rupees = (n: number | null | undefined) => (n == null ? '—' : inr.format(n))
export const count = (n: number | null | undefined) => (n == null ? '—' : num.format(n))
export const longDate = (iso: string) => dayMonthYear.format(new Date(iso))

/** "2 h ago", "Yesterday", "21 Oct": the relative style the wireframes use. */
export function relativeTime(iso: string, now = Date.now()) {
  const t = Date.parse(iso)
  const diff = now - t
  const min = Math.round(diff / 60_000)
  if (min < 1) return 'Just now'
  if (min < 60) return `${min} min ago`
  const h = Math.round(diff / 3_600_000)
  const today = new Date(now); today.setHours(0, 0, 0, 0)
  if (t >= today.getTime()) return `${h} h ago`
  if (t >= today.getTime() - 86_400_000) return 'Yesterday'
  return dayMonth.format(new Date(t))
}

/** Seller earnings after Shazlo's commission (15% flat for pilot vendors). */
export function payout(price: number, commissionPct: number) {
  const commission = Math.round((price * commissionPct) / 100)
  return { commission, receive: price - commission }
}
