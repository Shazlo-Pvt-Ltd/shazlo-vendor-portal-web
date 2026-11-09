import { Box } from '@mui/material'
import logo from '../assets/shazlo-logo.png'
import { brand, fontFamily, neutral, radius } from '../tokens'

// The brush wordmark plus the product tag ("Seller", "One"), as in the wireframes.
export function Logo({ product, height = 30 }: { product?: string; height?: number }) {
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
      <Box component="img" src={logo} alt="Shazlo" sx={{ height, width: 'auto', display: 'block' }} />
      {product && (
        <Box
          component="span"
          sx={{
            fontFamily: fontFamily.display,
            fontWeight: 600,
            fontSize: 11,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: brand.brown,
            border: `1px solid ${neutral.lineStrong}`,
            borderRadius: `${radius.control - 2}px`,
            px: 0.75,
            lineHeight: '18px',
          }}
        >
          {product}
        </Box>
      )}
    </Box>
  )
}
