import type { Schemas } from '../../../api/model'
import { productEditorCopy } from '../../../copy/productEditor'
import { formatINR } from '../../../lib/format'
import { coloursFor, parseRupees, sortRows, stockOf, type EditorValues } from './form'

const copy = productEditorCopy.revision
const SHORT = 60

export type RevisionField = keyof typeof copy.labels
export interface RevisionChange {
  field: RevisionField
  label: string
  live: string
  yours: string
  // Colour changes, for their swatches.
  colours?: { live: string[]; yours: string[] }
}

const orNone = (text: string) => text.trim() || copy.none
const short = (text: string) => {
  const t = text.trim().replace(/\s+/g, ' ')
  return t.length > SHORT ? `${t.slice(0, SHORT - 1).trimEnd()}…` : orNone(t)
}
const money = (paise: number | null) => (paise ? formatINR(paise) : copy.none)
const sizesText = (rows: { size: string; stock: number }[]) => orNone(rows.map((r) => `${r.size} ${r.stock}`).join(' · '))

/**
 * What the seller has changed from the live version, field by field, in the order of the form
 * (main's revision panel, kept short for a side card). A price typed another way ("₹1299.00") is
 * no change; a price that does not read as one is shown as typed.
 */
export function revisionChanges(live: Schemas['ProductVersion'], values: EditorValues, images: readonly Schemas['Product']['images'][number][]): RevisionChange[] {
  const price = (text: string, fallback: string) => {
    const parsed = parseRupees(text)
    return parsed.ok ? money(parsed.paise) : orNone(fallback)
  }
  const sizes = sortRows(values.sizes).map((r) => ({ size: r.size, stock: stockOf(r.stock) }))
  const sameImages = images.length === live.images.length && images.every((i) => live.images.some((l) => l.id === i.id && l.angle === i.angle))
  // As they will be saved: tidied, and a colour that is not one stays as it is live.
  const colours = coloursFor(values, { mainColour: live.main_colour, otherColours: live.other_colours })
  const pairs: [RevisionField, string, string][] = [
    ['title', orNone(live.title), orNone(values.title)],
    ['category', live.category ?? copy.none, values.category || copy.none],
    ['gender', live.gender ?? copy.none, values.gender || copy.none],
    ['colour', live.main_colour ?? copy.none, colours.main ?? copy.none],
    ['colours', orNone(live.other_colours.join(', ')), orNone(colours.others.join(', '))],
    ['material', orNone(live.material), orNone(values.material)],
    ['description', short(live.description), short(values.description)],
    ['sizes', sizesText(live.variants), sizesText(sizes)],
    ['price', money(live.price_paise), price(values.price, values.price)],
    ['mrp', money(live.mrp_paise), price(values.mrp, values.mrp)],
    ['photos', copy.photos(live.images.length), sameImages ? copy.photos(live.images.length) : images.length === live.images.length ? copy.photosChanged(images.length) : copy.photos(images.length)],
  ]
  const swatches: Partial<Record<RevisionField, { live: string[]; yours: string[] }>> = {
    colour: { live: live.main_colour ? [live.main_colour] : [], yours: colours.main ? [colours.main] : [] },
    colours: { live: live.other_colours, yours: colours.others },
  }
  return pairs
    .filter(([, a, b]) => a !== b)
    .map(([field, a, b]) => ({ field, label: copy.labels[field], live: a, yours: b, ...(swatches[field] ? { colours: swatches[field] } : {}) }))
}
