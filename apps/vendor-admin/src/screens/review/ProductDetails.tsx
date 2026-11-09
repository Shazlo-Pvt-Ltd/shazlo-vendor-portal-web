import { Box, Button, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { fontFamily, neutral, SectionCard, StatusPill } from '@shazlo/ui'
import { useState, type ReactNode } from 'react'
import type { components } from '../../api/schema'
import { reviewCopy } from '../../copy/review'
import { formatCount, formatINR } from '../../lib/format'
import { photoNames } from './ProductPhotos'

const copy = reviewCopy.product
type Version = components['schemas']['ProductVersion']
const CLIP = 80

const num = { textAlign: 'right', fontVariantNumeric: 'tabular-nums' } as const

function photosLine(v: Version): string {
  const names = photoNames(v.images)
  if (names.length === 0) return copy.compare.noPhotos
  const text = names.join(', ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export const sizesLine = (v: Version) => v.variants.map((x) => `${x.size} ${formatCount(x.stock)}`).join(' · ')

function clip(text: string): string {
  if (text.length <= CLIP) return text
  const cut = text.slice(0, CLIP)
  const space = cut.lastIndexOf(' ')
  return `${(space > CLIP / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, '')}…`
}

type Row = { key: keyof typeof copy.compare.rows; before: string; after: string }

function rowsOf(before: Version, after: Version): Row[] {
  const line = (v: Version) => ({
    photos: photosLine(v),
    title: v.title,
    price: `${formatINR(v.price_paise)} / ${formatINR(v.mrp_paise)}`,
    type: `${v.category} · ${v.gender} · ${v.fabric}`,
    sizes: sizesLine(v),
    description: v.description,
  })
  const a = line(before)
  const b = line(after)
  return (Object.keys(a) as Row['key'][]).map((key) => ({ key, before: a[key], after: b[key] }))
}

const cellSx = { verticalAlign: 'top', overflowWrap: 'anywhere', whiteSpace: 'pre-line' } as const

// What changed since the version a reviewer last saw: the sent-back version for a resubmission,
// the live one for an edit. Hidden for a first submission.
export function CompareCard({ label, before, after }: { label: 'sent_back' | 'live'; before: Version; after: Version }) {
  const [full, setFull] = useState(false)
  const rows = rowsOf(before, after)
  const long = before.description.length > CLIP || after.description.length > CLIP
  return (
    <SectionCard title={label === 'live' ? copy.compare.live : copy.compare.sentBack} padded={false}>
      <Box sx={{ overflowX: 'auto' }}>
        <Table sx={{ tableLayout: 'fixed', minWidth: 520 }}>
          <TableHead>
            <TableRow>
              <TableCell component="th" scope="col" sx={{ width: '26%' }}>
                {copy.compare.field}
              </TableCell>
              <TableCell component="th" scope="col">
                {label === 'live' ? copy.compare.liveColumn : copy.compare.sentBackColumn}
              </TableCell>
              <TableCell component="th" scope="col">
                {copy.compare.thisColumn}
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => {
              const changed = row.before !== row.after
              const show = (text: string) => (row.key === 'description' && !full ? clip(text) : text)
              let toggle: ReactNode = null
              if (row.key === 'description' && long) {
                toggle = (
                  <Button variant="text" size="small" onClick={() => setFull((f) => !f)} aria-expanded={full} sx={{ mt: 0.5, ml: -1, px: 1 }}>
                    {full ? copy.compare.showLess : copy.compare.showFull}
                  </Button>
                )
              }
              return (
                <TableRow key={row.key}>
                  <TableCell component="th" scope="row" sx={{ ...cellSx, color: neutral.inkSecondary }}>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
                      {copy.compare.rows[row.key]}
                      {changed && <StatusPill status="pending" label={copy.compare.changed} />}
                    </Box>
                    {toggle}
                  </TableCell>
                  <TableCell sx={cellSx}>{show(row.before)}</TableCell>
                  <TableCell sx={{ ...cellSx, ...(changed ? {} : { color: neutral.inkTertiary }) }}>{changed ? show(row.after) : copy.compare.same}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Box>
    </SectionCard>
  )
}

export function DescriptionCard({ text }: { text: string }) {
  return (
    <SectionCard title={copy.description}>
      <Typography variant="body1" sx={{ whiteSpace: 'pre-line', maxWidth: '70ch', overflowWrap: 'anywhere' }}>
        {text || '—'}
      </Typography>
    </SectionCard>
  )
}

export function SizesCard({ variants }: { variants: Version['variants'] }) {
  const total = variants.reduce((sum, v) => sum + v.stock, 0)
  return (
    <SectionCard title={copy.sizes.title} padded={false}>
      <Box sx={{ overflowX: 'auto' }}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell component="th" scope="col">
                {copy.sizes.size}
              </TableCell>
              <TableCell component="th" scope="col">
                {copy.sizes.sku}
              </TableCell>
              <TableCell component="th" scope="col" sx={num}>
                {copy.sizes.stock}
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {variants.map((v) => (
              <TableRow key={v.sku}>
                <TableCell component="th" scope="row">
                  {v.size}
                </TableCell>
                <TableCell sx={{ fontFamily: fontFamily.mono, fontSize: 12, color: neutral.inkSecondary, overflowWrap: 'anywhere' }}>{v.sku}</TableCell>
                <TableCell sx={num}>{formatCount(v.stock)}</TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell component="th" scope="row" sx={{ borderBottom: 0 }}>
                {copy.sizes.total}
              </TableCell>
              <TableCell sx={{ borderBottom: 0 }} />
              <TableCell sx={{ ...num, borderBottom: 0 }}>{formatCount(total)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Box>
    </SectionCard>
  )
}
