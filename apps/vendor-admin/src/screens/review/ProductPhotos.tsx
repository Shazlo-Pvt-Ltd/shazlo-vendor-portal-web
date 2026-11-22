import { Box, ButtonBase, Stack, Typography } from '@mui/material'
import { brand, neutral, radius, SectionCard, status } from '@shazlo/ui'
import { ImageOff, Images } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import type { components } from '../../api/schema'
import { CardTitle } from '../../components/CardTitle'
import { reviewCopy, type Slot } from '../../copy/review'
import { srOnly } from '../../lib/a11y'

const copy = reviewCopy.product.photos
type Version = components['schemas']['ProductVersion']
// Spec §7: four named product photos and five try-on photos are required.
const REQUIRED: Slot[] = ['front', 'back', 'detail', 'worn']
export const TRY_ONS = 5
const THUMB = { width: 72, height: 90 } as const

// "Front", "Back", "Extra", "Extra 2": a name per photo, numbering repeated slots.
export function photoNames(photos: Version['photos']): string[] {
  const seen = new Map<Slot, number>()
  return photos.map((photo) => {
    const n = (seen.get(photo.slot) ?? 0) + 1
    seen.set(photo.slot, n)
    return n > 1 ? `${copy.slot[photo.slot]} ${n}` : copy.slot[photo.slot]
  })
}

type Shown = { key: string; url: string; name: string; isNew: boolean }

// Both groups in one list, so one photo at a time is large. A photo is new when the compared
// version had no photo of that name (product) or fewer try-on photos.
function shownPhotos(version: Version, compareTo: Version | null) {
  const names = photoNames(version.photos)
  const before = new Set(compareTo ? photoNames(compareTo.photos) : [])
  const product: Shown[] = version.photos.map((p, i) => ({ key: `p-${p.id}`, url: p.url, name: names[i]!, isNew: compareTo !== null && !before.has(names[i]!) }))
  const tryOn: Shown[] = version.try_on_photos.map((p, i) => ({ key: `t-${p.id}`, url: p.url, name: copy.tryOnName(i + 1), isNew: compareTo !== null && i >= compareTo.try_on_photos.length }))
  return { product, tryOn }
}

function NewTag({ id }: { id: string }) {
  return (
    <Box id={id} component="span" sx={{ position: 'absolute', top: 4, left: 4, px: 0.75, borderRadius: `${radius.pill}px`, bgcolor: brand.cream, color: brand.brown, typography: 'caption', lineHeight: '18px' }}>
      <span aria-hidden="true">{copy.newTag}</span>
      <Box component="span" sx={srOnly}>
        {copy.newDescription}
      </Box>
    </Box>
  )
}

function Thumb({ photo, selected, onSelect }: { photo: Shown; selected: boolean; onSelect: () => void }) {
  const tagId = useId()
  return (
    <ButtonBase
      onClick={onSelect}
      aria-label={copy.show(photo.name)}
      aria-pressed={selected}
      aria-describedby={photo.isNew ? tagId : undefined}
      sx={{
        ...THUMB,
        position: 'relative',
        borderRadius: `${radius.control}px`,
        overflow: 'hidden',
        bgcolor: neutral.placeholder,
        outline: selected ? `2px solid ${brand.brown}` : `1px solid ${neutral.line}`,
        outlineOffset: selected ? 2 : 0,
        '&.Mui-focusVisible': { outline: `2px solid ${neutral.ink}`, outlineOffset: 2 },
      }}
    >
      <Box component="img" src={photo.url} alt="" sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      {photo.isNew && <NewTag id={tagId} />}
    </ButtonBase>
  )
}

function MissingSlot({ name }: { name: string }) {
  return (
    <Box sx={{ ...THUMB, borderRadius: `${radius.control}px`, border: `1px dashed ${status.error}`, color: status.error, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 0.5, px: 0.5, textAlign: 'center' }}>
      <ImageOff size={16} strokeWidth={1.75} aria-hidden="true" />
      <Typography variant="caption" component="span" sx={{ lineHeight: 1.2, color: 'inherit' }}>
        {copy.missing(name)}
      </Typography>
    </Box>
  )
}

// A named group of thumbnails with how many it has of how many it needs, and what is missing.
function PhotoGroup({ title, count, hint, note, children }: { title: string; count: string; hint?: string; note: string | null; children: ReactNode }) {
  const id = useId()
  return (
    <Box role="group" aria-labelledby={id}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
        <Typography id={id} variant="h3" component="h3">
          {title}
        </Typography>
        <Typography variant="body2" component="span" sx={{ color: note ? status.error : 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
          {count}
        </Typography>
      </Stack>
      {hint && (
        <Typography variant="body2" color="textSecondary" sx={{ mt: 0.25 }}>
          {hint}
        </Typography>
      )}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mt: 1.25 }}>{children}</Box>
      {note && (
        <Typography variant="body2" sx={{ color: status.error, mt: 1.25, maxWidth: '44ch' }}>
          {note}
        </Typography>
      )}
    </Box>
  )
}

// The submitted photos: a large 4:5 photo, then the product photos (front, back, detail, worn and
// extras) and the try-on photos (real people wearing it), each named. Photos added since the
// compared version get a "New" tag; every missing required photo is flagged.
export function ProductPhotos({ title, version, compareTo }: { title: string; version: Version; compareTo: Version | null }) {
  const { product, tryOn } = shownPhotos(version, compareTo)
  const all = [...product, ...tryOn]
  const [selected, setSelected] = useState(all[0]?.key ?? '')
  const current = all.find((p) => p.key === selected) ?? all[0]

  const present = new Set(version.photos.map((p) => p.slot))
  const missing = REQUIRED.filter((slot) => !present.has(slot))
  const extras = version.photos.filter((p) => p.slot === 'extra').length
  const tryOnCount = Math.min(version.try_on_photos.length, TRY_ONS)
  const tryOnMissing = TRY_ONS - tryOnCount

  return (
    <SectionCard title={<CardTitle icon={Images}>{copy.title}</CardTitle>}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2.5} sx={{ alignItems: 'flex-start' }}>
        <Box sx={{ width: { xs: '100%', sm: 280 }, maxWidth: 360, flexShrink: 0, aspectRatio: '4 / 5', borderRadius: `${radius.card}px`, overflow: 'hidden', bgcolor: neutral.placeholder, display: 'grid', placeItems: 'center', color: neutral.inkSecondary }}>
          {current ? (
            <Box component="img" src={current.url} alt={copy.alt(current.name, title)} sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          ) : (
            <Typography variant="body2">{copy.none}</Typography>
          )}
        </Box>
        <Stack spacing={3} sx={{ minWidth: 0 }}>
          <PhotoGroup
            title={copy.product}
            count={`${copy.count(REQUIRED.length - missing.length, REQUIRED.length)}${extras ? copy.extras(extras) : ''}`}
            note={missing.length ? copy.missingProduct(missing.map((slot) => copy.slot[slot])) : null}
          >
            {product.map((photo) => (
              <Thumb key={photo.key} photo={photo} selected={photo.key === current?.key} onSelect={() => setSelected(photo.key)} />
            ))}
            {missing.map((slot) => (
              <MissingSlot key={slot} name={copy.slot[slot]} />
            ))}
          </PhotoGroup>
          <PhotoGroup title={copy.tryOn} count={copy.count(tryOnCount, TRY_ONS)} hint={copy.tryOnHint} note={tryOnMissing ? copy.missingTryOn(tryOnMissing) : null}>
            {tryOn.map((photo) => (
              <Thumb key={photo.key} photo={photo} selected={photo.key === current?.key} onSelect={() => setSelected(photo.key)} />
            ))}
            {Array.from({ length: tryOnMissing }, (_, i) => (
              <MissingSlot key={i} name={copy.tryOnName(tryOnCount + i + 1)} />
            ))}
          </PhotoGroup>
        </Stack>
      </Stack>
    </SectionCard>
  )
}
