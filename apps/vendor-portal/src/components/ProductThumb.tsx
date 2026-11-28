import { Box } from '@mui/material'
import { neutral, radius } from '@shazlo/ui'
import { ImageIcon } from 'lucide-react'
import { SafeImage } from '../security/SafeImage'

// Product photo for lists. Decorative (the title sits next to it), so alt is empty. The address
// comes from the seller's upload, so it goes through SafeImage: anything but https (or the app's
// own path) shows the empty frame instead.
export function ProductThumb({ src, size = 40 }: { src: string | null | undefined; size?: number }) {
  const placeholder = <ImageIcon size={Math.round(size * 0.4)} strokeWidth={1.25} aria-hidden="true" />
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
        '& > img': { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
      }}
    >
      <SafeImage src={src} alt="" fallback={placeholder} />
    </Box>
  )
}
