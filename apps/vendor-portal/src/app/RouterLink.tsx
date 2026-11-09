import { Link } from 'react-router'
import type { UiLinkProps } from '@shazlo/ui/components'

/** Lets @shazlo/ui components navigate with react-router. */
export function RouterLink({ to, ...rest }: UiLinkProps) {
  return <Link to={to} {...rest} />
}
