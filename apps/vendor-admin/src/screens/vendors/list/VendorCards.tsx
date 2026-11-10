import { Box, IconButton, Link, Stack, Typography } from '@mui/material'
import { neutral, StatusPill } from '@shazlo/ui'
import { MoreHorizontal } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link as RouterLink } from 'react-router'
import type { components } from '../../../api/schema'
import { modulePaths } from '../../../app/routes'
import { aboveStretch, CardList, ListCard, stretchSx } from '../../../components/CardList'
import { vendorsCopy } from '../../../copy/vendors'
import { formatCount, formatDate } from '../../../lib/format'
import { vendorPill } from '../../../lib/status'
import { formatCommission } from './csv'
import { BrandAvatar, isApplication } from './VendorTable'

const copy = vendorsCopy.table
type Vendor = components['schemas']['VendorSummary']

const tabular = { fontVariantNumeric: 'tabular-nums' } as const

// A label over its value, for the three small facts along the bottom of a card.
function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography component="dt" variant="caption" color="text.secondary">
        {term}
      </Typography>
      <Typography component="dd" variant="body2" sx={{ m: 0, overflowWrap: 'break-word' }}>
        {children}
      </Typography>
    </Box>
  )
}

function VendorCard({ vendor, onMenu }: { vendor: Vendor; onMenu: (anchor: HTMLElement, vendor: Vendor) => void }) {
  const pill = vendorPill[vendor.status]
  const sells = vendor.sells.length === 0 ? '—' : vendor.sells.slice(0, 2).join(', ') + (vendor.sells.length > 2 ? ` ${copy.more(vendor.sells.length - 2)}` : '')
  return (
    <ListCard>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
        <BrandAvatar name={vendor.brand_name} size={40} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Link component={RouterLink} to={modulePaths.vendor(vendor.id)} data-stretch="" underline="none" variant="body1" sx={{ ...stretchSx, display: 'block', color: neutral.ink, overflowWrap: 'break-word' }}>
            {vendor.brand_name}
          </Link>
          <Typography variant="caption" component="div" color="text.secondary">
            {vendor.city}
          </Typography>
        </Box>
        {!isApplication(vendor) && (
          <IconButton
            aria-label={copy.actions(vendor.brand_name)}
            aria-haspopup="menu"
            onClick={(event) => onMenu(event.currentTarget, vendor)}
            sx={{ ...aboveStretch, width: 44, height: 44, mt: -0.5, mr: -1, color: neutral.inkSecondary }}
          >
            <MoreHorizontal size={18} strokeWidth={1.5} aria-hidden="true" />
          </IconButton>
        )}
      </Stack>
      <Stack direction="row" useFlexGap sx={{ mt: 1.25, gap: 1, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <StatusPill status={pill.status} label={pill.label} />
        <Typography variant="caption" color="text.secondary" component="span">
          {`${copy.since} ${formatDate(vendor.since)}`}
        </Typography>
      </Stack>
      <Typography variant="body2" component="div" sx={{ mt: 1.25 }}>
        {vendor.owner_name}
        <Typography variant="mono" component="span" color="text.secondary" sx={{ ml: 1, whiteSpace: 'nowrap' }}>
          {vendor.phone}
        </Typography>
      </Typography>
      <Box component="dl" sx={{ m: 0, mt: 1.25, pt: 1.25, borderTop: `1px solid ${neutral.line}`, display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr)', gap: 1.5 }}>
        <Fact term={copy.sells}>{sells}</Fact>
        <Fact term={copy.liveProducts}>
          <Box component="span" sx={tabular}>
            {formatCount(vendor.live_products)}
          </Box>
        </Fact>
        <Fact term={copy.commission}>
          <Box component="span" sx={tabular}>
            {formatCommission(vendor.commission_bps)}
          </Box>
        </Fact>
      </Box>
    </ListCard>
  )
}

// A-08 on frames under 900 px: each vendor a card that opens it; approved and suspended vendors
// keep their row menu.
export function VendorCards({ items, fetching, onMenu }: { items: Vendor[] | undefined; fetching: boolean; onMenu: (anchor: HTMLElement, vendor: Vendor) => void }) {
  return (
    <CardList label={copy.label} loading={items === undefined} fetching={fetching} updatingLabel={vendorsCopy.updating}>
      {items?.map((vendor) => (
        <VendorCard key={vendor.id} vendor={vendor} onMenu={onMenu} />
      ))}
    </CardList>
  )
}
