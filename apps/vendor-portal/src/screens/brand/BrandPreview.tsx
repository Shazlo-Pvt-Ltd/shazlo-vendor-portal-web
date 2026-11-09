// The brand page as the Shazlo consumer app renders it (V-05 "Preview in the Shazlo app").
import type { ReactNode } from 'react'
import { Icon, kit, Text, textStyle, type IconName } from '@shazlo/ui/components'
import type { BrandProfileFields } from '../../api/types'
import { returnShort } from './brandForm'

/** `mock://` ids are fixture assets the mock has no bytes for: draw them as placeholders, like the wireframe. */
const isRealImage = (url?: string) => Boolean(url && !url.startsWith('mock://'))

export function ImageTile({ url, width, height, radius }: { url?: string; width: number | string; height: number | string; radius: number }) {
  if (isRealImage(url)) return <img src={url} alt="" style={{ width, height, borderRadius: radius, objectFit: 'cover', display: 'block', flexShrink: 0 }} />
  return (
    <span aria-hidden style={{ width, height, borderRadius: radius, background: kit.placeholder, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <Icon name="image" size={24} color={kit.ink} style={{ opacity: 0.45 }} />
    </span>
  )
}

/** 340 × 700 phone: 6 px #D9C9A3 frame, 36 px corners, 14 px inset to the 24 px-radius screen. */
export function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div style={{ width: 340, maxWidth: '100%', height: 700, background: kit.surface, border: `6px solid ${kit.field}`, borderRadius: 36, padding: 8, boxSizing: 'border-box', display: 'flex' }}>
      <div style={{ flex: 1, borderRadius: 24, overflowX: 'hidden', overflowY: 'auto', background: kit.surface, scrollbarWidth: 'none' }}>{children}</div>
    </div>
  )
}

function Meta({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, ...textStyle.caption, color: kit.muted }}>
      <Icon name={icon} size={12} />{children}
    </span>
  )
}

/** In-app render: cover, logo, name, tagline, facts, story, then approved product tiles. */
export function BrandPreview({ fields, tiles = 4 }: { fields: BrandProfileFields; tiles?: number }) {
  const city = fields.city.split(',')[0]?.trim() || fields.city
  return (
    <div style={{ display: 'flex', flexDirection: 'column', background: kit.surface }}>
      <ImageTile url={fields.coverUrl} width="100%" height={130} radius={0} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 16 }}>
        <ImageTile url={fields.logoUrl} width={56} height={56} radius={28} />
        <Text v="heading">{fields.brandName}</Text>
        <Text v="small" tone="muted">{fields.tagline || '—'}</Text>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {city && <Meta icon="globe">{city}</Meta>}
          {fields.shipsIn && <Meta icon="clock">Ships in {fields.shipsIn}</Meta>}
          {fields.returnPolicy && <Meta icon="refresh">{returnShort(fields.returnPolicy)}</Meta>}
        </div>
        <Text v="small" as="p" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{fields.story || '—'}</Text>
      </div>
      {tiles > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, padding: '0 16px 16px' }}>
          {Array.from({ length: Math.min(4, tiles) }, (_, i) => <ImageTile key={i} width="100%" height={170} radius={6} />)}
        </div>
      )}
    </div>
  )
}

/** Draft / Live switch above the preview (V-05): compare the draft against what shoppers see now. */
export function VersionToggle({ value, onChange, liveAvailable }: { value: 'draft' | 'live'; onChange: (v: 'draft' | 'live') => void; liveAvailable: boolean }) {
  const items: Array<{ v: 'draft' | 'live'; label: string; disabled?: boolean }> = [
    { v: 'draft', label: 'Draft' },
    { v: 'live', label: 'Live', disabled: !liveAvailable },
  ]
  return (
    <div role="group" aria-label="Preview version" style={{ display: 'inline-flex', background: kit.chip, borderRadius: 6, padding: 2 }}>
      {items.map(item => {
        const active = item.v === value
        return (
          <button
            key={item.v}
            type="button"
            aria-pressed={active}
            disabled={item.disabled}
            title={item.disabled ? 'Your brand page isn’t live yet.' : undefined}
            onClick={() => onChange(item.v)}
            style={{
              ...textStyle.caption, color: active ? kit.ink : kit.muted, background: active ? kit.surface : 'transparent',
              border: 0, borderRadius: 4, padding: '4px 10px', cursor: item.disabled ? 'not-allowed' : 'pointer', opacity: item.disabled ? 0.5 : 1,
              transition: 'background-color 150ms ease-out',
            }}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
