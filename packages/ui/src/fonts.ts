// Voyage (Violaine & Jérémy, vj-type.com) is a commercial typeface. Its licence for
// web use is not confirmed yet, so the font files are not shipped in this package.
// Apps host the files themselves and pass their URL here.

export const voyageFontFiles = {
  regular: 'voyage-regular.otf',
  bold: 'voyage-bold.otf',
} as const

export interface VoyageFontOptions {
  // URL of the folder holding the files in voyageFontFiles, e.g. '/fonts' or a CDN origin.
  baseUrl: string
  display?: 'auto' | 'block' | 'swap' | 'fallback' | 'optional'
}

// baseUrl is written into url('...'), so quotes, brackets, backslashes, semicolons and
// whitespace would break out of the string or the rule.
const UNSAFE_URL = /['"()\\;\s]/

export function voyageFontFaces({ baseUrl, display = 'swap' }: VoyageFontOptions): string {
  if (!baseUrl.trim() || UNSAFE_URL.test(baseUrl)) {
    throw new Error(`Invalid Voyage baseUrl ${JSON.stringify(baseUrl)}: use a plain path or URL such as '/fonts'`)
  }
  // Scan from the end once. An unanchored /\/+$/ retries at every slash when
  // a long slash run is followed by another character, causing quadratic work.
  let end = baseUrl.length
  while (end > 0 && baseUrl.charAt(end - 1) === '/') end -= 1
  const base = baseUrl.slice(0, end)
  const faces: [number, string][] = [
    [400, voyageFontFiles.regular],
    [700, voyageFontFiles.bold],
  ]
  return faces
    .map(
      ([weight, file]) => `@font-face {
  font-family: 'Voyage';
  src: url('${base}/${file}') format('opentype');
  font-weight: ${weight};
  font-style: normal;
  font-display: ${display};
}`,
    )
    .join('\n')
}
