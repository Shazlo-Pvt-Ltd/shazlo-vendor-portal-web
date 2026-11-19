// Stand-in product photos until real uploads exist: small SVG block-print swatches in natural-dye
// colours, generated from a seed so every product keeps the same look. Worn and try-on photos put
// the same fabric on a simple figure, so they read as "someone wearing it" at a glance.
const GROUNDS = ['#2E3F6E', '#8C2F25', '#A4502B', '#EFE6D2', '#C99A2E', '#2B2522', '#5C6B4E', '#D9C3A0']
// Light grounds get a dark print and dark grounds a light one, so no swatch comes out blank.
const LIGHT_GROUNDS = new Set(['#EFE6D2', '#D9C3A0', '#C99A2E'])
const DARK_INKS = ['#8C2F25', '#2E3F6E', '#2B2522']
const LIGHT_INKS = ['#EFE6D2', '#F3D9A4']
// Try-on backdrops and skin tones vary by photo, like five different people in five rooms.
const WALLS = ['#E9E2D6', '#DCE3E0', '#EADBD3', '#E2E0EC', '#DDE6D5']
const SKINS = ['#C68B5E', '#8D5A3B', '#E0AC7E', '#A8714A', '#B97D52']
const HAIR = '#2B2522'

export type SwatchVariant = 'front' | 'back' | 'detail' | 'worn' | 'extra' | 'tryon'

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

function fabric(seed: string) {
  const h = hash(seed)
  const ground = GROUNDS[h % GROUNDS.length]!
  const inks = LIGHT_GROUNDS.has(ground) ? DARK_INKS : LIGHT_INKS
  const ink = inks[(h >>> 3) % inks.length]!
  const motif = MOTIFS[(h >>> 6) % MOTIFS.length]!(ink)
  return { h, ground, motif }
}

const pattern = (scale: number, motif: string) =>
  `<pattern id="p" width="${20 * scale}" height="${20 * scale}" patternUnits="userSpaceOnUse"><g transform="scale(${scale})">${motif}</g></pattern>`

const toUrl = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`

// A figure in a kurta-shaped garment cut from the fabric. Try-on photos (n = 1…5) change the
// wall, the skin tone, the pose and where the figure stands.
function person(seed: string, n: number): string {
  const { h, ground, motif } = fabric(seed)
  const wall = n === 0 ? '#EFE9DF' : WALLS[(n - 1) % WALLS.length]!
  const skin = SKINS[(h + n) % SKINS.length]!
  const shift = n === 0 ? 0 : [-14, 0, 12, -6, 8][(n - 1) % 5]!
  const handOnHip = n % 2 === 1
  const rightArm = handOnHip ? 'M107 68 124 98 110 120' : 'M107 68 118 128'
  const garment = 'M58 60Q80 55 102 60L114 78 106 84 111 172H49L54 84 46 78Z'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 200"><defs>${pattern(0.8, motif)}</defs>`
    + `<rect width="160" height="200" fill="${wall}"/><rect y="176" width="160" height="24" fill="#000" opacity=".06"/>`
    + `<g transform="translate(${shift} 0)">`
    + `<ellipse cx="80" cy="194" rx="34" ry="4" fill="#000" opacity=".12"/>`
    + `<rect x="64" y="168" width="12" height="26" rx="5" fill="#3A3330"/><rect x="84" y="168" width="12" height="26" rx="5" fill="#3A3330"/>`
    + `<path d="M53 68 42 128" stroke="${skin}" stroke-width="9" stroke-linecap="round" fill="none"/>`
    + `<path d="${rightArm}" stroke="${skin}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`
    + `<path d="${garment}" fill="${ground}"/><path d="${garment}" fill="url(#p)"/>`
    + `<rect x="75" y="50" width="10" height="11" fill="${skin}"/>`
    + `<circle cx="80" cy="35" r="16" fill="${HAIR}"/><circle cx="80" cy="40" r="13.5" fill="${skin}"/>`
    + `</g></svg>`
  return toUrl(svg)
}

// `n` numbers the try-on photos (1–5) so each looks different.
export function swatch(seed: string, variant: SwatchVariant = 'front', n = 1): string {
  if (variant === 'worn') return person(seed, 0)
  if (variant === 'tryon') return person(seed, Math.max(1, n))
  const { ground, motif } = fabric(seed)
  const scale = variant === 'detail' ? 2.4 : variant === 'back' ? 0.8 : 1
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 200"><defs>${pattern(scale, motif)}</defs><rect width="160" height="200" fill="${ground}"/><rect width="160" height="200" fill="url(#p)"/>${variant === 'back' ? `<rect y="150" width="160" height="50" fill="${ground}" opacity=".55"/>` : ''}</svg>`
  return toUrl(svg)
}
