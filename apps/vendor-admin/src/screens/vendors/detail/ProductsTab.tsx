import { Box, Button, Card, Checkbox, Link, Stack, Typography } from '@mui/material'
import { emphasis, EmptyState, neutral, StatusPill, type PillStatus } from '@shazlo/ui'
import { useId, useRef, useState, type ReactNode } from 'react'
import { Link as RouterLink } from 'react-router'
import { useApproveProducts } from '../../../api/queries'
import type { components } from '../../../api/schema'
import { modulePaths } from '../../../app/routes'
import { ProductThumb } from '../../../components/ProductThumb'
import { focusRing, RowChevron } from '../../../components/rows'
import { vendorActionsCopy, vendorDetailCopy } from '../../../copy/vendors'
import { formatINR } from '../../../lib/format'
import { ApproveProductsDialog } from './ApproveProductsDialog'

const copy = vendorDetailCopy.products
type S = components['schemas']
type Vendor = S['VendorDetail']
type Product = Vendor['products'][number]

// What the vendor page's banner says after approving several products; `body` lists the ones that
// were not approved.
export type ProductsOutcome = { tone: 'success' | 'warning'; text: string; body?: ReactNode }

const productPill: Record<string, PillStatus> = { pending_review: 'pending', approved: 'live', rejected: 'sentBack' }

// A tick is for a version: a product submitted again after it was ticked is no longer ticked.
const versionKey = (p: Product) => `${p.id}@${p.submitted_at}`

// The tick column, outside each row's link. The box is 44 px below md (MUI draws 42), flush right in
// a column that keeps the rows' left edge; rows with nothing to tick keep the column, so the
// thumbnails line up.
const tickColumn = { width: { xs: 48, sm: 60 }, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' } as const
const tickBox = { p: { xs: '10px', md: '9px' } } as const
// The most products one approval sends (ApproveProductsBody maxItems).
const BULK_MAX = 50

type RowProps = { product: Product; ticks: boolean; checked: boolean; onTick: (on: boolean) => void }

function ProductRow({ product, ticks, checked, onTick }: RowProps) {
  const pending = product.status === 'pending_review'
  const row: ReactNode = (
    <Stack direction="row" spacing={{ xs: ticks ? 1.5 : 2, sm: 2 }} sx={{ alignItems: 'center', minHeight: 64, pl: ticks ? { xs: 0.5, sm: 1 } : { xs: 2, sm: 3 }, pr: { xs: 2, sm: 3 }, py: 1 }}>
      <ProductThumb src={product.thumbnail_url} size={40} />
      {/* On a phone the status sits under the title, so the title keeps a readable width. */}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 0.5, sm: 2 }} sx={{ flex: 1, minWidth: 0, alignItems: { xs: 'flex-start', sm: 'center' } }}>
        <Typography variant="body1" sx={{ ...emphasis.semibold, flex: 1, minWidth: 0, overflowWrap: 'break-word', maxWidth: '100%' }}>
          {product.title}
        </Typography>
        <StatusPill status={productPill[product.status] ?? 'draft'} label={copy.status[product.status] ?? product.status} />
      </Stack>
      <Typography variant="body1" sx={{ width: { xs: 'auto', sm: 96 }, textAlign: 'right', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
        {formatINR(product.price_paise)}
      </Typography>
      {/* A row that opens ends in a chevron; the others keep its room, so the prices line up. */}
      <Box sx={{ width: 20, display: 'flex', flexShrink: 0 }}>{pending && <RowChevron />}</Box>
    </Stack>
  )
  return (
    // The hover tint covers the tick column too, so the row reads as one line.
    <Box component="li" sx={{ display: 'flex', alignItems: 'stretch', borderTop: `1px solid ${neutral.line}`, '&:first-of-type': { borderTop: 0 }, '@media (hover: hover)': { '&:has(> a:hover)': { bgcolor: 'action.hover' } } }}>
      {ticks && (
        <Box sx={tickColumn}>
          {pending && <Checkbox checked={checked} onChange={(_, on) => onTick(on)} sx={tickBox} slotProps={{ input: { 'aria-label': copy.bulk.select(product.title) } as object }} />}
        </Box>
      )}
      {pending ? (
        <Link
          component={RouterLink}
          to={modulePaths.product(product.id)}
          underline="none"
          sx={{ display: 'block', flex: 1, minWidth: 0, color: 'inherit', cursor: 'pointer', '@media (hover: hover)': { '&:hover [data-chevron]': { color: neutral.ink } }, '&:focus-visible': focusRing }}
        >
          {row}
        </Link>
      ) : (
        <Box sx={{ flex: 1, minWidth: 0 }}>{row}</Box>
      )}
    </Box>
  )
}

type ToolbarProps = { waiting: number; selected: number; onAll: (on: boolean) => void; onApprove: () => void }

// "Select all waiting", how many are ticked, and the one button that approves them. Only an
// approved brand has it, and its header holds no primary button (only Suspend), so this is the one.
function BulkToolbar({ waiting, selected, onAll, onApprove }: ToolbarProps) {
  const allId = useId()
  const limitId = useId()
  const b = copy.bulk
  const tooMany = selected > BULK_MAX
  return (
    <Box role="group" aria-label={b.toolbar} sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', rowGap: 1, columnGap: 2, pr: { xs: 2, sm: 3 }, py: 1, borderBottom: `1px solid ${neutral.line}` }}>
      <Box sx={{ display: 'flex', alignItems: 'center', flex: '1 1 auto', minWidth: 0 }}>
        <Box sx={tickColumn}>
          <Checkbox id={allId} checked={selected > 0 && selected === waiting} indeterminate={selected > 0 && selected < waiting} onChange={(_, on) => onAll(on)} sx={tickBox} />
        </Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 0, sm: 1.5 }} sx={{ pl: { xs: 0.5, sm: 1 }, minWidth: 0, alignItems: { sm: 'baseline' } }}>
          <Typography component="label" htmlFor={allId} variant="body1" sx={{ cursor: 'pointer', overflowWrap: 'break-word' }}>
            {b.selectAll(waiting)}
          </Typography>
          <Typography variant="body2" color="textSecondary" aria-live="polite">
            {b.selected(selected)}
          </Typography>
          {tooMany && (
            <Typography id={limitId} variant="body2" color="textSecondary">
              {b.limit.hint(BULK_MAX)}
            </Typography>
          )}
        </Stack>
      </Box>
      {/* Its own full-width row on a phone; beside the tick from 600 px. */}
      <Box sx={{ display: 'flex', flexBasis: { xs: '100%', sm: 'auto' }, pl: { xs: 2, sm: 0 } }}>
        <Button variant="contained" disabled={selected === 0 || tooMany} aria-describedby={tooMany ? limitId : undefined} onClick={onApprove} sx={{ flex: { xs: 1, sm: 'none' }, minHeight: { xs: 44, md: 0 } }}>
          {b.approve(selected)}
        </Button>
      </Box>
    </Box>
  )
}

// The banner and toast for the answer: all approved, or the count that were and each that was not.
function outcomeOf(result: S['ApproveProductsResult'], sent: Product[], brand: string): [ProductsOutcome, string] {
  const b = copy.bulk
  const approved = result.approved.length
  if (result.failed.length === 0) return [{ tone: 'success', text: b.done.banner(approved, brand) }, b.done.toast(approved, brand)]
  const titleOf = (id: string) => sent.find((p) => p.id === id)?.title ?? id
  const body = (
    <>
      {b.partial.intro(result.failed.length)}
      <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
        {result.failed.map((f) => (
          <li key={f.id}>
            {/* One that still exists opens, so the reviewer can see what happened to it. */}
            {f.code === 'not_found' ? (
              <Box component="span" sx={emphasis.semibold}>
                {titleOf(f.id)}
              </Box>
            ) : (
              <Link component={RouterLink} to={modulePaths.product(f.id)} sx={emphasis.semibold}>
                {titleOf(f.id)}
              </Link>
            )}
            {`: ${b.errors[f.code]}`}
          </li>
        ))}
      </Box>
    </>
  )
  return [{ tone: 'warning', text: b.partial.banner(approved, sent.length, brand), body }, b.partial.toast(approved, sent.length, brand)]
}

type Props = {
  vendor: Vendor
  onProductsApproved: (banner: ProductsOutcome, message: string) => void
}

// The vendor's products. Those waiting for review open their review page and, for an approved
// brand, can be ticked and approved together, each with the version the reviewer saw.
export function ProductsTab({ vendor, onProductsApproved }: Props) {
  const approve = useApproveProducts(vendor.id)
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set())
  // Kept after closing (open: false) so the dialog keeps its words while it fades out.
  const [dialog, setDialog] = useState<{ open: boolean; products: Product[] } | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const listRef = useRef<HTMLUListElement>(null)
  // After an approval the button that opened the dialog is disabled (or gone with the toolbar), so
  // keyboard focus moves to the list once the dialog has closed. Cancel returns it to the button.
  const focusList = useRef(false)

  if (vendor.products.length === 0) {
    return (
      <Card>
        <EmptyState illustration="kurta" title={copy.empty.title} body={copy.empty.body} />
      </Card>
    )
  }

  // Only what is still waiting, at the version on screen, counts as ticked.
  const waiting = vendor.products.filter((p) => p.status === 'pending_review')
  const waitingKeys = new Set(waiting.map(versionKey))
  const selected = waiting.filter((p) => ticked.has(versionKey(p)))
  // Approving together publishes them, so only an approved brand has it. A suspended or rejected
  // brand's products are hidden from the app: each is still reviewed on its own page.
  const ticks = vendor.status === 'approved' && waiting.length > 0

  const tick = (product: Product, on: boolean) =>
    setTicked((prev) => {
      const next = new Set([...prev].filter((key) => waitingKeys.has(key)))
      if (on) next.add(versionKey(product))
      else next.delete(versionKey(product))
      return next
    })
  const tickAll = (on: boolean) => setTicked(on ? waitingKeys : new Set())

  const ask = () => {
    setFailure(null)
    setDialog({ open: true, products: selected })
  }
  const close = () => setDialog((d) => d && { ...d, open: false })
  const afterClose = () => {
    if (!focusList.current) return
    focusList.current = false
    listRef.current?.focus()
  }

  const confirm = async () => {
    if (!dialog) return
    const sent = dialog.products
    setFailure(null)
    try {
      const result = await approve.mutateAsync({ products: sent.map((p) => ({ id: p.id, submitted_at: p.submitted_at })) })
      close()
      // Every ticked product was sent and has an answer now; the banner says which went live.
      setTicked(new Set())
      const [banner, message] = outcomeOf(result, sent, vendor.brand_name)
      onProductsApproved(banner, message)
      focusList.current = true
    } catch (error) {
      // Nothing was approved: the dialog stays open with the reason, and the ticks stay.
      setFailure(error instanceof Error && error.message ? error.message : vendorActionsCopy.failed)
    }
  }

  return (
    <Card>
      {ticks && <BulkToolbar waiting={waiting.length} selected={selected.length} onAll={tickAll} onApprove={ask} />}
      <Box component="ul" ref={listRef} tabIndex={-1} aria-label={copy.label} sx={{ listStyle: 'none', p: 0, m: 0, '&:focus': { outline: 'none' } }}>
        {vendor.products.map((product) => (
          <ProductRow key={product.id} product={product} ticks={ticks} checked={ticked.has(versionKey(product))} onTick={(on) => tick(product, on)} />
        ))}
      </Box>
      {dialog && <ApproveProductsDialog open={dialog.open} brand={vendor.brand_name} products={dialog.products} sending={approve.isPending} failure={failure} onCancel={close} onConfirm={() => void confirm()} onExited={afterClose} />}
    </Card>
  )
}
