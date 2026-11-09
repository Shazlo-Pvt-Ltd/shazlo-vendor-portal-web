import { Box, ButtonBase, Stack, Typography } from '@mui/material'
import { brand, neutral, radius, SectionCard, status } from '@shazlo/ui'
import { ImageOff } from 'lucide-react'
import { useId, useState } from 'react'
import type { components } from '../../api/schema'
import { reviewCopy, type Angle } from '../../copy/review'
import { srOnly } from '../../lib/a11y'

const copy = reviewCopy.product.photos
type Version = components['schemas']['ProductVersion']
const REQUIRED: Angle[] = ['front', 'back', 'closeup']
const THUMB = { width: 72, height: 90 } as const

// "front", "back", "extra", "extra 2": a name per photo, numbering repeated angles.
export function photoNames(images: Version['images']): string[] {
  const seen = new Map<Angle, number>()
  return images.map((img) => {
    const n = (seen.get(img.angle) ?? 0) + 1
    seen.set(img.angle, n)
    return n > 1 ? `${copy.angle[img.angle]} ${n}` : copy.angle[img.angle]
  })
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

function Thumb({ src, name, selected, isNew, onSelect }: { src: string; name: string; selected: boolean; isNew: boolean; onSelect: () => void }) {
  const tagId = useId()
  return (
    <ButtonBase
      onClick={onSelect}
      aria-label={copy.show(name)}
      aria-pressed={selected}
      aria-describedby={isNew ? tagId : undefined}
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
      <Box component="img" src={src} alt="" sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      {isNew && <NewTag id={tagId} />}
    </ButtonBase>
  )
}

function MissingSlot({ angle }: { angle: Angle }) {
  return (
    <Box sx={{ ...THUMB, borderRadius: `${radius.control}px`, border: `1px dashed ${status.error}`, color: status.error, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 0.5, px: 0.5, textAlign: 'center' }}>
      <ImageOff size={16} strokeWidth={1.5} aria-hidden="true" />
      <Typography variant="caption" component="span" sx={{ lineHeight: 1.2, color: 'inherit' }}>
        {copy.missing(copy.angle[angle])}
      </Typography>
    </Box>
  )
}

// The submitted photos: a large 4:5 photo and a strip of thumbnails that choose it. Angles added
// since the compared version get a "New" tag; a missing front, back or close-up is flagged.
export function ProductPhotos({ title, version, compareTo }: { title: string; version: Version; compareTo: Version | null }) {
  const [selected, setSelected] = useState(0)
  const images = version.images
  const names = photoNames(images)
  const before = new Set(compareTo?.images.map((i) => i.angle) ?? [])
  const present = new Set(images.map((i) => i.angle))
  const missing = REQUIRED.filter((a) => !present.has(a))
  const current = images[Math.min(selected, images.length - 1)]
  const currentName = names[Math.min(selected, images.length - 1)]

  return (
    <SectionCard title={copy.title}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2.5} sx={{ alignItems: 'flex-start' }}>
        <Box sx={{ width: { xs: '100%', sm: 320 }, maxWidth: 360, flexShrink: 0, aspectRatio: '4 / 5', borderRadius: `${radius.card}px`, overflow: 'hidden', bgcolor: neutral.placeholder, display: 'grid', placeItems: 'center', color: neutral.inkSecondary }}>
          {current && currentName ? (
            <Box component="img" src={current.url} alt={copy.alt(currentName, title)} sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          ) : (
            <Typography variant="body2">{copy.none}</Typography>
          )}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
            {images.map((img, i) => (
              <Thumb key={img.id} src={img.url} name={names[i]!} selected={i === selected} isNew={compareTo !== null && !before.has(img.angle)} onSelect={() => setSelected(i)} />
            ))}
            {missing.map((angle) => (
              <MissingSlot key={angle} angle={angle} />
            ))}
          </Box>
          {missing.length > 0 && (
            <Typography variant="body2" sx={{ color: status.error, mt: 1.5, maxWidth: '40ch' }}>
              {copy.missingNote(missing.map((a) => copy.angle[a]))}
            </Typography>
          )}
        </Box>
      </Stack>
    </SectionCard>
  )
}
