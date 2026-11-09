import type { Schemas } from '../../api/client'
import { importCopy } from '../../copy/import'

// Hands the seller a file: a Blob URL clicked through a temporary download link.
export function saveFile(text: string, fileName: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.style.display = 'none'
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

// A spreadsheet would run a cell starting with = + - @ as a formula; a leading quote keeps it text.
function csvCell(value: string | number | null): string {
  let text = value == null ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

// The rows to fix, built in the browser. The BOM makes Excel read ₹ and Devanagari correctly.
export function errorReportCsv(errors: Schemas['ImportJob']['errors']): string {
  const lines: (string | number | null)[][] = [[...importCopy.review.reportHeader], ...errors.map((e) => [e.row, e.product, e.column, e.message])]
  return `\uFEFF${lines.map((cells) => cells.map(csvCell).join(',')).join('\r\n')}\r\n`
}
