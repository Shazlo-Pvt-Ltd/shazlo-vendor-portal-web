import { publishingCopy } from '../../../copy/publishing'
import { formatStamp } from '../../../lib/format'

const copy = publishingCopy.when

// When a future attempt is due: "In 4 min", "In 2 h", or a date. Overdue reads "Now".
export function formatUntil(iso: string, now: Date = new Date()): string {
  const ms = Date.parse(iso) - now.getTime()
  if (ms <= 0) return copy.now
  const minutes = Math.ceil(ms / 60_000)
  if (minutes < 60) return copy.inMinutes(minutes)
  if (minutes < 24 * 60) return copy.inHours(Math.round(minutes / 60))
  return formatStamp(iso, now)
}
