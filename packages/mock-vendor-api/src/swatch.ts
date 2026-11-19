// Stand-in product photos until real uploads exist: small SVG block-print swatches in natural-dye
// colours, generated from a seed so every product keeps the same look. Worn and try-on photos put
// the same print on a person against a plain backdrop, so they read differently from flat shots.
const GROUNDS = ['#2E3F6E', '#8C2F25', '#A4502B', '#EFE6D2', '#C99A2E', '#2B2522', '#5C6B4E', '#D9C3A0']
// Light grounds get a dark print and dark grounds a light one, so no swatch comes out blank.
const LIGHT_GROUNDS = new Set(['#EFE6D2', '#D9C3A0', '#C99A2E'])
const DARK_INKS = ['#8C2F25', '#2E3F6E', '#2B2522']
const LIGHT_INKS = ['#EFE6D2', '#F3D9A4']
// Try-on photos: a different wall, skin tone and stance for each of the five people.
const BACKDROPS = ['#E9E2D6', '#D7DCCF', '#E6D3C3', '#CFD8DC', '#EADFC8']
const SKINS = ['#8D5A3B', '#C68B59', '#A86F4C', '#6E4630', '#D4A373']
const STANCE = [0, -10, 8, -4, 12]

export type Shot = 'front' | 'back' | 'detail' | 'worn' | 'extra' | 'tryon'

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

const dataUrl = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`

function print(seed: string, scale: number) {
  const h = hash(seed)
  const ground = GROUNDS[h % GROUNDS.length]!
  const inks = LIGHT_GROUNDS.has(ground) ? DARK_INKS : LIGHT_INKS
  const ink = inks[(h >>> 3) % inks.length]!
  const motif = MOTIFS[(h >>> 6) % MOTIFS.length]!(ink)
  const pattern = `<pattern id="p" width="${20 * scale}" height="${20 * scale}" patternUnits="userSpaceOnUse"><g transform="scale(${scale})">${motif}</g></pattern>`
  return { ground, pattern }
}

// A person wearing the print: head, arms, a kurta-shaped garment and legs, on a wall and floor.
function person(seed: string, backdrop: string, skin: string, dx: number) {
  const { ground, pattern } = print(seed, 0.8)
  const x = (n: number) => n + dx
  const garment = `M${x(60)} 60 L${x(100)} 60 L${x(112)} 150 L${x(48)} 150Z`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 200"><defs>${pattern}</defs>
<rect width="160" height="200" fill="${backdrop}"/><rect y="172" width="160" height="28" fill="#000" opacity=".08"/>
<path d="M${x(60)} 64 L${x(46)} 122 M${x(100)} 64 L${x(114)} 122" stroke="${skin}" stroke-width="8" stroke-linecap="round"/>
<rect x="${x(66)}" y="148" width="11" height="28" fill="#3A2F2A"/><rect x="${x(83)}" y="148" width="11" height="28" fill="#3A2F2A"/>
<path d="${garment}" fill="${ground}"/><path d="${garment}" fill="url(#p)"/>
<rect x="${x(76)}" y="48" width="8" height="12" fill="${skin}"/><circle cx="${x(80)}" cy="38" r="13" fill="${skin}"/>
<path d="M${x(67)} 36 a13 13 0 0 1 26 0 q-13 -6 -26 0Z" fill="#2B2522"/></svg>`
}

// `n` picks the person for try-on photos (0–4).
export function swatch(seed: string, shot: Shot = 'front', n = 0): string {
  if (shot === 'worn') return dataUrl(person(seed, '#EFE9DF', SKINS[hash(seed) % SKINS.length]!, 0))
  if (shot === 'tryon') return dataUrl(person(seed, BACKDROPS[n % BACKDROPS.length]!, SKINS[(hash(seed) + n + 1) % SKINS.length]!, STANCE[n % STANCE.length]!))
  const scale = shot === 'detail' ? 2.4 : shot === 'back' ? 0.8 : shot === 'extra' ? 1.6 : 1
  const { ground, pattern } = print(seed, scale)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 200"><defs>${pattern}</defs><rect width="160" height="200" fill="${ground}"/><rect width="160" height="200" fill="url(#p)"/>${shot === 'back' ? `<rect y="150" width="160" height="50" fill="${ground}" opacity=".55"/>` : ''}</svg>`
  return dataUrl(svg)
}

// A photo of a brand's own size chart: a ruled card with a few rows, as a seller would snap it.
export function chartPhoto(rows: string[][]): string {
  const lines = rows
    .map((cells, r) => cells.map((cell, c) => `<text x="${14 + c * 36}" y="${40 + r * 22}" font-family="sans-serif" font-size="${r === 0 ? 10 : 11}" font-weight="${r === 0 ? 700 : 400}" fill="#2B2522">${cell}</text>`).join(''))
    .join('')
  const rules = rows.map((_, r) => `<rect x="10" y="${46 + r * 22}" width="140" height="1" fill="#2B2522" opacity=".25"/>`).join('')
  return dataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 200"><rect width="160" height="200" fill="#D9C3A0"/><rect x="6" y="14" width="148" height="${rows.length * 22 + 26}" fill="#FBF8F1" transform="rotate(-2 80 100)"/><g transform="rotate(-2 80 100)">${lines}${rules}</g></svg>`)
}
