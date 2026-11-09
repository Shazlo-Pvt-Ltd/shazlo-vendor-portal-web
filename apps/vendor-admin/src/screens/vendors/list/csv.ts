import type { components } from '../../../api/schema'
import { vendorsCopy } from '../../../copy/vendors'
import { formatDate } from '../../../lib/format'
import { vendorPill } from '../../../lib/status'

type Vendor = components['schemas']['VendorSummary']

const BOM = String.fromCharCode(0xfeff)

export const formatCommission = (bps: number | null) => (bps == null ? '—' : `${(bps / 100).toLocaleString('en-IN')}%`)

// RFC 4180: quote a field when it holds a comma, quote or line break; double inner quotes.
// A leading = + - @ would run as a formula in a spreadsheet, so it gets an apostrophe first.
function field(value: string | number): string {
  let text = String(value)
  if (/^[=+\-@]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function vendorsCsv(vendors: Vendor[]): string {
  const lines = [vendorsCopy.csv.headers.map(field).join(',')]
  for (const v of vendors) {
    lines.push(
      [v.brand_name, v.owner_name, v.email, v.phone, v.city, v.sells.join(', '), vendorPill[v.status].label, v.live_products, formatDate(v.since), formatCommission(v.commission_bps)].map(field).join(','),
    )
  }
  // The byte-order mark makes Excel read the file as UTF-8 (₹, Devanagari).
  return `${BOM}${lines.join('\r\n')}\r\n`
}

export function downloadCsv(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
