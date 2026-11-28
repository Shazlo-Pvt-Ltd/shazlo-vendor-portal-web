// Text a module sends (a page title, a toast, the message of a fatal error) is shown as plain text,
// never HTML: React escapes it, and the protocol's validators already refuse anything that looks like
// markup. It is also cut down to size here, so a module cannot push the shell's chrome around with a
// wall of text: at most `maxLines` lines and `maxLength` characters, with "…" where it was cut.

export const MODULE_TEXT = {
  title: { maxLength: 120, maxLines: 1 },
  toast: { maxLength: 280, maxLines: 3 },
  error: { maxLength: 300, maxLines: 3 },
} as const

export function moduleText(text: string, { maxLength, maxLines }: { maxLength: number; maxLines: number }): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '')
  let result = lines.slice(0, maxLines).join('\n')
  let cut = lines.length > maxLines
  if (result.length > maxLength) {
    result = result.slice(0, maxLength - 1).trimEnd()
    cut = true
  }
  return cut ? `${result}…` : result
}
