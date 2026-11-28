import { demoPhotoPalette as P } from '@shazlo/ui'

// Stand-in product photos for the demo and the tests: small SVG block-print swatches in
// natural-dye colours, generated from a seed so every product keeps the same look. Worn and try-on
// photos put the same fabric on a simple figure. They are served as `blob:` URLs: the portal's
// content policy allows images only from itself, `blob:` and Cloudinary, never `data:`.

export type SwatchVariant = 'front' | 'back' | 'detail' | 'worn' | 'extra' | 'tryon'

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

const pick = <T>(list: readonly T[], n: number): T => list[n % list.length]!

const MOTIFS = [
  (c: string) => `<circle cx="10" cy="10" r="4" fill="none" stroke="${c}" stroke-width="1.6"/><circle cx="10" cy="10" r="1.2" fill="${c}"/>`,
  (c: string) => `<path d="M10 3 17 10 10 17 3 10Z" fill="none" stroke="${c}" stroke-width="1.4"/><path d="M10 7.5 12.5 10 10 12.5 7.5 10Z" fill="${c}"/>`,
  (c: string) => `<path d="M10 2c2 4 2 4 6 6-4 2-4 2-6 6-2-4-2-4-6-6 4-2 4-2 6-6Z" fill="${c}" opacity=".9"/>`,
  (c: string) => `<path d="M0 10h20M10 0v20" stroke="${c}" stroke-width="1" opacity=".7"/><circle cx="10" cy="10" r="2.4" fill="${c}"/>`,
]

function fabric(seed: string) {
  const h = hash(seed)
  const ground = pick(P.grounds, h)
  const inks = (P.lightGrounds as readonly string[]).includes(ground) ? P.darkInks : P.lightInks
  const ink = pick(inks, h >>> 3)
  const motif = pick(MOTIFS, h >>> 6)(ink)
  return { h, ground, motif }
}

const pattern = (scale: number, motif: string) =>
  `<pattern id="p" width="${20 * scale}" height="${20 * scale}" patternUnits="userSpaceOnUse"><g transform="scale(${scale})">${motif}</g></pattern>`

// A figure in a kurta-shaped garment cut from the fabric. Try-on photos (n = 1…5) change the wall,
// the skin tone, the pose and where the figure stands.
function person(seed: string, n: number): string {
  const { h, ground, motif } = fabric(seed)
  const wall = n === 0 ? P.studioWall : pick(P.walls, n - 1)
  const skin = pick(P.skins, h + n)
  const shift = n === 0 ? 0 : pick([-14, 0, 12, -6, 8], n - 1)
  const rightArm = n % 2 === 1 ? 'M107 68 124 98 110 120' : 'M107 68 118 128'
  const garment = 'M58 60Q80 55 102 60L114 78 106 84 111 172H49L54 84 46 78Z'
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 200"><defs>${pattern(0.8, motif)}</defs>`
    + `<rect width="160" height="200" fill="${wall}"/><rect y="176" width="160" height="24" fill="${P.shade}" opacity=".06"/>`
    + `<g transform="translate(${shift} 0)">`
    + `<ellipse cx="80" cy="194" rx="34" ry="4" fill="${P.shade}" opacity=".12"/>`
    + `<rect x="64" y="168" width="12" height="26" rx="5" fill="${P.legs}"/><rect x="84" y="168" width="12" height="26" rx="5" fill="${P.legs}"/>`
    + `<path d="M53 68 42 128" stroke="${skin}" stroke-width="9" stroke-linecap="round" fill="none"/>`
    + `<path d="${rightArm}" stroke="${skin}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`
    + `<path d="${garment}" fill="${ground}"/><path d="${garment}" fill="url(#p)"/>`
    + `<rect x="75" y="50" width="10" height="11" fill="${skin}"/>`
    + `<circle cx="80" cy="35" r="16" fill="${P.hair}"/><circle cx="80" cy="40" r="13.5" fill="${skin}"/>`
    + `</g></svg>`
}

/** The SVG text of a stand-in photo. `n` numbers the try-on photos (1–5) so each looks different. */
export function swatchSvg(seed: string, variant: SwatchVariant = 'front', n = 1): string {
  if (variant === 'worn') return person(seed, 0)
  if (variant === 'tryon') return person(seed, Math.max(1, n))
  const { ground, motif } = fabric(seed)
  const scale = variant === 'detail' ? 2.4 : variant === 'back' ? 0.8 : 1
  const band = variant === 'back' ? `<rect y="150" width="160" height="50" fill="${ground}" opacity=".55"/>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 200"><defs>${pattern(scale, motif)}</defs><rect width="160" height="200" fill="${ground}"/><rect width="160" height="200" fill="url(#p)"/>${band}</svg>`
}

// One object URL per photo for the life of the page: the demo database is rebuilt on reset, the
// photos are not.
const urls = new Map<string, string>()

/** A `blob:` URL for a stand-in photo. */
export function swatch(seed: string, variant: SwatchVariant = 'front', n = 1): string {
  const key = `${seed}|${variant}|${n}`
  let url = urls.get(key)
  if (url === undefined) {
    url = URL.createObjectURL(new Blob([swatchSvg(seed, variant, n)], { type: 'image/svg+xml' }))
    urls.set(key, url)
  }
  return url
}
