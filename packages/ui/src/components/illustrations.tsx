import { brand } from '../tokens'

// Small brown line drawings for empty states (spec: "a small brown line drawing").
const drawings = {
  kurta: 'M32 6a4 4 0 1 1 4 4c0 2-4 3-4 6M8 26l24-10 24 10M16 22l-4 36h40l-4-36M26 18l6 7 6-7M32 25v12',
  box: 'M10 22 32 12l22 10v24L32 56 10 46ZM10 22l22 10 22-10M32 32v24M21 17l22 10',
  sheet: 'M16 8h24l10 10v38H16ZM40 8v10h10M22 28h22M22 36h22M22 44h14M30 24v28',
  clock: 'M32 10a22 22 0 1 0 0 44 22 22 0 0 0 0-44ZM32 20v13l9 6M24 6h16',
  bell: 'M20 44V30a12 12 0 0 1 24 0v14l4 4H16ZM28 52a4 4 0 0 0 8 0M32 14v4',
  store: 'M10 24 14 12h36l4 12M10 24h44v4a7 7 0 0 1-14 0 7 7 0 0 1-12 0 7 7 0 0 1-14 0 4 4 0 0 1-4-4ZM14 34v20h36V34M26 54V42h12v12',
} as const

export type IllustrationName = keyof typeof drawings

export function EmptyIllustration({ name, size = 64 }: { name: IllustrationName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" stroke={brand.brown} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={drawings[name]} />
    </svg>
  )
}
