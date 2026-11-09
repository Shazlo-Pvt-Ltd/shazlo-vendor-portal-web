import { Box, Card, CardActionArea, LinearProgress, Skeleton, Stack, Typography } from '@mui/material'
import { neutral } from '@shazlo/ui'
import { Link as RouterLink } from 'react-router'
import type { Schemas } from '../../../api/client'
import { paths } from '../../../app/paths'
import { ProductThumb } from '../../../components/ProductThumb'
import { productsCopy } from '../../../copy/products'
import { formatCount } from '../../../lib/format'
import { Pills, Price } from './ProductTable'

type Product = Schemas['ProductSummary']

// Phones (V-06m): a card per product; tapping one opens the editor. No selection on phones.
export function ProductCards({ items, fetching }: { items: Product[] | undefined; fetching: boolean }) {
  if (!items) {
    return (
      <Stack spacing={1.5} role="status" aria-label={productsCopy.loading} aria-busy="true">
        {Array.from({ length: 4 }, (_, i) => (
          <Card key={i} sx={{ p: 1.5, display: 'flex', gap: 1.5 }}>
            <Skeleton variant="rounded" width={56} height={70} />
            <Box sx={{ flex: 1 }}>
              <Skeleton variant="text" width="80%" />
              <Skeleton variant="text" width={90} height={14} />
              <Skeleton variant="text" width="50%" sx={{ mt: 1 }} />
            </Box>
          </Card>
        ))}
      </Stack>
    )
  }

  return (
    <Box sx={{ position: 'relative' }}>
      <Box sx={{ position: 'absolute', top: -8, left: 0, right: 0, height: 2 }}>{fetching && <LinearProgress aria-label={productsCopy.updating} sx={{ height: 2 }} />}</Box>
      <Box component="ul" role="list" aria-label={productsCopy.table.label} sx={{ listStyle: 'none', p: 0, m: 0, display: 'grid', gap: 1.5 }}>
        {items.map((product) => (
          <Box component="li" key={product.id}>
            <Card>
              <CardActionArea component={RouterLink} to={paths.product(product.id)} sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-start', gap: 1.5, p: 1.5, minHeight: 44 }}>
                <ProductThumb src={product.thumbnail_url} size={56} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body1" sx={{ color: neutral.ink, overflowWrap: 'anywhere' }}>
                    {product.title}
                  </Typography>
                  <Typography variant="mono" component="div" color="text.secondary">
                    {product.sku}
                  </Typography>
                  <Stack direction="row" spacing={2} sx={{ alignItems: 'baseline', justifyContent: 'space-between', mt: 1 }}>
                    <Price product={product} align="left" />
                    <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      {productsCopy.card.stock(formatCount(product.stock))}
                    </Typography>
                  </Stack>
                  <Box sx={{ mt: 1 }}>
                    <Pills product={product} />
                  </Box>
                </Box>
              </CardActionArea>
            </Card>
          </Box>
        ))}
      </Box>
    </Box>
  )
}
