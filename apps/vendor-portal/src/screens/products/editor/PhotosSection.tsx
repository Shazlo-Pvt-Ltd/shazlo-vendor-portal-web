import { Box, Button, ButtonBase, IconButton, LinearProgress, Link, ListItemIcon, Menu, MenuItem, Stack, Typography } from '@mui/material'
import { brand, neutral, radius, status } from '@shazlo/ui'
import { ArrowLeft, ArrowRight, Camera, ImageOff, ImagePlus, MoreHorizontal, Plus, Replace, Star, Trash2 } from 'lucide-react'
import { memo, useId, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import type { Schemas } from '../../../api/model'
import { useMoveProductImage, useRemoveProductImage } from '../../../api/queries'
import { catalogCopy } from '../../../copy/catalog'
import { productEditorCopy } from '../../../copy/productEditor'
import { srOnly } from '../../../lib/a11y'
import { MAX_EXTRA_PHOTOS, NAMED_PHOTO_ANGLES, TRYON_REQUIRED, type NamedPhotoAngle, type PhotoAngle } from '../../../lib/catalog'
import { EditorSection, firstEmptyTryonId, InlineProblem, slotId, type Problems } from './layout'
import { planPhotos, type PendingPhoto, type PhotoGroup, type PhotoUploads } from './usePhotoUploads'

const copy = productEditorCopy.photos
const REQUIRED_TOTAL = NAMED_PHOTO_ANGLES.length + TRYON_REQUIRED

type Image = Schemas['Product']['images'][number]
type Kind = 'named' | 'extra' | 'tryon'
type Target = { image: Image; name: string; kind: Kind }

const tile = { aspectRatio: '4 / 5', width: '100%', borderRadius: `${radius.card}px`, overflow: 'hidden', position: 'relative' } as const

function Slot({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <Box component="li" sx={{ minWidth: 0 }}>
      <Typography variant="body2" component="p" noWrap sx={{ mb: 0.75, color: 'text.secondary' }}>
        {label}
        {note && (
          <Box component="span" sx={{ color: neutral.ink }}>
            {' · '}
            {note}
          </Box>
        )}
      </Typography>
      {children}
    </Box>
  )
}

// An empty slot: a button that opens the photo picker for it. Required slots are outlined; one
// the seller was told to fill gets the error colour and says so to screen readers.
function EmptyTile({ id, name, required, flagged, disabled, readOnly, onPick }: { id?: string; name: string; required: boolean; flagged: boolean; disabled: boolean; readOnly: boolean; onPick: () => void }) {
  const missingId = useId()
  if (readOnly) {
    return (
      <Box sx={{ ...tile, display: 'grid', placeItems: 'center', bgcolor: neutral.canvas, border: `1.5px dashed ${neutral.line}`, color: neutral.inkSecondary }}>
        <Stack spacing={0.5} sx={{ alignItems: 'center' }}>
          <ImageOff size={18} strokeWidth={1.5} aria-hidden="true" />
          <Typography variant="caption">{copy.empty}</Typography>
        </Stack>
      </Box>
    )
  }
  return (
    <>
      <ButtonBase
        id={id}
        onClick={onPick}
        disabled={disabled}
        aria-label={copy.add(name)}
        aria-describedby={flagged ? missingId : undefined}
        sx={{
          ...tile,
          display: 'flex',
          flexDirection: 'column',
          gap: 0.5,
          bgcolor: neutral.canvas,
          color: flagged ? status.error : neutral.inkSecondary,
          border: flagged ? `2px solid ${status.error}` : `1.5px dashed ${required ? neutral.lineStrong : neutral.line}`,
          '@media (hover: hover)': { '&:hover': { bgcolor: neutral.placeholder } },
          '&.Mui-disabled': { opacity: 0.55 },
        }}
      >
        <Plus size={18} strokeWidth={1.5} aria-hidden="true" />
        <Typography variant="caption" component="span" color="inherit">
          {copy.addShort}
        </Typography>
      </ButtonBase>
      {flagged && (
        <Box component="span" id={missingId} sx={srOnly}>
          {copy.missing(name)}
        </Box>
      )}
    </>
  )
}

function ImageTile({ image, name, readOnly, onOptions }: { image: Image; name: string; readOnly: boolean; onOptions: (anchor: HTMLElement) => void }) {
  return (
    <Box sx={{ ...tile, bgcolor: neutral.placeholder, border: `1px solid ${neutral.line}` }}>
      <Box component="img" src={image.url} alt={name} loading="lazy" sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      {!readOnly && (
        <IconButton
          aria-label={copy.options(name)}
          aria-haspopup="menu"
          onClick={(event) => onOptions(event.currentTarget)}
          sx={{ position: 'absolute', top: 2, right: 2, width: 44, height: 44, bgcolor: neutral.surface, border: `1px solid ${neutral.line}`, color: neutral.ink, '@media (hover: hover)': { '&:hover': { bgcolor: neutral.surface } } }}
        >
          <MoreHorizontal size={18} strokeWidth={1.5} aria-hidden="true" />
        </IconButton>
      )}
    </Box>
  )
}

// A photo on its way up: its preview right away, then its own progress, or why it failed with
// Try again. The preview stays until the photo is added or the seller cancels it.
function PendingTile({ upload, name, onRetry, onDiscard }: { upload: PendingPhoto; name: string; onRetry: () => void; onDiscard: () => void }) {
  const failed = upload.state === 'failed'
  return (
    <>
      <Box aria-busy={!failed} sx={{ ...tile, bgcolor: neutral.placeholder, border: failed ? `2px solid ${status.error}` : `1px solid ${neutral.line}` }}>
        <Box component="img" src={upload.preview} alt="" sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: failed ? 0.4 : 0.6 }} />
        {!failed && (
          <Box sx={{ position: 'absolute', left: 0, right: 0, bottom: 0, bgcolor: neutral.surface, px: 1, py: 0.75 }}>
            <Typography variant="caption" component="p" sx={{ mb: 0.5 }}>
              {copy.states[upload.state as Exclude<PendingPhoto['state'], 'failed'>]}
            </Typography>
            <LinearProgress aria-label={copy.progress(name)} sx={{ height: 3, borderRadius: 2, bgcolor: neutral.placeholder, '& .MuiLinearProgress-bar': { bgcolor: brand.brown } }} />
          </Box>
        )}
      </Box>
      {failed && (
        <Box role="alert" sx={{ mt: 0.75 }}>
          <Typography variant="caption" component="p" sx={{ color: status.error }}>
            {copy.failed(upload.error ?? '')}
          </Typography>
          <Stack direction="row" sx={{ flexWrap: 'wrap', columnGap: 1 }}>
            <Button size="small" onClick={onRetry} aria-label={copy.retryLabel(name)} sx={{ minHeight: 44, px: 1, ml: -1 }}>
              {copy.retry}
            </Button>
            <Button size="small" color="inherit" onClick={onDiscard} aria-label={copy.discardLabel(name)} sx={{ minHeight: 44, px: 1 }}>
              {copy.discard}
            </Button>
          </Stack>
        </Box>
      )}
    </>
  )
}

function GroupHeader({ title, count, hint, children }: { title: string; count: string; hint: string; children?: ReactNode }) {
  return (
    <Box sx={{ mb: 2 }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
        <Typography variant="h3" component="h3">
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {count}
        </Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
        {hint}
      </Typography>
      {children && (
        <Stack direction="row" spacing={1} useFlexGap sx={{ mt: 1.5, flexWrap: 'wrap' }}>
          {children}
        </Stack>
      )}
    </Box>
  )
}

const grid = { listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 2, gridTemplateColumns: { xs: 'repeat(auto-fill, minmax(96px, 1fr))', sm: 'repeat(auto-fill, minmax(116px, 1fr))' } } as const

type Props = {
  productId: string | null
  images: Image[]
  uploads: PhotoUploads
  readOnly: boolean
  problems: Problems
  flagMissing: boolean
  idPrefix: string
  showCamera: boolean
  onAddName: () => void
  plain?: boolean
  lead?: ReactNode
}

export const PhotosSection = memo(function PhotosSection({ productId, images, uploads, readOnly, problems, flagMissing, idPrefix, showCamera, onAddName, plain, lead }: Props) {
  const move = useMoveProductImage(productId ?? '')
  const remove = useRemoveProductImage(productId ?? '')
  const [notice, setNotice] = useState<{ tone: 'error' | 'status'; text: string } | null>(null)
  const [menu, setMenu] = useState<{ anchor: HTMLElement; target: Target } | null>(null)
  const productInput = useRef<HTMLInputElement>(null)
  const tryonInput = useRef<HTMLInputElement>(null)
  const replaceInput = useRef<HTMLInputElement>(null)
  const productCamera = useRef<HTMLInputElement>(null)
  const tryonCamera = useRef<HTMLInputElement>(null)
  const start = useRef<PhotoAngle | null>(null)
  const replacing = useRef<NamedPhotoAngle | null>(null)

  const disabled = !productId
  const { pending } = uploads
  const pendingFor = (angle: PhotoAngle) => pending.filter((p) => p.angle === angle)
  const extras = images.filter((i) => i.angle === 'extra')
  const tryons = images.filter((i) => i.angle === 'tryon')
  const namedAdded = NAMED_PHOTO_ANGLES.filter((a) => images.some((i) => i.angle === a)).length
  const tryonAdded = Math.min(tryons.length, TRYON_REQUIRED)
  const flagNamed = flagMissing || Boolean(problems.photos)
  const flagTryon = flagMissing || Boolean(problems.tryon)

  function pick(group: PhotoGroup, files: File[], from: PhotoAngle | null) {
    if (!files.length) return
    const plan = planPhotos(files.length, group, images, pending, from)
    uploads.enqueue(plan.angles.map((angle, i) => ({ file: files[i]!, angle })))
    setNotice(plan.skipped ? { tone: 'error', text: copy.skipped(plan.skipped, plan.reason ?? '') } : null)
  }

  const filesOf = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    return files
  }

  const open = (input: HTMLInputElement | null, from: PhotoAngle | null) => {
    start.current = from
    input?.click()
  }

  async function act(run: () => Promise<unknown>, done: string) {
    setMenu(null)
    setNotice(null)
    try {
      await run()
      setNotice({ tone: 'status', text: done })
    } catch (error) {
      setNotice({ tone: 'error', text: copy.actionFailed(error instanceof Error ? error.message : '') })
    }
  }

  // Reordering without dragging (WCAG 2.5.7): the product photos sit in one row, Front first, then
  // Back, Detail, Worn and the extras. Moving swaps a photo with its neighbour slot; the API cannot
  // reorder two extras, so an extra moves left only from the first extra place, into Worn.
  function moves(target: Target): { left?: () => Promise<unknown>; right?: () => Promise<unknown> } {
    const { image } = target
    if (target.kind === 'tryon') return {}
    const to = (imageId: string, angle: PhotoAngle) => () => move.mutateAsync({ imageId, angle })
    if (target.kind === 'extra') return extras[0]?.id === image.id ? { left: to(image.id, 'worn') } : {}
    const i = NAMED_PHOTO_ANGLES.indexOf(image.angle as NamedPhotoAngle)
    const left = i > 0 ? to(image.id, NAMED_PHOTO_ANGLES[i - 1]!) : undefined
    const right = i < NAMED_PHOTO_ANGLES.length - 1 ? to(image.id, NAMED_PHOTO_ANGLES[i + 1]!) : extras[0] ? to(extras[0].id, 'worn') : undefined
    return { left, right }
  }

  const options = (target: Target) => (anchor: HTMLElement) => setMenu({ anchor, target })
  const menuTarget = menu?.target
  const menuMoves = menuTarget ? moves(menuTarget) : {}

  function slotContent(name: string, image: Image | undefined, upload: PendingPhoto | undefined, kind: Kind, empty: ReactNode) {
    if (upload) return <PendingTile upload={upload} name={name} onRetry={() => uploads.retry(upload.key)} onDiscard={() => uploads.discard(upload.key)} />
    if (image) return <ImageTile image={image} name={name} readOnly={readOnly} onOptions={options({ image, name, kind })} />
    return empty
  }

  const groupButtons = (group: PhotoGroup) =>
    readOnly ? null : (
      <>
        <Button variant="outlined" disabled={disabled} onClick={() => open(group === 'product' ? productInput.current : tryonInput.current, null)} startIcon={<ImagePlus size={18} strokeWidth={1.5} aria-hidden="true" />} sx={{ minHeight: 44 }}>
          {group === 'product' ? copy.choose : copy.chooseTryon}
        </Button>
        {showCamera && (
          <Button
            variant="outlined"
            disabled={disabled}
            aria-label={group === 'product' ? copy.takeProduct : copy.takeTryon}
            onClick={() => (group === 'product' ? productCamera : tryonCamera).current?.click()}
            startIcon={<Camera size={18} strokeWidth={1.5} aria-hidden="true" />}
            sx={{ minHeight: 44 }}
          >
            {copy.take}
          </Button>
        )}
      </>
    )

  // ---- product photos: Front, Back, Detail, Worn, then up to 4 extras --------------------------
  const extraUploads = pendingFor('extra')
  const extraSlots = extras.length + extraUploads.length
  const productTiles = [
    ...NAMED_PHOTO_ANGLES.map((angle) => {
      const label = catalogCopy.photoSlots[angle]
      const name = copy.named(label)
      const image = images.find((i) => i.angle === angle)
      const upload = pendingFor(angle).at(-1)
      const empty = <EmptyTile id={slotId(idPrefix, angle)} name={name} required flagged={flagNamed && !image} disabled={disabled} readOnly={readOnly} onPick={() => open(productInput.current, angle)} />
      return (
        <Slot key={angle} label={label} note={angle === 'front' ? copy.main : undefined}>
          {slotContent(name, image, upload, 'named', empty)}
        </Slot>
      )
    }),
    ...extras.map((image, i) => (
      <Slot key={image.id} label={copy.extra(i + 1)}>
        {slotContent(copy.extraName(i + 1), image, undefined, 'extra', null)}
      </Slot>
    )),
    ...extraUploads.map((upload, i) => (
      <Slot key={upload.key} label={copy.extra(extras.length + i + 1)}>
        {slotContent(copy.extraName(extras.length + i + 1), undefined, upload, 'extra', null)}
      </Slot>
    )),
  ]
  if (!readOnly && extraSlots < MAX_EXTRA_PHOTOS) {
    productTiles.push(
      <Slot key="add-extra" label={copy.extra(extraSlots + 1)}>
        <ButtonBase
          onClick={() => open(productInput.current, 'extra')}
          disabled={disabled}
          aria-label={copy.addExtra}
          sx={{ ...tile, display: 'flex', flexDirection: 'column', gap: 0.5, color: neutral.inkSecondary, border: `1.5px dashed ${neutral.line}`, '@media (hover: hover)': { '&:hover': { bgcolor: neutral.placeholder } }, '&.Mui-disabled': { opacity: 0.55 } }}
        >
          <Plus size={18} strokeWidth={1.5} aria-hidden="true" />
          <Typography variant="caption" component="span" color="inherit">
            {copy.addShort}
          </Typography>
        </ButtonBase>
      </Slot>,
    )
  }

  // ---- try-on photos: 5 slots ------------------------------------------------------------------
  const tryonUploads = pendingFor('tryon')
  const tryonTiles: ReactNode[] = [
    ...tryons.map((image, i) => (
      <Slot key={image.id} label={copy.tryon(i + 1)}>
        {slotContent(copy.tryonName(i + 1), image, undefined, 'tryon', null)}
      </Slot>
    )),
    ...tryonUploads.map((upload, i) => (
      <Slot key={upload.key} label={copy.tryon(tryons.length + i + 1)}>
        {slotContent(copy.tryonName(tryons.length + i + 1), undefined, upload, 'tryon', null)}
      </Slot>
    )),
  ]
  for (let n = tryons.length + tryonUploads.length + 1; n <= TRYON_REQUIRED; n++) {
    const first = n === tryons.length + tryonUploads.length + 1
    tryonTiles.push(
      <Slot key={`tryon-empty-${n}`} label={copy.tryon(n)}>
        <EmptyTile id={first ? firstEmptyTryonId(idPrefix) : undefined} name={copy.tryonName(n)} required flagged={flagTryon} disabled={disabled} readOnly={readOnly} onPick={() => open(tryonInput.current, null)} />
      </Slot>,
    )
  }

  const action = (
    <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
      {copy.added(namedAdded + tryonAdded, REQUIRED_TOTAL)}
    </Typography>
  )

  return (
    <EditorSection title={copy.title} action={action} plain={plain}>
      {lead}
      {disabled && !readOnly && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {copy.needsName}{' '}
          <Link component="button" type="button" variant="body2" onClick={onAddName} sx={{ verticalAlign: 'baseline' }}>
            {copy.needsNameLink}
          </Link>
        </Typography>
      )}

      <Box>
        <GroupHeader title={copy.productGroup} count={copy.added(namedAdded, NAMED_PHOTO_ANGLES.length)} hint={copy.productHint}>
          {groupButtons('product')}
        </GroupHeader>
        <Box component="ul" role="list" aria-label={copy.productGroup} sx={grid}>
          {productTiles}
        </Box>
        {problems.photos && <InlineProblem>{problems.photos}</InlineProblem>}
      </Box>

      <Box sx={{ mt: 4 }}>
        <GroupHeader title={copy.tryonGroup} count={copy.added(tryonAdded, TRYON_REQUIRED)} hint={copy.tryonHint}>
          {groupButtons('tryon')}
        </GroupHeader>
        <Box component="ul" role="list" aria-label={copy.tryonGroup} sx={grid}>
          {tryonTiles}
        </Box>
        {problems.tryon && <InlineProblem>{problems.tryon}</InlineProblem>}
      </Box>

      {notice?.tone === 'error' && (
        <Typography role="alert" variant="body2" sx={{ color: status.error, mt: 2 }}>
          {notice.text}
        </Typography>
      )}
      <Box role="status" sx={srOnly}>
        {notice?.tone === 'status' ? notice.text : ''}
      </Box>
      <Typography variant="caption" component="p" color="text.secondary" sx={{ mt: 2.5, maxWidth: '68ch' }}>
        {copy.helper}
      </Typography>

      {!readOnly && (
        <>
          <input ref={productInput} type="file" hidden accept="image/*" multiple aria-label={copy.inputs.product} onChange={(event) => pick('product', filesOf(event), start.current)} />
          <input ref={tryonInput} type="file" hidden accept="image/*" multiple aria-label={copy.inputs.tryon} onChange={(event) => pick('tryon', filesOf(event), null)} />
          <input
            ref={replaceInput}
            type="file"
            hidden
            accept="image/*"
            aria-label={copy.inputs.slot}
            onChange={(event) => {
              const [file] = filesOf(event)
              if (file && replacing.current) uploads.enqueue([{ file, angle: replacing.current }])
            }}
          />
          {/* "Take photo" opens the camera; the pickers above keep the gallery (no capture). */}
          {showCamera && (
            <>
              <input ref={productCamera} type="file" hidden accept="image/*" capture="environment" aria-label={copy.inputs.productCamera} onChange={(event) => pick('product', filesOf(event), null)} />
              <input ref={tryonCamera} type="file" hidden accept="image/*" capture="environment" aria-label={copy.inputs.tryonCamera} onChange={(event) => pick('tryon', filesOf(event), null)} />
            </>
          )}
        </>
      )}

      <Menu anchorEl={menu?.anchor ?? null} open={Boolean(menu)} onClose={() => setMenu(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        {menuTarget && [
          menuTarget.kind !== 'tryon' && menuTarget.image.angle !== 'front' && (
            <MenuItem key="main" onClick={() => void act(() => move.mutateAsync({ imageId: menuTarget.image.id, angle: 'front' }), copy.moved)}>
              <ListItemIcon>
                <Star size={16} strokeWidth={1.5} aria-hidden="true" />
              </ListItemIcon>
              {copy.makeMain}
            </MenuItem>
          ),
          menuMoves.left && (
            <MenuItem key="left" onClick={() => void act(menuMoves.left!, copy.moved)}>
              <ListItemIcon>
                <ArrowLeft size={16} strokeWidth={1.5} aria-hidden="true" />
              </ListItemIcon>
              {copy.moveLeft}
            </MenuItem>
          ),
          menuMoves.right && (
            <MenuItem key="right" onClick={() => void act(menuMoves.right!, copy.moved)}>
              <ListItemIcon>
                <ArrowRight size={16} strokeWidth={1.5} aria-hidden="true" />
              </ListItemIcon>
              {copy.moveRight}
            </MenuItem>
          ),
          menuTarget.kind === 'named' && (
            <MenuItem
              key="replace"
              onClick={() => {
                replacing.current = menuTarget.image.angle as NamedPhotoAngle
                setMenu(null)
                replaceInput.current?.click()
              }}
            >
              <ListItemIcon>
                <Replace size={16} strokeWidth={1.5} aria-hidden="true" />
              </ListItemIcon>
              {copy.replace}
            </MenuItem>
          ),
          <MenuItem key="remove" onClick={() => void act(() => remove.mutateAsync(menuTarget.image.id), copy.removed(menuTarget.name))}>
            <ListItemIcon>
              <Trash2 size={16} strokeWidth={1.5} aria-hidden="true" />
            </ListItemIcon>
            {copy.remove}
          </MenuItem>,
        ]}
      </Menu>
    </EditorSection>
  )
})
