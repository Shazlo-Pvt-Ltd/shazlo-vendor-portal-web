import { Box, Link, Skeleton, Stack, Typography } from '@mui/material'
import { brand, emphasis, neutral, SectionCard } from '@shazlo/ui'
import { History, Store } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link as RouterLink } from 'react-router'
import { useQueue } from '../../../api/queries'
import type * as M from '../../../api/model'
import { modulePaths } from '../../../app/routes'
import { CardTitle } from '../../../components/CardTitle'
import { vendorDetailCopy } from '../../../copy/vendors'
import { formatDate, formatStamp } from '../../../lib/format'

const copy = vendorDetailCopy
type Vendor = M.VendorDetail

// Whether a page is live comes with the vendor; a waiting draft is an item in the review queue.
export function BrandTab({ vendor }: { vendor: Vendor }) {
  const queue = useQueue({ kind: 'brand_page', vendor: vendor.id })
  const waiting = queue.data?.items.find((item) => item.kind === 'brand_page' && item.subject_id === vendor.id)
  let draft: ReactNode
  if (queue.isPending) draft = <Skeleton variant="text" width={320} />
  else if (queue.isError) draft = <Typography variant="body1" color="textSecondary">{copy.brand.error}</Typography>
  else if (waiting)
    draft = (
      <Stack spacing={1}>
        <Typography variant="body1">{copy.brand.waiting(formatDate(waiting.submitted_at))}</Typography>
        <Box>
          <Link component={RouterLink} to={modulePaths.brand(waiting.id)}>
            {copy.brand.review}
          </Link>
        </Box>
      </Stack>
    )
  else draft = <Typography variant="body1" color="textSecondary">{copy.brand.nothingWaiting}</Typography>

  return (
    <SectionCard title={<CardTitle icon={Store}>{copy.brand.title}</CardTitle>}>
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
    <SectionCard title={<CardTitle icon={History}>{c.title}</CardTitle>}>
      {vendor.history.length === 0 ? (
        <Typography variant="body1" color="textSecondary">
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
                <Typography variant="body1" sx={emphasis.semibold}>
                  {c.events[entry.event]}
                </Typography>
                <Typography variant="body2" color="textSecondary">
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
