import { isNamedAngle, matchPhotoFile, MAX_EXTRA_PHOTOS, MAX_TRYON_PHOTOS, NAMED_PHOTO_ANGLES, type PhotoAngle } from '../../lib/catalog'

// Photos picked after a bulk import, matched to the new drafts by name (matchPhotoFile) and given
// a slot. The drafts start with no photos, so the slots taken are the ones planned here.

export type Draft = { id: string; title: string }
export type Planned = { file: File; product: Draft; angle: PhotoAngle }
export type PhotoPlan = { matched: Planned[]; unmatched: File[]; noRoom: { file: File; product: Draft }[] }

// A folder holds other things too (.DS_Store, notes): only photos count.
export const isPhotoFile = (file: File) => file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)

type Used = { named: Set<PhotoAngle>; extra: number; tryon: number }

// Files that name their slot ("… - back.jpg") are placed first; the rest fill each product's empty
// named slots in order (front, back, detail, worn), then its extra slots. A named slot already
// planned is not taken twice. Try-on photos must say "tryon". `before` is what earlier batches
// planned.
export function planImportPhotos(files: readonly File[], products: readonly Draft[], before: readonly Planned[] = []): PhotoPlan {
  const used = new Map<string, Used>()
  const usedOf = (id: string) => {
    let u = used.get(id)
    if (!u) {
      u = { named: new Set(), extra: 0, tryon: 0 }
      used.set(id, u)
    }
    return u
  }
  const take = (id: string, angle: PhotoAngle) => {
    const u = usedOf(id)
    if (isNamedAngle(angle)) u.named.add(angle)
    else if (angle === 'extra') u.extra += 1
    else u.tryon += 1
  }
  for (const p of before) take(p.product.id, p.angle)

  const plan: PhotoPlan = { matched: [], unmatched: [], noRoom: [] }
  const loose: { file: File; product: Draft }[] = []
  const place = (file: File, product: Draft, angle: PhotoAngle) => {
    take(product.id, angle)
    plan.matched.push({ file, product, angle })
  }

  for (const file of files) {
    const hit = matchPhotoFile(file.name, products)
    if (!hit) {
      plan.unmatched.push(file)
      continue
    }
    const u = usedOf(hit.product.id)
    const { angle } = hit
    if (angle && isNamedAngle(angle) && !u.named.has(angle)) place(file, hit.product, angle)
    else if (angle === 'tryon') {
      if (u.tryon < MAX_TRYON_PHOTOS) place(file, hit.product, 'tryon')
      else plan.noRoom.push({ file, product: hit.product })
    } else if (angle === 'extra' && u.extra < MAX_EXTRA_PHOTOS) place(file, hit.product, 'extra')
    else loose.push({ file, product: hit.product })
  }

  for (const { file, product } of loose) {
    const u = usedOf(product.id)
    const named = NAMED_PHOTO_ANGLES.find((a) => !u.named.has(a))
    if (named) place(file, product, named)
    else if (u.extra < MAX_EXTRA_PHOTOS) place(file, product, 'extra')
    else plan.noRoom.push({ file, product })
  }
  return plan
}
