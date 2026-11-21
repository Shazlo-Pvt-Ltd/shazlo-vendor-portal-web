import type { components } from '../../../api/schema'
import { queueCopy } from '../../../copy/queue'
import { formatWait, queuePill } from '../../../lib/status'

type QueueItem = components['schemas']['QueueItem']

const isoDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' })

// Quotes what needs quoting, and stops a seller's title that starts with = or + from running
// as a formula in a spreadsheet.
function cell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function queueCsv(items: QueueItem[], now: number = Date.now()): string {
  const lines = [
    [...queueCopy.csv.headers],
    ...items.map((i) => [i.title, i.detail, queuePill(i).label, i.vendor.name, i.submitted_at, formatWait(now - Date.parse(i.submitted_at))]),
  ]
  return lines.map((line) => line.map(cell).join(',')).join('\r\n') + '\r\n'
}

// "review-queue-2026-11-09.csv", dated in IST.
export function csvFilename(now: Date = new Date()): string {
  return queueCopy.csv.filename(isoDay.format(now))
}

// The module runs in a sandboxed iframe that allows downloads; a temporary link saves the file.
export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8') {
  // The byte-order mark makes Excel read the file as UTF-8 (em dashes, ₹, Devanagari).
  const url = URL.createObjectURL(new Blob(['\uFEFF', text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
