import type { QueueItem } from '../../api'

/** Waiting time as the queue shows it: "1 d 2 h", "19 h", "45 m". */
export function formatWaiting(minutes: number) {
  if (minutes >= 1440) {
    const d = Math.floor(minutes / 1440)
    const h = Math.floor((minutes % 1440) / 60)
    return h ? `${d} d ${h} h` : `${d} d`
  }
  if (minutes >= 60) return `${Math.floor(minutes / 60)} h`
  return `${Math.max(1, Math.round(minutes))} m`
}

/** A duration with minutes kept: "5 h 20 m". */
export function formatDuration(minutes: number) {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  if (!h) return `${m} m`
  return m ? `${h} h ${m} m` : `${h} h`
}

/** Over the 24-hour review target. */
export const isOverdue = (minutes: number) => minutes >= 24 * 60

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Where a queue row opens: A-05 product, A-07 brand page, A-09 vendor application. */
export function itemPath(item: Pick<QueueItem, 'kind' | 'id'>) {
  if (item.kind === 'product') return `/review/product/${item.id}`
  if (item.kind === 'brand_page') return `/review/brand/${item.id}`
  return `/vendors/${item.id}`
}

/** Byte-order mark so Excel opens the file as UTF-8 (₹, curly quotes). */
const BOM = String.fromCharCode(0xfeff)

/** Builds a CSV file and hands it to the browser to save. */
export function downloadCsv(filename: string, rows: Array<Array<string | number | null>>) {
  const cell = (v: string | number | null) => {
    const s = v === null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = rows.map(r => r.map(cell).join(',')).join('\n')
  if (typeof URL.createObjectURL !== 'function') return
  const url = URL.createObjectURL(new Blob([BOM + csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
