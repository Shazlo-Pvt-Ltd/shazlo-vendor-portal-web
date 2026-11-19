/** Dates as the portal shows them: relative ("3 days ago") with the exact time beside it. */

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
const EXACT = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
]

/** "3 days ago", "yesterday", "just now"; empty for a value that is not a date. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const seconds = (Date.parse(iso) - now) / 1000
  if (Number.isNaN(seconds)) return ''
  for (const [unit, size] of STEPS) {
    if (Math.abs(seconds) >= size) return RELATIVE.format(Math.round(seconds / size), unit)
  }
  return 'just now'
}

/** "12 Nov 2026, 09:30"; empty for a value that is not a date. */
export function exactTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : EXACT.format(date)
}
