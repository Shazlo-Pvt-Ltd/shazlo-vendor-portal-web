import { formatStamp, formatTime } from '../../lib/format'

// Mid-sentence dates for review timelines, built on lib/format's IST calendar:
// "Sent back today, 11:40", "Submitted 18 Oct, 16:20", "Approved yesterday".
const RELATIVE = /^(Today|Yesterday), /

export function onDay(iso: string, now: Date = new Date()): string {
  const stamp = formatStamp(iso, now)
  const match = RELATIVE.exec(stamp)
  return match ? match[1]!.toLowerCase() : stamp
}

export function onDayAt(iso: string, now: Date = new Date()): string {
  const stamp = formatStamp(iso, now)
  return RELATIVE.test(stamp) ? stamp.charAt(0).toLowerCase() + stamp.slice(1) : `${stamp}, ${formatTime(iso)}`
}

// How long an item has sat in the queue: "25 min", "19 h", "3 days".
export function waitedFor(iso: string, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 60_000))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours} h`
  return `${Math.floor(hours / 24)} days`
}
