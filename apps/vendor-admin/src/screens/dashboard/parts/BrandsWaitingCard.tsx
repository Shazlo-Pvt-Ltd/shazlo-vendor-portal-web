import { Box, Link, Stack, Typography } from '@mui/material'
import { emphasis, EmptyState, SectionCard } from '@shazlo/ui'
import { Shirt } from 'lucide-react'
import { Link as RouterLink } from 'react-router'
import { CardTitle } from '../../../components/CardTitle'
import { RowChevron } from '../../../components/rows'
import { dashboardCopy } from '../../../copy/dashboard'
import { formatRelative } from '../../../lib/format'
import { useBrandsWaiting, type BrandWaiting } from './brandsWaiting'
import { inset, Loaded, rowLinkSx, rowSx, RowSkeletons, TextLink } from './common'
import { dashboardLinks as links } from './links'

const copy = dashboardCopy.brands
export const MAX_BRAND_ROWS = 8

// The whole row is one link to the brand's Products tab: name, how many wait, and the oldest wait.
function BrandRow({ brand }: { brand: BrandWaiting }) {
  return (
    <Box component="li" sx={rowSx}>
      <Link component={RouterLink} to={links.vendorProducts(brand.vendor.id)} underline="none" sx={rowLinkSx}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography component="span" variant="body1" sx={{ display: 'block', ...emphasis.semibold, color: 'text.primary', overflowWrap: 'anywhere' }}>
            {brand.vendor.name}
          </Typography>{' '}
          <Typography component="span" variant="body2" color="textSecondary" sx={{ display: 'block', mt: 0.25 }}>
            <Box component="span" sx={{ ...emphasis.semibold, color: 'text.primary' }}>
              {copy.waiting(brand.count)}
            </Box>{' '}
            <span aria-hidden="true">·</span> <time dateTime={brand.oldest}>{copy.oldest(formatRelative(brand.oldest))}</time>
          </Typography>
        </Box>
        <RowChevron />
      </Link>
    </Box>
  )
}

// Which brands have products waiting, most first, so a reviewer can open one brand and approve
// its products together.
export function BrandsWaitingCard() {
  const { query, brands } = useBrandsWaiting()
  return (
    <SectionCard title={<CardTitle icon={Shirt}>{copy.title}</CardTitle>} padded={false}>
      <Loaded query={query} data={brands} subject={copy.label} errorTitle={copy.error} bannerSx={{ ...inset, pb: 2 }} skeleton={<RowSkeletons label={copy.loading} />}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState illustration="box" title={copy.empty.title} body={copy.empty.body} />
          ) : (
            <>
              <Box component="ul" aria-label={copy.label} sx={{ listStyle: 'none', m: 0, p: 0 }}>
                {list.slice(0, MAX_BRAND_ROWS).map((brand) => (
                  <BrandRow key={brand.vendor.id} brand={brand} />
                ))}
              </Box>
              {list.length > MAX_BRAND_ROWS && (
                <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ ...inset, ...rowSx, py: 1, columnGap: 2, alignItems: { xs: 'flex-start', sm: 'center' }, justifyContent: 'space-between' }}>
                  <Typography variant="body2" color="textSecondary" sx={{ pt: { xs: 1, sm: 0 } }}>
                    {copy.more(list.length - MAX_BRAND_ROWS)}
                  </Typography>
                  <TextLink to={links.queueOf('product')}>{copy.seeAll}</TextLink>
                </Stack>
              )}
            </>
          )
        }
      </Loaded>
    </SectionCard>
  )
}
