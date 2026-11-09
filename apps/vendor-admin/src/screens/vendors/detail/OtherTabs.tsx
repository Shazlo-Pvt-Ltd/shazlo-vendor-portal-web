import { Box, Card, Link, Skeleton, Stack, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { brand, EmptyState, neutral, SectionCard, StatusPill, type PillStatus } from '@shazlo/ui'
import type { ReactNode } from 'react'
import { Link as RouterLink } from 'react-router'
import { useQueue } from '../../../api/queries'
import type { components } from '../../../api/schema'
import { modulePaths } from '../../../app/routes'
import { ProductThumb } from '../../../components/ProductThumb'
import { vendorDetailCopy } from '../../../copy/vendors'
import { formatDate, formatINR, formatStamp } from '../../../lib/format'

const copy = vendorDetailCopy
type Vendor = components['schemas']['VendorDetail']
type Product = Vendor['products'][number]

const productPill: Record<string, PillStatus> = { pending_review: 'pending', approved: 'live', rejected: 'sentBack' }

function ProductRow({ product }: { product: Product }) {
  const pending = product.status === 'pending_review'
  const row: ReactNode = (
    <Stack direction="row" spacing={2} sx={{ alignItems: 'center', minHeight: 64, px: { xs: 2, sm: 3 }, py: 1 }}>
      <ProductThumb src={product.thumbnail_url} size={40} />
      <Typography variant="body1" sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
        {product.title}
      </Typography>
      <StatusPill status={productPill[product.status] ?? 'draft'} label={copy.products.status[product.status] ?? product.status} />
      <Typography variant="body1" sx={{ width: 96, textAlign: 'right', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
        {formatINR(product.price_paise)}
      </Typography>
    </Stack>
  )
  return (
    <Box component="li" sx={{ borderTop: `1px solid ${neutral.line}`, '&:first-of-type': { borderTop: 0 } }}>
      {pending ? (
        <Link component={RouterLink} to={modulePaths.product(product.id)} underline="none" sx={{ display: 'block', color: 'inherit', '@media (hover: hover)': { '&:hover': { bgcolor: alpha(brand.cream, 0.25) } } }}>
          {row}
        </Link>
      ) : (
        row
      )}
    </Box>
  )
}

export function ProductsTab({ vendor }: { vendor: Vendor }) {
  if (vendor.products.length === 0) {
    return (
      <Card>
        <EmptyState illustration="kurta" title={copy.products.empty.title} body={copy.products.empty.body} />
      </Card>
    )
  }
  return (
    <Card>
      <Box component="ul" aria-label={copy.products.label} sx={{ listStyle: 'none', p: 0, m: 0 }}>
        {vendor.products.map((product) => (
          <ProductRow key={product.id} product={product} />
        ))}
      </Box>
    </Card>
  )
}

// Whether a page is live comes with the vendor; a waiting draft is an item in the review queue.
export function BrandTab({ vendor }: { vendor: Vendor }) {
  const queue = useQueue({ kind: 'brand_page', vendor: vendor.id })
  const waiting = queue.data?.items.find((item) => item.kind === 'brand_page' && item.subject_id === vendor.id)
  let draft: ReactNode
  if (queue.isPending) draft = <Skeleton variant="text" width={320} />
  else if (queue.isError) draft = <Typography variant="body1" color="text.secondary">{copy.brand.error}</Typography>
  else if (waiting)
    draft = (
      <Stack spacing={1}>
        <Typography variant="body1">{copy.brand.waiting(formatDate(waiting.submitted_at))}</Typography>
        <Box>
          <Link component={RouterLink} to={modulePaths.brand(vendor.id)}>
            {copy.brand.review}
          </Link>
        </Box>
      </Stack>
    )
  else draft = <Typography variant="body1" color="text.secondary">{copy.brand.nothingWaiting}</Typography>

  return (
    <SectionCard title={copy.brand.title}>
      <Stack spacing={2} sx={{ maxWidth: '68ch' }}>
        <Typography variant="body1">{vendor.brand_live ? copy.brand.live : copy.brand.notLive}</Typography>
        {draft}
      </Stack>
    </SectionCard>
  )
}

export function ActivityTab({ vendor }: { vendor: Vendor }) {
  const c = copy.activity
  return (
    <SectionCard title={c.title}>
      {vendor.history.length === 0 ? (
        <Typography variant="body1" color="text.secondary">
          {c.empty}
        </Typography>
      ) : (
        <Box component="ol" aria-label={c.label} sx={{ listStyle: 'none', p: 0, m: 0 }}>
          {vendor.history.map((entry, i) => (
            <Stack key={`${entry.at}-${entry.event}-${i}`} component="li" direction="row" spacing={2} sx={{ position: 'relative', pb: i === vendor.history.length - 1 ? 0 : 2.5 }}>
              <Box aria-hidden="true" sx={{ position: 'relative', width: 10, flexShrink: 0 }}>
                <Box sx={{ width: 10, height: 10, mt: '5px', borderRadius: '50%', border: `2px solid ${brand.brown}`, bgcolor: neutral.surface }} />
                {i < vendor.history.length - 1 && <Box sx={{ position: 'absolute', left: 4, top: 17, bottom: -3, width: 2, bgcolor: neutral.line }} />}
              </Box>
              <Box sx={{ minWidth: 0, maxWidth: '68ch' }}>
                <Typography variant="body1">{c.events[entry.event]}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {`${c.by(entry.by)} · `}
                  <Box component="time" dateTime={entry.at}>
                    {formatStamp(entry.at)}
                  </Box>
                </Typography>
                {entry.note && (
                  <Typography variant="body2" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>
                    {`“${entry.note}”`}
                  </Typography>
                )}
              </Box>
            </Stack>
          ))}
        </Box>
      )}
    </SectionCard>
  )
}
