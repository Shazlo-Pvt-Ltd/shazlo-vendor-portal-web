/**
 * Hands the seller a file without a request: a `blob:` address on a temporary link, released right
 * after the click (some browsers read it after the click returns). Text is saved as UTF-8 CSV.
 */
export function saveFile(content: string | Blob, fileName: string, type = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(typeof content === 'string' ? new Blob([content], { type }) : content)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  link.style.display = 'none'
  document.body.append(link)
  try {
    link.click()
  } finally {
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}
