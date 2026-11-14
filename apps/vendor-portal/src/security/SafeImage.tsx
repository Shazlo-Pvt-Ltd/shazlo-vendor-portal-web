import type { ImgHTMLAttributes, ReactNode } from 'react'
import { safeHttpsUrl } from './safeUrl'

interface Props extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'referrerPolicy' | 'alt'> {
  /** Comes from a vendor or from vendor-api: only an `https:` address is loaded. */
  src: string | null | undefined
  /** Required: describe the image, or pass an empty string for a purely decorative one. */
  alt: string
  /** Shown when the address is not safe. */
  fallback?: ReactNode
}

/** An image from an address a vendor supplied. Sends no referrer and loads lazily. */
export function SafeImage({ src, alt, fallback = null, ...rest }: Props) {
  const safe = safeHttpsUrl(src)
  if (safe === undefined) {
    return <>{fallback}</>
  }
  return <img {...rest} src={safe} alt={alt} referrerPolicy="no-referrer" loading="lazy" decoding="async" />
}
