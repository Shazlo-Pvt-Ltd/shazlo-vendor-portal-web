import { Link, type LinkProps } from '@mui/material'
import type { ReactNode } from 'react'
import { safeHttpsUrl } from './safeUrl'

interface Props extends Omit<LinkProps, 'href' | 'target' | 'rel' | 'children'> {
  /** Comes from a vendor: only an `https:` address becomes a link. */
  href: string | null | undefined
  children: ReactNode
}

/**
 * A link to an address a vendor supplied. An unsafe address (`javascript:`, `http:`, ...) is shown
 * as plain text, never as a link. It opens in a new tab with `noopener noreferrer`.
 */
export function SafeLink({ href, children, ...rest }: Props) {
  const safe = safeHttpsUrl(href)
  if (safe === undefined) {
    return <span>{children}</span>
  }
  return (
    <Link {...rest} href={safe} target="_blank" rel="noopener noreferrer">
      {children}
    </Link>
  )
}
