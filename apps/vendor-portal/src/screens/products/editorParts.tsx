// V-07 / V-07m building blocks: photo slots, money fields, sizes and stock, side cards.
import Popover from '@mui/material/Popover'
import { styled } from '@mui/material/styles'
import { useRef, useState, type ChangeEvent, type CSSProperties, type DragEvent, type ReactNode } from 'react'
import {
  Button, Card, Checkbox, Icon, IconButton, ImagePlaceholder, kit, Select, Skeleton, Table, Text, TextInput, textStyle,
} from '@shazlo/ui/components'
import type { ProductImage, SizeStock } from '../../api'
import type { ProductEvent } from '../../api/mock'
import { useProductHistory } from '../../api/hooks'
import { payout, rupees } from '../../lib/format'
import { hasPhoto, historyTime } from './shared'

/* ---------- photos ---------- */

export const REQUIRED_SLOTS = ['front', 'back', 'detail'] as const
export const MAX_PHOTOS = 8
const ACCEPT = 'image/jpeg,image/png,image/webp'
const MAX_BYTES = 10 * 1024 * 1024
const MIN_LONG_SIDE = 1200

export const slotName: Record<ProductImage['slot'], string> = { front: 'front', back: 'back', detail: 'fabric close-up', extra: 'extra' }
const slotLabel = (slot: ProductImage['slot'], mobile: boolean) =>
  ({ front: 'Front', back: 'Back', detail: mobile ? 'Close-up' : 'Fabric close-up', extra: 'Extra' })[slot]

/** Front, back and close-up always exist (empty or filled), in that order, before any extras. */
export function normaliseImages(images: ProductImage[], seed: string): ProductImage[] {
  const required = REQUIRED_SLOTS.map(slot => images.find(i => i.slot === slot) ?? { id: `${seed}-${slot}`, slot })
  return [...required, ...images.filter(i => i.slot === 'extra')]
}

/** Long side of an image, or null when the browser can't tell quickly (the server checks again). */
function longSide(url: string): Promise<number | null> {
  return new Promise(resolve => {
    const img = new Image()
    const timer = window.setTimeout(() => resolve(null), 2500)
    img.onload = () => { window.clearTimeout(timer); resolve(Math.max(img.naturalWidth, img.naturalHeight) || null) }
    img.onerror = () => { window.clearTimeout(timer); resolve(null) }
    img.src = url
  })
}

/** Checks a picked file and returns an object URL for it (the mock keeps the URL; production uploads to Cloudinary). */
export async function readPhoto(file: File): Promise<{ url: string; name: string } | { error: string }> {
  if (!ACCEPT.split(',').includes(file.type)) {
    const ext = file.name.split('.').pop()?.toUpperCase() ?? 'this'
    return { error: `${file.name} is a ${ext} file. Use a JPG, PNG or WebP photo.` }
  }
  if (file.size > MAX_BYTES) return { error: `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB. Photos can be up to 10 MB.` }
  const url = URL.createObjectURL(file)
  const side = await longSide(url)
  if (side !== null && side < MIN_LONG_SIDE) {
    URL.revokeObjectURL(url)
    return { error: `${file.name} is ${side} px on its long side. Use a photo at least ${MIN_LONG_SIDE} px so shoppers can zoom in.` }
  }
  return { url, name: file.name }
}

const SlotButton = styled('button')({
  position: 'relative',
  padding: 0,
  border: 0,
  background: 'transparent',
  cursor: 'pointer',
  borderRadius: 6,
  display: 'block',
  '&:focus-visible': { outline: `2px solid ${kit.focus}`, outlineOffset: 2 },
  '&:hover .shz-slot-empty': { background: '#FBF4E2' },
})

export function PhotoSlot({ img, index, mobile, highlight, onPick, onRemove, onSwap }: {
  img: ProductImage
  index: number
  mobile: boolean
  /** Missing required photo the seller must add: ink dashed border and an alert label (V-07 "Back"). */
  highlight: boolean
  onPick: (index: number) => void
  onRemove: (index: number) => void
  onSwap: (from: number, to: number) => void
}) {
  const w = mobile ? 88 : 120
  const h = mobile ? 110 : 150
  const filled = hasPhoto(img)
  const label = slotLabel(img.slot, mobile)
  const name = slotName[img.slot]
  const drag = mobile ? {} : {
    draggable: filled,
    onDragStart: (e: DragEvent) => { e.dataTransfer.setData('text/plain', String(index)); e.dataTransfer.effectAllowed = 'move' },
    onDragOver: (e: DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' },
    onDrop: (e: DragEvent) => { e.preventDefault(); const from = Number(e.dataTransfer.getData('text/plain')); if (Number.isInteger(from) && from !== index) onSwap(from, index) },
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: mobile ? 4 : 6, width: w, flexShrink: 0 }} {...drag}>
      <div style={{ position: 'relative', width: w, height: h }}>
        <SlotButton
          type="button"
          id={`pe-slot-${img.slot === 'extra' ? `extra-${index}` : img.slot}`}
          onClick={() => onPick(index)}
          aria-label={filled ? `Replace ${name} photo (${img.name ?? 'uploaded'})` : `${mobile ? 'Add' : 'Upload'} ${name} photo${img.slot !== 'extra' ? ', required' : ''}`}
          aria-describedby={highlight ? 'pe-photos-error' : undefined}
          style={{ width: w, height: h, cursor: filled && !mobile ? 'grab' : 'pointer' }}
        >
          {filled ? (
            <ImagePlaceholder width={w} height={h} src={img.url} alt="" />
          ) : (
            <span
              className="shz-slot-empty"
              style={{
                width: w, height: h, boxSizing: 'border-box', borderRadius: 6, background: kit.surface,
                border: highlight ? `1.5px dashed ${kit.ink}` : `1px dashed ${kit.field}`,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: mobile ? 4 : 6, padding: 6,
                transition: 'background-color 150ms ease-out',
              }}
            >
              <Icon name={mobile ? 'image' : 'upload'} size={20} color={kit.ink} />
              <span style={{ ...textStyle.caption, color: kit.muted, textAlign: 'center' }}>{mobile ? 'Add' : 'Upload'} {img.slot === 'detail' ? 'close-up' : name}</span>
            </span>
          )}
        </SlotButton>
        {filled && (
          <IconButton
            aria-label={`Remove ${name} photo`}
            onClick={() => onRemove(index)}
            style={{ position: 'absolute', top: 4, right: 4, margin: 0, width: 24, height: 24, borderRadius: 999, background: 'rgba(255,253,247,0.92)', color: kit.ink, boxShadow: '0 1px 3px rgba(23,18,14,0.18)' }}
          >
            <Icon name="x" size={14} />
          </IconButton>
        )}
      </div>
      <span style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
        {highlight && <Icon name="alert" size={12} color={kit.error} strokeWidth={1.75} />}
        <span style={{ ...(highlight ? textStyle.label : textStyle.caption), color: highlight ? kit.ink : kit.muted, whiteSpace: 'nowrap' }}>{label}</span>
      </span>
    </div>
  )
}

export function AddPhotoSlot({ onClick, disabledReason }: { onClick: () => void; disabledReason?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: 120, flexShrink: 0 }}>
      <SlotButton type="button" onClick={onClick} aria-label="Add another photo" disabled={Boolean(disabledReason)} title={disabledReason} style={{ width: 120, height: 150, opacity: disabledReason ? 0.5 : 1 }}>
        <span className="shz-slot-empty" style={{ width: 120, height: 150, boxSizing: 'border-box', borderRadius: 6, background: kit.surface, border: `1px dashed ${kit.field}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Icon name="plus" size={20} color={kit.ink} />
          <span style={{ ...textStyle.caption, color: kit.muted }}>Add photo</span>
        </span>
      </SlotButton>
      <span style={{ ...textStyle.caption, color: kit.muted }}>Add</span>
    </div>
  )
}

/** Hidden file inputs: one for the gallery/file picker, one that opens the camera on phones. */
export function usePhotoPicker(onFiles: (files: File[], target: number | 'add' | 'auto') => void) {
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const target = useRef<number | 'add' | 'auto'>('auto')
  const open = (t: number | 'add' | 'auto', camera = false) => {
    target.current = t
    const el = camera ? cameraRef.current : fileRef.current
    if (!el) return
    el.multiple = t === 'add' || t === 'auto'
    el.click()
  }
  const handle = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length) onFiles(files, target.current)
  }
  const inputs = (
    <>
      <input ref={fileRef} type="file" accept={ACCEPT} hidden onChange={handle} data-testid="photo-input" />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={handle} />
    </>
  )
  return { open, inputs }
}

/* ---------- money ---------- */

const groups = new Intl.NumberFormat('en-IN')

export function MoneyInput({ id, label, value, onChange, error, labelAside }: {
  id: string
  label: string
  value: number | null
  onChange: (v: number | null) => void
  error?: string
  labelAside?: ReactNode
}) {
  return (
    <TextInput
      id={id}
      label={label}
      labelAside={labelAside}
      inputMode="numeric"
      autoComplete="off"
      prefix={<span style={{ color: kit.ink }}>₹</span>}
      value={value == null ? '' : groups.format(value)}
      onChange={e => {
        const digits = e.target.value.replace(/[^\d]/g, '').slice(0, 7)
        onChange(digits ? Number(digits) : null)
      }}
      error={error}
      style={{ flex: '1 1 0', minWidth: 0 }}
      fieldStyle={{ gap: 2 }}
    />
  )
}

export function NetEarnings({ price, commissionPct, mobile }: { price: number | null; commissionPct: number; mobile: boolean }) {
  const p = price && price > 0 ? payout(price, commissionPct) : null
  if (mobile) {
    return (
      <div aria-live="polite" style={{ background: kit.chip, borderRadius: 6, padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Text v="small" tone="muted">You receive per sale</Text>
        <Text v="title" tabular>{p ? rupees(p.receive) : '—'}</Text>
      </div>
    )
  }
  return (
    <div aria-live="polite" style={{ flex: '1 1 0', minWidth: 0, background: kit.chip, borderRadius: 6, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Text v="caption" tone="muted">You receive per sale</Text>
      <Text v="statSmall" tabular style={{ letterSpacing: '-0.1px' }}>{p ? rupees(p.receive) : '—'}</Text>
      <Text v="caption" tone="subtle">after {commissionPct}% commission{p ? ` (${rupees(p.commission)})` : ''}</Text>
    </div>
  )
}

/* ---------- sizes and stock ---------- */

export const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', 'One size', 'Free']
export const sortSizes = (list: SizeStock[]) =>
  [...list].sort((a, b) => (SIZE_ORDER.indexOf(a.size) + 1 || 99) - (SIZE_ORDER.indexOf(b.size) + 1 || 99))

export function AddSizeButton({ used, onAdd, id }: { used: string[]; onAdd: (size: string) => void; id?: string }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const free = SIZE_ORDER.filter(s => s !== 'Free' && !used.includes(s))
  return (
    <>
      <Button
        id={id}
        size="sm"
        variant="ghost"
        icon="plus"
        aria-haspopup="dialog"
        disabled={!free.length}
        title={free.length ? undefined : 'Every size is already added.'}
        onClick={e => setAnchor(e.currentTarget)}
      >
        Add size
      </Button>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { mt: 0.5, p: 1.5, width: 232, borderRadius: '8px', border: `1px solid ${kit.line}`, background: kit.surface, boxShadow: '0 12px 32px rgba(23,18,14,0.14)' } } }}
      >
        <Text v="label" as="p" style={{ marginBottom: 8 }}>Add a size</Text>
        <div role="group" aria-label="Sizes" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {free.map(s => (
            <Button key={s} size="sm" variant="secondary" onClick={() => { onAdd(s); setAnchor(null) }} style={{ minWidth: 44, minHeight: 32 }}>{s}</Button>
          ))}
        </div>
      </Popover>
    </>
  )
}

const cellInput: CSSProperties = {
  ...textStyle.small,
  color: kit.ink,
  background: kit.surface,
  borderRadius: 6,
  boxSizing: 'border-box',
  outline: 'none',
}

const SkuInput = styled('input')({
  ...cellInput,
  width: '100%',
  maxWidth: 260,
  border: '1px solid transparent',
  padding: '5px 8px',
  marginLeft: -9,
  '&:hover': { borderColor: kit.field },
  '&:focus': { borderColor: kit.brown, boxShadow: '0 0 0 2px rgba(122, 69, 30, 0.18)' },
  '&[aria-invalid="true"]': { borderColor: kit.error, borderWidth: 1.5 },
})

const StockInput = styled('input')({
  ...cellInput,
  width: 96,
  height: 28,
  border: `1px solid ${kit.field}`,
  padding: '6px 10px',
  MozAppearance: 'textfield',
  '&::-webkit-outer-spin-button, &::-webkit-inner-spin-button': { WebkitAppearance: 'none', margin: 0 },
  '&:focus': { borderColor: kit.brown, boxShadow: '0 0 0 2px rgba(122, 69, 30, 0.18)' },
})

export function SizesTable({ sizes, badSkus, onChange, onRemove }: {
  sizes: SizeStock[]
  badSkus: Set<string>
  onChange: (i: number, patch: Partial<SizeStock>) => void
  onRemove: (i: number) => void
}) {
  return (
    <div style={{ border: `1px solid ${kit.line}`, borderRadius: 8, overflow: 'auto' }}>
      <Table aria-label="Sizes and stock" style={{ tableLayout: 'fixed', minWidth: 460 }}>
        <colgroup><col style={{ width: 104 }} /><col /><col style={{ width: 136 }} /><col style={{ width: 44 }} /></colgroup>
        <thead><tr><th scope="col">Size</th><th scope="col">SKU</th><th scope="col">Stock</th><th><span className="shz-visually-hidden">Remove</span></th></tr></thead>
        <tbody>
          {sizes.map((s, i) => (
            <tr key={s.size}>
              <td>{s.size}</td>
              <td>
                <SkuInput
                  aria-label={`SKU for size ${s.size}`}
                  aria-invalid={badSkus.has(s.sku.trim().toUpperCase()) || !s.sku.trim() || undefined}
                  value={s.sku}
                  spellCheck={false}
                  onChange={e => onChange(i, { sku: e.target.value.toUpperCase().replace(/\s+/g, '-') })}
                />
              </td>
              <td>
                <StockInput
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  aria-label={`Stock for size ${s.size}`}
                  value={s.stock}
                  onChange={e => onChange(i, { stock: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                />
              </td>
              <td>
                <IconButton aria-label={`Remove size ${s.size}`} onClick={() => onRemove(i)} style={{ margin: -9 }}><Icon name="trash" size={14} /></IconButton>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  )
}

const StepBtn = styled('button')({
  position: 'relative',
  width: 40,
  height: 36,
  border: 0,
  background: 'transparent',
  color: kit.ink,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  ...textStyle.body,
  // 44 px touch target around the 36 px drawn stepper.
  '&::after': { content: '""', position: 'absolute', inset: '-4px 0' },
  '&:disabled': { color: kit.field, cursor: 'not-allowed' },
  '&:focus-visible': { outline: `2px solid ${kit.focus}`, outlineOffset: -2, borderRadius: 6 },
})

export function SizeStepperRow({ size, stock, onChange }: { size: string; stock: number; onChange: (v: number) => void }) {
  return (
    <>
      <span aria-hidden style={{ height: 1, flexShrink: 0, background: kit.line }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}>
        <Text v="label" style={{ flex: 1 }}>{size}</Text>
        <div role="group" aria-label={`Stock for size ${size}`} style={{ display: 'flex', alignItems: 'center', border: `1px solid ${kit.field}`, borderRadius: 8, overflow: 'hidden', height: 36 }}>
          <StepBtn type="button" aria-label={`One less ${size}`} disabled={stock <= 0} onClick={() => onChange(Math.max(0, stock - 1))}>−</StepBtn>
          <span aria-live="polite" style={{ ...textStyle.button, width: 44, height: 36, background: kit.canvas, display: 'flex', alignItems: 'center', justifyContent: 'center', fontVariantNumeric: 'tabular-nums' }}>{stock}</span>
          <StepBtn type="button" aria-label={`One more ${size}`} onClick={() => onChange(stock + 1)}><Icon name="plus" size={16} /></StepBtn>
        </div>
      </div>
    </>
  )
}

/* ---------- side column ---------- */

const eventLabel: Record<ProductEvent['kind'], string> = {
  created: 'Created as draft',
  submitted: 'Submitted for review',
  edit_submitted: 'Edit submitted for review',
  approved: 'Approved',
  sent_back: 'Sent back',
  archived: 'Archived',
}

const firstSentence = (s: string) => (/^.*?[.!?](\s|$)/.exec(s)?.[0] ?? s).trim()

export function HistoryCard({ productId, isNew }: { productId: string; isNew: boolean }) {
  const q = useProductHistory(isNew ? undefined : productId)
  return (
    <Card gap={12}>
      <Text v="title" as="h2">Review history</Text>
      {isNew && <Text v="small" tone="muted" as="p">Nothing yet. The history starts when you save this product.</Text>}
      {!isNew && q.isPending && [0, 1, 2].map(i => <Skeleton key={i} height={30} />)}
      {q.isError && <Text v="small" tone="error" as="p">History didn’t load. Reload the page to try again.</Text>}
      {q.data && (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {q.data.map(e => (
            <li key={e.id} style={{ display: 'flex', gap: 10 }}>
              <span aria-hidden style={{ width: 8, height: 8, borderRadius: 4, background: kit.ink, marginTop: 5, flexShrink: 0 }} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <Text v="label">{eventLabel[e.kind]}</Text>
                <Text v="caption" tone="subtle"><time dateTime={e.at}>{historyTime(e.at)}</time></Text>
                {e.note && <Text v="small" tone="muted" title={e.note}>{firstSentence(e.note)}</Text>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}

const returnOptions = [
  { value: 'none', label: 'No returns (made-to-measure)' },
  { value: '3', label: '3-day returns' },
  { value: '14', label: '14-day returns' },
]

export function ReturnsCard({ returnable, returnDays, onChange }: { returnable: boolean; returnDays: number; onChange: (v: { returnable: boolean; returnDays: number }) => void }) {
  const isDefault = returnable && returnDays === 7
  const value = !returnable ? 'none' : String(returnDays)
  return (
    <Card gap={12}>
      <Text v="title" as="h2">Returns</Text>
      <Checkbox
        label="Use store default: 7-day returns"
        checked={isDefault}
        onChange={e => onChange(e.target.checked ? { returnable: true, returnDays: 7 } : { returnable: false, returnDays: 0 })}
      />
      {!isDefault && (
        <Select
          label="Returns for this product"
          options={returnOptions}
          value={returnOptions.some(o => o.value === value) ? value : 'none'}
          onChange={e => onChange(e.target.value === 'none' ? { returnable: false, returnDays: 0 } : { returnable: true, returnDays: Number(e.target.value) })}
        />
      )}
      <Text v="caption" tone="subtle" as="p">Override only if this product cannot be returned, for example made-to-measure.</Text>
    </Card>
  )
}

export function ReviewRulesCard() {
  return (
    <div style={{ background: kit.chip, borderRadius: 8, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Text v="label" as="h2">What needs review again</Text>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="check" size={14} color={kit.ink} /><Text v="small" tone="muted">Price and stock: live immediately</Text></span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="clock" size={14} color={kit.ink} /><Text v="small" tone="muted">Title, description, photos: reviewed first</Text></span>
    </div>
  )
}

export function EditorSkeleton({ mobile }: { mobile: boolean }) {
  const card = (h: number) => (
    <div style={{ background: kit.surface, border: `1px solid ${kit.line}`, borderRadius: 8, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Skeleton width={90} height={18} />
      <Skeleton height={h} />
    </div>
  )
  return (
    <div aria-busy="true" aria-label="Loading product" style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: mobile ? 16 : '32px 40px 40px', background: kit.canvas, flex: 1 }}>
      <Skeleton width={mobile ? 200 : 320} height={32} />
      <Skeleton width={220} />
      {card(150)}
      {card(120)}
      {card(80)}
    </div>
  )
}
