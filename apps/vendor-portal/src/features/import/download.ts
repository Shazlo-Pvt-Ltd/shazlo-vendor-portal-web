/**
 * Hands the browser a file to save, without a request: a `blob:` address on a temporary link.
 * The address is released right after the click.
 */
export function saveFile(content: Blob, fileName: string): void {
  const url = URL.createObjectURL(content)
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
    // Some browsers read the address after the click returns.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}
