import { Box, Button, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { emphasis, fontFamily, neutral, radius, SectionCard, status, StatusPill } from '@shazlo/ui'
import { GitCompareArrows, IndianRupee, Ruler, Shirt, Tags } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type * as M from '../../api/model'
import { CardTitle } from '../../components/CardTitle'
import { reviewCopy } from '../../copy/review'
import { formatCount, formatINR } from '../../lib/format'
import { usePhone } from '../../lib/responsive'
import { photoNames } from './ProductPhotos'

const copy = reviewCopy.product
type Version = M.ProductVersion
const CLIP = 80

const num = { textAlign: 'right', fontVariantNumeric: 'tabular-nums' } as const

// Reference tables (sizes and stock, the size chart) show their parts apart: a muted header row in
// semibold over a firm rule, a rule under each row, sizes in semibold and a total in bold over a
// firm rule. Table-level rules, so they win over each cell's own look.
const referenceTableSx = {
  '& thead th': { ...emphasis.semibold, color: neutral.ink, bgcolor: neutral.muted, borderBottom: `2px solid ${neutral.lineStrong}`, py: 1.25, verticalAlign: 'bottom' },
  '& tbody th, & tbody td': { borderBottom: `1px solid ${neutral.line}`, py: 1.25 },
  '& tbody th': { ...emphasis.semibold, color: neutral.ink },
  '& tbody tr:last-of-type > *': { borderBottom: 0 },
  '& tbody tr[data-total] > *': { ...emphasis.bold, color: neutral.ink, borderTop: `2px solid ${neutral.lineStrong}` },
} as const

// A grid of measurements also rules its columns, so each figure reads under its heading.
const chartTableSx = {
  ...referenceTableSx,
  '& thead th + th, & tbody td': { borderLeft: `1px solid ${neutral.line}` },
} as const
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1)

function photosLine(v: Version): string {
  const names = photoNames(v.photos)
  if (names.length === 0) return copy.compare.noPhotos
  const text = names.map(lowerFirst).join(', ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export const sizesLine = (v: Version) => v.variants.map((x) => (x.stock === null ? x.size : `${x.size} ${formatCount(x.stock)}`)).join(' · ')
const priceLine = (v: Version) => `${formatINR(v.price_paise)} / ${v.mrp_paise == null ? copy.compare.noMrp : formatINR(v.mrp_paise)}`
const coloursLine = (v: Version) =>
  copy.compare.colours(
    v.main_colour.name,
    v.other_colours.map((c) => c.name),
  )

function clip(text: string): string {
  if (text.length <= CLIP) return text
  const cut = text.slice(0, CLIP)
  const space = cut.lastIndexOf(' ')
  return `${(space > CLIP / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, '')}…`
}

type Row = { key: keyof typeof copy.compare.rows; before: string; after: string }

function rowsOf(before: Version, after: Version): Row[] {
  const line = (v: Version): Record<Row['key'], string> => ({
    photos: photosLine(v),
    tryOn: copy.compare.tryOnCount(v.try_on_photos?.length ?? 0),
    title: v.title,
    price: priceLine(v),
    type: `${copy.about.genders[v.gender]} · ${v.product_type}`,
    colours: coloursLine(v),
    material: v.material,
    sizes: sizesLine(v),
    description: v.description,
  })
  const a = line(before)
  const b = line(after)
  // The try-on row only means something when the server keeps try-on photos.
  const known = before.try_on_photos !== null || after.try_on_photos !== null
  return (Object.keys(a) as Row['key'][]).filter((key) => key !== 'tryOn' || known).map((key) => ({ key, before: a[key], after: b[key] }))
}

const cellSx = { verticalAlign: 'top', overflowWrap: 'anywhere', whiteSpace: 'pre-line' } as const

// Phones: one field after another, the earlier value over this one, instead of three columns.
export function StackedCompare({ items }: { items: { key: string; field: ReactNode; rows: { label: string; value: ReactNode; muted?: boolean }[]; extra?: ReactNode }[] }) {
  return (
    <Box component="dl" sx={{ m: 0, px: 2, pb: 1 }}>
      {items.map((item) => (
        <Box key={item.key} sx={{ py: 1.5, borderTop: `1px solid ${neutral.line}` }}>
          <Box component="dt" sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, typography: 'subtitle2', color: neutral.inkSecondary }}>
            {item.field}
          </Box>
          <Box component="dd" sx={{ m: 0, mt: 0.75, display: 'grid', gap: 0.5 }}>
            {item.rows.map((row) => (
              <Typography key={row.label} variant="body2" component="div" sx={{ overflowWrap: 'anywhere', whiteSpace: 'pre-line', ...(row.muted ? { color: neutral.inkTertiary } : null) }}>
                <Box component="span" sx={{ color: neutral.inkSecondary }}>{`${row.label}: `}</Box>
                {row.value}
              </Typography>
            ))}
            {item.extra}
          </Box>
        </Box>
      ))}
    </Box>
  )
}

// What changed since the version a reviewer last saw: the sent-back version for a resubmission,
// the live one for an edit. Hidden for a first submission.
export function CompareCard({ label, before, after }: { label: 'sent_back' | 'live'; before: Version; after: Version }) {
  const [full, setFull] = useState(false)
  const phone = usePhone()
  const rows = rowsOf(before, after)
  const long = before.description.length > CLIP || after.description.length > CLIP
  const title = label === 'live' ? copy.compare.live : copy.compare.sentBack
  const beforeColumn = label === 'live' ? copy.compare.liveColumn : copy.compare.sentBackColumn
  const toggleFor = (key: Row['key']) =>
    key === 'description' && long ? (
      <Button variant="text" size="small" onClick={() => setFull((f) => !f)} aria-expanded={full} sx={{ mt: 0.5, ml: -1, px: 1, justifySelf: 'start' }}>
        {full ? copy.compare.showLess : copy.compare.showFull}
      </Button>
    ) : null

  const heading = <CardTitle icon={GitCompareArrows}>{title}</CardTitle>
  if (phone) {
    return (
      <SectionCard title={heading} padded={false}>
        <StackedCompare
          items={rows.map((row) => {
            const changed = row.before !== row.after
            const show = (text: string) => (row.key === 'description' && !full ? clip(text) : text)
            return {
              key: row.key,
              field: (
                <>
                  {copy.compare.rows[row.key]}
                  {changed && <StatusPill status="pending" label={copy.compare.changed} />}
                </>
              ),
              rows: [
                { label: beforeColumn, value: show(row.before) },
                { label: copy.compare.thisColumn, value: changed ? show(row.after) : copy.compare.same, muted: !changed },
              ],
              extra: toggleFor(row.key),
            }
          })}
        />
      </SectionCard>
    )
  }

  return (
    <SectionCard title={heading} padded={false}>
      <Box sx={{ overflowX: 'auto' }}>
        <Table sx={{ tableLayout: 'fixed', minWidth: 520 }}>
          <TableHead>
            <TableRow>
              <TableCell component="th" scope="col" sx={{ width: '26%' }}>
                {copy.compare.field}
              </TableCell>
              <TableCell component="th" scope="col">
                {beforeColumn}
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
              const toggle = toggleFor(row.key)
              return (
                <TableRow key={row.key}>
                  <TableCell component="th" scope="row" sx={{ ...cellSx, ...emphasis.semibold, color: neutral.inkSecondary }}>
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

// A fact: its label in semibold, its value in regular ink.
function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <>
      <Typography component="dt" variant="subtitle2" color="textSecondary" sx={{ pt: '1px' }}>
        {term}
      </Typography>
      <Typography component="dd" variant="body1" sx={{ m: 0, minWidth: 0, maxWidth: '70ch', overflowWrap: 'anywhere' }}>
        {children}
      </Typography>
    </>
  )
}

const dlSx = { display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '160px 1fr' }, columnGap: 3, rowGap: { xs: 0.5, sm: 1.5 }, m: 0, '& dd': { mb: { xs: 1.25, sm: 0 } } } as const

// Multicolour has no single colour: four solid quarters, never a gradient.
const MULTI = ['#8C2F25', '#C99A2E', '#2E3F6E', '#5C6B4E']

function Swatch({ colour }: { colour: M.Colour }) {
  const ring = { width: 14, height: 14, borderRadius: '50%', border: `1px solid ${neutral.lineStrong}`, flexShrink: 0, display: 'inline-block', overflow: 'hidden' } as const
  if (colour.hex == null) {
    return (
      <Box component="span" aria-hidden="true" data-swatch="multicolour" sx={{ ...ring, display: 'inline-grid', gridTemplateColumns: '1fr 1fr' }}>
        {MULTI.map((hex) => (
          <Box key={hex} component="span" sx={{ bgcolor: hex }} />
        ))}
      </Box>
    )
  }
  return <Box component="span" aria-hidden="true" data-swatch={colour.hex} sx={{ ...ring, bgcolor: colour.hex }} />
}

function Colour({ colour }: { colour: M.Colour }) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, whiteSpace: 'nowrap' }}>
      <Swatch colour={colour} />
      {colour.name}
    </Box>
  )
}

// What the product is (spec §7): gender, product type, colours with small swatches, material and
// the description shoppers read.
export function AboutCard({ version }: { version: Version }) {
  const c = copy.about
  const others = version.other_colours
  return (
    <SectionCard title={<CardTitle icon={Shirt}>{c.title}</CardTitle>}>
      <Box component="dl" sx={dlSx}>
        <Row term={c.gender}>{c.genders[version.gender]}</Row>
        <Row term={c.type}>{version.product_type}</Row>
        <Row term={c.mainColour}>
          <Colour colour={version.main_colour} />
        </Row>
        <Row term={c.otherColours}>
          {others.length === 0 ? (
            <Box component="span" sx={{ color: 'text.secondary' }}>
              {c.none}
            </Box>
          ) : (
            others.map((colour, i) => (
              <Box component="span" key={colour.name}>
                {i > 0 && ', '}
                <Colour colour={colour} />
              </Box>
            ))
          )}
        </Row>
        <Row term={c.material}>{version.material}</Row>
        <Row term={c.description}>
          <Box component="span" sx={{ whiteSpace: 'pre-line' }}>
            {version.description || '—'}
          </Box>
        </Row>
      </Box>
    </SectionCard>
  )
}

// Selling price and the optional MRP. The app shows the lower of the two, so a price above the MRP
// is called out.
export function PriceCard({ version }: { version: Version }) {
  const c = copy.price
  const { price_paise: price, mrp_paise: mrp } = version
  const above = mrp != null && price > mrp
  let note: string
  if (above) note = c.aboveMrp(formatINR(mrp))
  else if (mrp != null) note = c.shows(formatINR(price))
  else note = c.showsOnly(formatINR(price))
  return (
    <SectionCard title={<CardTitle icon={IndianRupee}>{c.title}</CardTitle>}>
      <Box component="dl" sx={dlSx}>
        <Row term={c.selling}>
          <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {formatINR(price)}
          </Box>
        </Row>
        <Row term={c.mrp}>
          {mrp == null ? (
            <Box component="span" sx={{ color: 'text.secondary' }}>
              {c.noMrp}
            </Box>
          ) : (
            <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              {formatINR(mrp)}
            </Box>
          )}
        </Row>
      </Box>
      <Typography variant="body2" sx={{ mt: 2, color: above ? status.error : 'text.secondary' }}>
        {note}
      </Typography>
    </SectionCard>
  )
}

export function SizesCard({ version }: { version: Version }) {
  const { variants } = version
  // Stock only shows when the server keeps it.
  const hasStock = variants.some((v) => v.stock !== null)
  const total = variants.reduce((sum, v) => sum + (v.stock ?? 0), 0)
  // One-size pieces (dupattas, sarees, bags) need no size chart, so none is missed for them.
  const noChart = version.size_chart === null && variants.length > 1
  return (
    <SectionCard title={<CardTitle icon={Tags}>{copy.sizes.title}</CardTitle>} padded={false}>
      <Box sx={{ overflowX: 'auto' }}>
        <Table sx={referenceTableSx}>
          <TableHead>
            <TableRow>
              <TableCell component="th" scope="col">
                {copy.sizes.size}
              </TableCell>
              <TableCell component="th" scope="col">
                {copy.sizes.code}
              </TableCell>
              {hasStock && (
                <TableCell component="th" scope="col" sx={num}>
                  {copy.sizes.stock}
                </TableCell>
              )}
            </TableRow>
          </TableHead>
          <TableBody>
            {variants.map((v) => (
              <TableRow key={v.sku}>
                <TableCell component="th" scope="row">
                  {v.size}
                </TableCell>
                <TableCell sx={{ fontFamily: fontFamily.mono, fontSize: 12, color: neutral.inkSecondary, overflowWrap: 'anywhere' }}>{v.sku}</TableCell>
                {hasStock && <TableCell sx={num}>{v.stock === null ? '—' : formatCount(v.stock)}</TableCell>}
              </TableRow>
            ))}
            {hasStock && (
              <TableRow data-total="">
                <TableCell component="th" scope="row">
                  {copy.sizes.total}
                </TableCell>
                <TableCell />
                <TableCell sx={num}>{formatCount(total)}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Box>
      {noChart && (
        <Typography variant="body2" color="textSecondary" sx={{ px: { xs: 2, sm: 3 }, pb: 2.5 }}>
          {copy.sizeChart.none(version.product_type)}
        </Typography>
      )}
    </SectionCard>
  )
}

// The brand's own chart for this product type: measurements in cm (any may be blank), or a photo.
export function SizeChartCard({ chart }: { chart: NonNullable<Version['size_chart']> }) {
  const c = copy.sizeChart
  if (chart.kind === 'photo') {
    return (
      <SectionCard title={<CardTitle icon={Ruler}>{c.title}</CardTitle>}>
        <Typography variant="body2" color="textSecondary" sx={{ mb: 1.5 }}>
          {c.forTypePhoto(chart.product_type)}
        </Typography>
        <Box component="img" src={chart.url} alt={c.photoAlt(chart.product_type)} sx={{ display: 'block', width: '100%', maxWidth: 320, borderRadius: `${radius.card}px`, border: `1px solid ${neutral.line}` }} />
      </SectionCard>
    )
  }
  return (
    <SectionCard title={<CardTitle icon={Ruler}>{c.title}</CardTitle>} padded={false}>
      <Typography variant="body2" color="textSecondary" sx={{ px: { xs: 2, sm: 3 }, pb: 1.5 }}>
        {c.forType(chart.product_type)}
      </Typography>
      <Box sx={{ overflowX: 'auto' }}>
        <Table sx={chartTableSx}>
          <TableHead>
            <TableRow>
              <TableCell component="th" scope="col">
                {c.size}
              </TableCell>
              {chart.measurements.map((m) => (
                <TableCell key={m} component="th" scope="col" sx={num}>
                  {m}{' '}
                  <Box component="span" sx={{ typography: 'caption', color: 'text.secondary', whiteSpace: 'nowrap' }}>
                    {c.unit}
                  </Box>
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {chart.rows.map((row) => (
              <TableRow key={row.size}>
                <TableCell component="th" scope="row">
                  {row.size}
                </TableCell>
                {chart.measurements.map((m, j) => (
                  <TableCell key={m} sx={num}>
                    {row.cm[j] == null ? '—' : row.cm[j]!.toLocaleString('en-IN')}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    </SectionCard>
  )
}
