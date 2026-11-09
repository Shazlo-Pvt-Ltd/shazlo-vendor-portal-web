// Stand-in product photos until real uploads exist: small SVG block-print swatches in natural-dye
// colours, generated from a seed so every product keeps the same look.
const GROUNDS = ['#2E3F6E', '#8C2F25', '#A4502B', '#EFE6D2', '#C99A2E', '#2B2522', '#5C6B4E', '#D9C3A0']
// Light grounds get a dark print and dark grounds a light one, so no swatch comes out blank.
const LIGHT_GROUNDS = new Set(['#EFE6D2', '#D9C3A0', '#C99A2E'])
const DARK_INKS = ['#8C2F25', '#2E3F6E', '#2B2522']
const LIGHT_INKS = ['#EFE6D2', '#F3D9A4']

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

const MOTIFS = [
  (c: string) => `<circle cx="10" cy="10" r="4" fill="none" stroke="${c}" stroke-width="1.6"/><circle cx="10" cy="10" r="1.2" fill="${c}"/>`,
  (c: string) => `<path d="M10 3 17 10 10 17 3 10Z" fill="none" stroke="${c}" stroke-width="1.4"/><path d="M10 7.5 12.5 10 10 12.5 7.5 10Z" fill="${c}"/>`,
  (c: string) => `<path d="M10 2c2 4 2 4 6 6-4 2-4 2-6 6-2-4-2-4-6-6 4-2 4-2 6-6Z" fill="${c}" opacity=".9"/>`,
  (c: string) => `<path d="M0 10h20M10 0v20" stroke="${c}" stroke-width="1" opacity=".7"/><circle cx="10" cy="10" r="2.4" fill="${c}"/>`,
]

export function swatch(seed: string, variant: 'front' | 'back' | 'closeup' | 'extra' = 'front'): string {
  const h = hash(seed)
  const ground = GROUNDS[h % GROUNDS.length]!
  const inks = LIGHT_GROUNDS.has(ground) ? DARK_INKS : LIGHT_INKS
  const ink = inks[(h >>> 3) % inks.length]!
  const motif = MOTIFS[(h >>> 6) % MOTIFS.length]!(ink)
  const scale = variant === 'closeup' ? 2.4 : variant === 'back' ? 0.8 : 1
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 200"><defs><pattern id="p" width="${20 * scale}" height="${20 * scale}" patternUnits="userSpaceOnUse"><g transform="scale(${scale})">${motif}</g></pattern></defs><rect width="160" height="200" fill="${ground}"/><rect width="160" height="200" fill="url(#p)"/>${variant === 'back' ? `<rect y="150" width="160" height="50" fill="${ground}" opacity=".55"/>` : ''}</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
