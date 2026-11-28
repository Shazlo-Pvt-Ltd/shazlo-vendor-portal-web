// Money arrives as integer paise (docs/05-api-design.md §2). Sellers are in India, so dates
// use IST whatever the device's own time zone is.
const TZ = 'Asia/Kolkata'
const DASH = '—'

const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
const rupeesAndPaise = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 })
const count = new Intl.NumberFormat('en-IN')
const dayMonthYear = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ })
const dayMonth = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: TZ })
const clock = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ })
const isoDay = new Intl.DateTimeFormat('en-CA', { timeZone: TZ })

export function formatINR(paise: number | null | undefined): string {
  if (paise == null) return DASH
  return (paise % 100 === 0 ? rupees : rupeesAndPaise).format(paise / 100)
}

export function formatCount(n: number | null | undefined): string {
  return n == null ? DASH : count.format(n)
}

export function formatDate(iso: string): string {
  return dayMonthYear.format(new Date(iso))
}

export function formatTime(iso: string): string {
  return clock.format(new Date(iso))
}

// Calendar days between two instants, counted in IST.
function daysApart(a: Date, b: Date): number {
  const day = (d: Date) => Date.parse(isoDay.format(d))
  return Math.round((day(b) - day(a)) / 86_400_000)
}

export function formatRelative(iso: string, now: Date = new Date()): string {
  const then = new Date(iso)
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000)
  const days = daysApart(then, now)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  if (days === 0) return `${Math.floor(minutes / 60)} h ago`
  if (days === 1) return 'Yesterday'
  return then.getFullYear() === now.getFullYear() ? dayMonth.format(then) : dayMonthYear.format(then)
}

// "Today, 11:40" / "Yesterday, 09:12" / "22 Oct", for timelines.
export function formatStamp(iso: string, now: Date = new Date()): string {
  const then = new Date(iso)
  const days = daysApart(then, now)
  if (days === 0) return `Today, ${clock.format(then)}`
  if (days === 1) return `Yesterday, ${clock.format(then)}`
  return then.getFullYear() === now.getFullYear() ? dayMonth.format(then) : dayMonthYear.format(then)
}

export function payout(pricePaise: number, commissionBps: number): { commission: number; receive: number } {
  const commission = Math.round((pricePaise * commissionBps) / 10_000)
  return { commission, receive: pricePaise - commission }
}
