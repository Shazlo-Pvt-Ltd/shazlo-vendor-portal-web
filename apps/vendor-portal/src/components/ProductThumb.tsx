import { Box } from '@mui/material'
import { neutral, radius } from '@shazlo/ui'
import { ImageIcon } from 'lucide-react'

// Product photo for lists. Decorative (the title sits next to it), so alt is empty.
export function ProductThumb({ src, size = 40 }: { src: string | null | undefined; size?: number }) {
  return (
    <Box
      sx={{
        width: size,
        height: Math.round(size * 1.25),
        flexShrink: 0,
        borderRadius: `${radius.control}px`,
        overflow: 'hidden',
        bgcolor: neutral.placeholder,
        display: 'grid',
        placeItems: 'center',
        color: neutral.lineStrong,
      }}
    >
      {src ? <Box component="img" src={src} alt="" loading="lazy" sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : <ImageIcon size={Math.round(size * 0.4)} strokeWidth={1.25} aria-hidden="true" />}
    </Box>
  )
}
