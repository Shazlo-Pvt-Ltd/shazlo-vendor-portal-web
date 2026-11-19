import { Box, Chip, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { useId } from 'react'
import { SafeImage } from '../../security/SafeImage'
import { GENDERS, formatPaise, type Revision } from './form'

interface Props {
  revision: Revision
  title: string
  description: string
}

/** A revision as it stands, read-only: the live version shoppers see now, beside the one being edited. */
export function RevisionPanel({ revision, title, description }: Props) {
  const headingId = useId()
  const gender = GENDERS.find((g) => g.value === revision.gender)?.label ?? revision.gender
  const images = [...revision.images].sort((a, b) => a.position - b.position)
  return (
    <Paper component="section" variant="outlined" aria-labelledby={headingId} sx={{ p: 2, minWidth: 0 }}>
      <Typography id={headingId} component="h2" variant="h6">
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {description}
      </Typography>

      {images.length > 0 ? (
        <Stack direction="row" spacing={1} sx={{ mb: 2, overflowX: 'auto' }}>
          {images.map((image, index) => (
            <Box key={image.asset_id} sx={{ width: 72, height: 72, flexShrink: 0, borderRadius: 1, overflow: 'hidden', bgcolor: 'action.hover' }}>
              <SafeImage
                src={image.url}
                alt={image.alt_text ?? (index === 0 ? 'Cover image' : `Image ${index + 1}`)}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </Box>
          ))}
        </Stack>
      ) : null}

      {/* Text the vendor typed is rendered as text; React escapes it. */}
      <Typography variant="subtitle1" sx={{ overflowWrap: 'anywhere' }}>
        {revision.title}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {[revision.category, revision.subcategory, gender, revision.fabric].filter(Boolean).join(' · ')}
      </Typography>
      {revision.description ? (
        <Typography variant="body2" sx={{ whiteSpace: 'pre-line', overflowWrap: 'anywhere', mb: 1 }}>
          {revision.description}
        </Typography>
      ) : null}
      <Typography variant="body2" sx={{ mb: 2 }}>
        {revision.returnable ? `Returnable within ${revision.return_window_days ?? 0} days` : 'Not returnable'}
        {revision.weight_grams ? ` · ${revision.weight_grams} g` : ''}
      </Typography>

      {revision.variants.length > 0 ? (
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" aria-label={`${title}: variants`}>
            <TableHead>
              <TableRow>
                <TableCell>SKU</TableCell>
                <TableCell>Size</TableCell>
                <TableCell>Colour</TableCell>
                <TableCell align="right">Price</TableCell>
                <TableCell align="right">MRP</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {revision.variants.map((variant) => (
                <TableRow key={variant.id}>
                  <TableCell>
                    {variant.sku}
                    {variant.is_active ? null : <Chip size="small" variant="outlined" label="Not on sale" sx={{ ml: 1 }} />}
                  </TableCell>
                  <TableCell>{variant.size || '—'}</TableCell>
                  <TableCell>{variant.color || '—'}</TableCell>
                  <TableCell align="right">{formatPaise(variant.price_paise)}</TableCell>
                  <TableCell align="right">{formatPaise(variant.mrp_paise)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      ) : (
        <Typography variant="body2" color="text.secondary">
          No variants.
        </Typography>
      )}
    </Paper>
  )
}
