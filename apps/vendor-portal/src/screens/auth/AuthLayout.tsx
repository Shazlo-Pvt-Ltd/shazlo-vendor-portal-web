import { styled } from '@mui/material/styles'
import type { ReactNode } from 'react'
import { Icon, kit, Logo, textStyle } from '@shazlo/ui/components'

// Shared frame of the Access boards (Penpot V-01, V-02, V-03): a 76 px top row with the
// Shazlo wordmark and SELLER tag (24/40 padding), the page content, and on V-01 a row of
// legal links. V-02 swaps the help contact for "Already approved? Sign in"; V-03 shows the
// logo alone and has no footer.

export const PARTNERS_EMAIL = 'partners@shazlo.store'

/** Storefront that hosts the legal pages. Set VITE_STOREFRONT_URL to point the links elsewhere. */
const STOREFRONT = (import.meta.env.VITE_STOREFRONT_URL as string | undefined)?.replace(/\/+$/, '') || 'https://shazlo.store'

/** Public pages on the storefront; the portal has no copy of these, so they open in a new tab. */
export const legalLinks = [
  { label: 'Seller terms', href: `${STOREFRONT}/pages/seller-terms` },
  { label: 'Privacy', href: `${STOREFRONT}/pages/privacy` },
  { label: 'Commission & payouts', href: `${STOREFRONT}/pages/commission-and-payouts` },
] as const

const MOBILE = '@media (max-width: 600px)'

const Page = styled('div')({
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  background: kit.canvas,
})

const Top = styled('header')({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  padding: '24px 40px',
  minHeight: 76,
  [MOBILE]: { padding: '16px', minHeight: 60 },
})

const HelpLink = styled('a')({
  ...textStyle.small,
  color: kit.muted,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  textDecoration: 'none',
  whiteSpace: 'nowrap',
  borderRadius: 4,
  '&:hover .shz-help-email': { textDecoration: 'underline', textUnderlineOffset: 2 },
  '&:focus-visible': { outline: `2px solid ${kit.focus}`, outlineOffset: 2 },
  [MOBILE]: { minHeight: 44, '& .shz-help-prefix': { display: 'none' } },
})

const Main = styled('main', { shouldForwardProp: p => p !== 'center' })<{ center: boolean }>(({ center }) => ({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: center ? 'center' : 'stretch',
  justifyContent: center ? 'center' : 'flex-start',
  padding: center ? '16px 40px' : 0,
  minWidth: 0,
  [MOBILE]: { padding: center ? '8px 16px 24px' : 0 },
}))

const Bottom = styled('footer')({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexWrap: 'wrap',
  columnGap: 24,
  rowGap: 8,
  padding: '20px 40px',
  '& a': { ...textStyle.caption, color: kit.subtle, textDecoration: 'none', borderRadius: 2 },
  '& a:hover': { textDecoration: 'underline', textUnderlineOffset: 2 },
  '& a:focus-visible': { outline: `2px solid ${kit.focus}`, outlineOffset: 2 },
  // 44 px tall tap targets on phones.
  [MOBILE]: { padding: '4px 16px 8px', '& a': { padding: '14px 0' } },
})

/** "Need help? partners@shazlo.store" with the help icon (V-01 top right). */
export function HelpContact() {
  return (
    <HelpLink href={`mailto:${PARTNERS_EMAIL}`}>
      <Icon name="help" size={16} />
      <span><span className="shz-help-prefix">Need help? </span><span className="shz-help-email">{PARTNERS_EMAIL}</span></span>
    </HelpLink>
  )
}

export function AuthLayout({ aside = <HelpContact />, footer = true, center = true, children }: {
  /** Right side of the top row. Pass `null` for the logo alone (V-03). */
  aside?: ReactNode
  /** Legal links row under the content (V-01). */
  footer?: boolean
  /** Centre the content in the space left (V-01, V-03); V-02's long form starts at the top. */
  center?: boolean
  children: ReactNode
}) {
  return (
    <Page>
      <Top>
        <Logo tag="SELLER" />
        {aside}
      </Top>
      <Main center={center}>{children}</Main>
      {footer && (
        <Bottom>
          <nav aria-label="Seller policies" style={{ display: 'contents' }}>
            {legalLinks.map(l => <a key={l.href} href={l.href} target="_blank" rel="noreferrer">{l.label}<span className="shz-visually-hidden"> (opens in a new tab)</span></a>)}
          </nav>
        </Bottom>
      )}
    </Page>
  )
}
