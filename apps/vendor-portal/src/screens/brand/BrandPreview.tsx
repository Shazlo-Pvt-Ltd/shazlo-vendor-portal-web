import { Box, Skeleton, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { brand, emphasis, Logo, neutral, radius, shadow } from '@shazlo/ui'
import { AtSign, BatteryFull, Bookmark, ChevronLeft, Eye, Globe, House, ImageIcon, MapPin, RotateCcw, Search, Share, ShoppingBag, Signal, Truck, User, Wifi, type LucideIcon } from 'lucide-react'
import { memo, useId, useState, type ReactNode } from 'react'
import type { Schemas } from '../../api/model'
import { useProducts, useStoreDetails } from '../../api/queries'
import { brandCopy as copy } from '../../copy/brand'
import { catalogCopy } from '../../copy/catalog'
import { formatINR } from '../../lib/format'
import { SafeImage } from '../../security/SafeImage'
import { SafeLink } from '../../security/SafeLink'
import { safeImageUrl } from '../../security/safeUrl'
import { COVER_RATIO, cityOf, initials, instagramHref, normaliseInstagram, websiteHref, type Profile } from './schema'

// "Preview in the Shazlo app" (V-05): the brand page as the Shazlo app will show it. The app has
// no brand page yet, so this defines it, as a native screen of that app (its status bar, top bar
// and five-icon tab bar, read from the app's TabBar and Home screens) in Shazlo's own colours and type.

type Version = 'draft' | 'live'

// The screen is laid out in an iPhone's logical points (390 × 844) and drawn smaller: every size
// inside is a share of the screen's width (container query units), so the phone keeps its
// proportions at any size, exactly as a screenshot scaled down would.
const SCREEN = { width: 390, height: 844 } as const
const u = (points: number) => `calc(${points} * 100cqw / ${SCREEN.width})`
const BEZEL_PX = 9
// As wide as the column allows, no taller than the window (so the whole phone stays in view beside
// the form), and never more than 340 px of screen.
const PHONE_WIDTH = `clamp(${240 + 2 * BEZEL_PX}px, min(100%, calc((100dvh - 230px) * ${(SCREEN.width / SCREEN.height).toFixed(4)} + ${2 * BEZEL_PX}px)), ${340 + 2 * BEZEL_PX}px)`

/** The phone's outline, for the editor's loading skeleton. */
export const PHONE_OUTLINE = { width: PHONE_WIDTH, maxWidth: '100%', aspectRatio: `${SCREEN.width + 2 * BEZEL_PX} / ${SCREEN.height + 2 * BEZEL_PX}`, borderRadius: '44px' } as const

// The page's background: the logo's ring takes the same colour, so the logo stands clear of the cover.
const PAGE = neutral.surface
const TILE_PHOTO = { aspectRatio: '3 / 4', borderRadius: u(8), overflow: 'hidden', bgcolor: neutral.placeholder } as const
// Lucide icons drawn at a share of the screen, 1.75 strokes like the rest of the portal.
const icon = (points: number) => ({ display: 'inline-flex', flexShrink: 0, '& svg': { width: u(points), height: u(points) } }) as const
const STROKE = 1.75

function Glyph({ icon: Icon, size, strokeWidth = STROKE }: { icon: LucideIcon; size: number; strokeWidth?: number }) {
  return (
    <Box component="span" sx={icon(size)}>
      <Icon strokeWidth={strokeWidth} aria-hidden="true" />
    </Box>
  )
}

function Meta({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: u(4), minWidth: 0, overflowWrap: 'anywhere' }}>
      <Glyph icon={Icon} size={15} />
      {children}
    </Box>
  )
}

// ---- the app's chrome (decoration: hidden from screen readers) -------------------------------------

function StatusBar() {
  return (
    <Box data-part="status-bar" aria-hidden="true" sx={{ position: 'relative', flexShrink: 0, height: u(50), px: u(30), display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: neutral.ink }}>
      <Box component="span" sx={{ ...emphasis.semibold, fontSize: u(15), lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
        {copy.preview.time}
      </Box>
      {/* The camera island. */}
      <Box sx={{ position: 'absolute', top: u(11), left: '50%', transform: 'translateX(-50%)', width: u(120), height: u(34), borderRadius: `${radius.pill}px`, bgcolor: neutral.ink }} />
      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: u(5) }}>
        <Glyph icon={Signal} size={16} strokeWidth={2.25} />
        <Glyph icon={Wifi} size={16} strokeWidth={2.25} />
        <Glyph icon={BatteryFull} size={22} strokeWidth={1.75} />
      </Box>
    </Box>
  )
}

// Back, the Shazlo wordmark (as the app's store screens head their pages) and share.
function TopBar() {
  return (
    <Box data-part="top-bar" aria-hidden="true" sx={{ flexShrink: 0, height: u(44), px: u(10), display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: neutral.ink }}>
      <Glyph icon={ChevronLeft} size={26} />
      <Box sx={{ display: 'inline-flex', '& [role="img"]': { width: `${u(67)} !important`, height: `${u(20)} !important` } }}>
        <Logo height={20} tone="navy" />
      </Box>
      <Glyph icon={Share} size={21} />
    </Box>
  )
}

const TABS: { icon: LucideIcon; active?: boolean }[] = [{ icon: House }, { icon: Bookmark }, { icon: Search, active: true }, { icon: ShoppingBag }, { icon: User }]

// The app's tab bar: five icons without words over a fade into the page, Search lit (shoppers reach
// a brand from Search), and the home indicator.
function TabBar() {
  return (
    <Box
      data-part="tab-bar"
      aria-hidden="true"
      sx={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: u(86),
        pt: u(12),
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-around',
        backgroundImage: `linear-gradient(to top, ${PAGE} 72%, transparent)`,
      }}
    >
      {TABS.map(({ icon: Icon, active }, i) => (
        <Box key={i} component="span" sx={{ color: active ? neutral.ink : neutral.inkTertiary }}>
          <Glyph icon={Icon} size={25} strokeWidth={active ? 2.25 : STROKE} />
        </Box>
      ))}
      <Box sx={{ position: 'absolute', bottom: u(8), left: '50%', transform: 'translateX(-50%)', width: u(134), height: u(5), borderRadius: `${radius.pill}px`, bgcolor: neutral.ink }} />
    </Box>
  )
}

// ---- the brand page ----------------------------------------------------------------------------------

// Full width at 8:3, the shape the editor asks for. No cover yet: a calm tint of the page's colours.
function Cover({ url }: { url: string | null }) {
  const empty = safeImageUrl(url) === undefined
  return (
    <Box
      data-part="cover"
      data-empty={empty ? 'true' : undefined}
      sx={{
        flexShrink: 0,
        width: '100%',
        aspectRatio: COVER_RATIO,
        bgcolor: neutral.placeholder,
        backgroundImage: empty ? `linear-gradient(160deg, ${brand.canvas}, ${neutral.placeholder})` : 'none',
        '& > img': { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
      }}
    >
      {!empty && <SafeImage src={url} alt="" />}
    </Box>
  )
}

// A circle half over the cover's lower edge, ringed in the page colour with a soft shadow, so it
// never melts into a busy cover. The initials until a logo is added.
const LOGO = 84
function BrandLogo({ url, name }: { url: string | null; name: string }) {
  return (
    <Box
      data-part="logo"
      sx={{
        position: 'relative',
        boxSizing: 'border-box',
        width: u(LOGO),
        height: u(LOGO),
        mt: u(-LOGO / 2),
        borderRadius: '50%',
        borderWidth: u(4),
        borderStyle: 'solid',
        borderColor: PAGE,
        boxShadow: shadow.overlay,
        overflow: 'hidden',
        display: 'grid',
        placeItems: 'center',
        bgcolor: brand.cream,
        color: brand.brown,
        '& > img': { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
      }}
    >
      <SafeImage
        src={url}
        alt=""
        fallback={
          <Box component="span" aria-hidden="true" sx={{ ...emphasis.semibold, fontSize: u(28), lineHeight: 1, letterSpacing: 0 }}>
            {initials(name)}
          </Box>
        }
      />
    </Box>
  )
}

function Tile({ product }: { product: Schemas['ProductSummary'] }) {
  return (
    <Box component="li" sx={{ minWidth: 0 }}>
      <Box sx={{ ...TILE_PHOTO, display: 'grid', placeItems: 'center', color: neutral.lineStrong, '& > img': { width: '100%', height: '100%', objectFit: 'cover', display: 'block' } }}>
        <SafeImage src={product.thumbnail_url} alt="" fallback={<Glyph icon={ImageIcon} size={22} />} />
      </Box>
      <Typography component="p" noWrap title={product.title} sx={{ mt: u(6), fontSize: u(13), lineHeight: 1.35, color: neutral.ink }}>
        {product.title}
      </Typography>
      <Typography component="p" sx={{ ...emphasis.semibold, fontSize: u(13), lineHeight: 1.35, color: neutral.ink, fontVariantNumeric: 'tabular-nums' }}>
        {formatINR(product.price_paise)}
      </Typography>
    </Box>
  )
}

const grid = { listStyle: 'none', p: 0, m: 0, mt: u(12), display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', columnGap: u(12), rowGap: u(18) } as const

// The first four approved products (drafts and products in review never show in the app), as
// tiles in the app's two columns of 3:4 photos.
const ProductTiles = memo(function ProductTiles() {
  const products = useProducts({ status: 'approved', limit: 4 })
  const items = products.data?.items ?? []
  if (products.isPending) {
    return (
      <Box sx={grid} aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <Box key={i}>
            <Skeleton variant="rounded" sx={{ ...TILE_PHOTO, height: 'auto' }} />
            <Skeleton variant="text" width="80%" />
          </Box>
        ))}
      </Box>
    )
  }
  if (items.length === 0) {
    // Nothing approved yet (or it did not load): empty tiles hold the shape; the caption explains.
    return (
      <Box sx={grid} aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <Box key={i} data-tile="empty" sx={TILE_PHOTO} />
        ))}
      </Box>
    )
  }
  return (
    <Box component="ul" sx={grid}>
      {items.map((p) => (
        <Tile key={p.id} product={p} />
      ))}
    </Box>
  )
})

// Delivery and returns as the app shows them, from Store details (spec §5); nothing until saved.
function storeLines(details: Schemas['StoreDetails'] | undefined): { delivery: string | null; returns: string | null } {
  const d = details?.delivery
  const r = details?.returns
  return {
    delivery: d?.mode === 'shazlo' ? copy.preview.shazloDelivery : d?.mode === 'own' ? copy.preview.deliversIn(catalogCopy.delivery.days[d.delivery_days]) : null,
    returns: !r ? null : r.window_days === 0 ? copy.preview.noReturns : copy.preview.returnDays(r.window_days),
  }
}

// Instagram and the website, as the app links them. Typed by the seller, so only through SafeLink:
// an address that is not a plain https one is never a link.
function Links({ profile }: { profile: Profile }) {
  const website = websiteHref(profile.website)
  const instagram = instagramHref(profile.instagram)
  if (!website && !instagram) return null
  const link = { color: neutral.ink, textDecorationColor: neutral.lineStrong } as const
  return (
    <Stack data-part="links" direction="row" sx={{ flexWrap: 'wrap', columnGap: u(16), rowGap: u(6), mt: u(12), fontSize: u(13), lineHeight: 1.4, color: brand.brown }}>
      {instagram && (
        <Meta icon={AtSign}>
          <SafeLink href={instagram} sx={link}>{`@${normaliseInstagram(profile.instagram)}`}</SafeLink>
        </Meta>
      )}
      {website && (
        <Meta icon={Globe}>
          <SafeLink href={website} sx={link}>
            {copy.preview.website}
          </SafeLink>
        </Meta>
      )}
    </Stack>
  )
}

const wrap = { overflowWrap: 'anywhere', whiteSpace: 'normal' } as const

// The phone: a 390 × 844 screen with the app's bars; the page scrolls between them.
function Phone({ profile }: { profile: Profile }) {
  const city = cityOf(profile.based_in)
  const store = storeLines(useStoreDetails().data)
  const hasMeta = Boolean(city || store.delivery || store.returns)
  return (
    <Box
      data-phone="device"
      sx={{ width: PHONE_WIDTH, maxWidth: '100%', mx: 'auto', boxSizing: 'border-box', p: `${BEZEL_PX}px`, borderRadius: PHONE_OUTLINE.borderRadius, bgcolor: neutral.ink, boxShadow: shadow.overlay }}
    >
      <Box
        data-phone="screen"
        sx={{
          containerType: 'inline-size',
          position: 'relative',
          width: '100%',
          aspectRatio: `${SCREEN.width} / ${SCREEN.height}`,
          borderRadius: `${44 - BEZEL_PX}px`,
          overflow: 'hidden',
          bgcolor: PAGE,
          color: neutral.ink,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <StatusBar />
        <TopBar />
        <Box
          // The page scrolls inside the phone, as it would on one; keyboard users can focus it to scroll.
          role="group"
          aria-label={copy.preview.screen}
          tabIndex={0}
          sx={{ flex: 1, minHeight: 0, overflowY: 'auto', scrollbarWidth: 'none', pb: u(104), '&:focus-visible': { outlineOffset: '-2px' } }}
        >
          <Cover url={profile.cover_url} />
          <Box sx={{ px: u(16) }}>
            <BrandLogo url={profile.logo_url} name={profile.brand_name} />
            <Typography data-part="name" component="p" sx={{ ...emphasis.semibold, ...wrap, mt: u(10), fontSize: u(24), lineHeight: 1.2, letterSpacing: '-0.01em', color: neutral.ink }}>
              {profile.brand_name}
            </Typography>
            {hasMeta && (
              <Stack data-part="meta" direction="row" sx={{ flexWrap: 'wrap', columnGap: u(14), rowGap: u(6), mt: u(12), fontSize: u(13), lineHeight: 1.4, color: brand.brown }}>
                {city && <Meta icon={MapPin}>{city}</Meta>}
                {store.delivery && <Meta icon={Truck}>{store.delivery}</Meta>}
                {store.returns && <Meta icon={RotateCcw}>{store.returns}</Meta>}
              </Stack>
            )}
            {profile.story && (
              <Typography data-part="about" component="p" sx={{ ...wrap, mt: u(14), fontSize: u(14), lineHeight: 1.5, whiteSpace: 'pre-line' }}>
                {profile.story}
              </Typography>
            )}
            <Links profile={profile} />
          </Box>
          <Box data-part="products" sx={{ px: u(16), mt: u(24) }}>
            <Typography component="p" sx={{ ...emphasis.semibold, fontSize: u(17), lineHeight: 1.3, color: neutral.ink }}>
              {copy.preview.products}
            </Typography>
            <ProductTiles />
          </Box>
        </Box>
        <TabBar />
      </Box>
    </Box>
  )
}

// Options board pick: a phone preview beside the form with a Draft / Live switch. Draft follows the
// form as the seller types; Live shows what shoppers see today. A page that is not live yet has no switch.
export function BrandPreview({ draft, live }: { draft: Profile; live: Profile | null }) {
  const titleId = useId()
  const [version, setVersion] = useState<Version>('draft')
  const shown = version === 'live' && live ? live : draft
  return (
    <Box component="section" aria-labelledby={titleId}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5, mb: 2 }}>
        <Typography id={titleId} variant="subtitle1" component="h2" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, color: neutral.ink }}>
          <Box component="span" sx={{ display: 'inline-flex', color: brand.brown }}>
            <Eye size={18} strokeWidth={STROKE} aria-hidden="true" />
          </Box>
          {copy.preview.title}
        </Typography>
        {live && (
          <ToggleButtonGroup exclusive size="small" value={version} onChange={(_, next: Version | null) => next && setVersion(next)} aria-label={copy.preview.version}>
            {(['draft', 'live'] as const).map((v) => (
              <ToggleButton
                key={v}
                value={v}
                sx={{
                  px: 1.75,
                  py: 0.5,
                  minHeight: { xs: 44, md: 32 },
                  color: neutral.inkSecondary,
                  borderColor: neutral.line,
                  typography: 'subtitle2',
                  '&.Mui-selected, &.Mui-selected:hover': { bgcolor: brand.cream, color: neutral.ink },
                }}
              >
                {copy.preview[v]}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        )}
      </Stack>
      <Phone profile={shown} />
      <Typography variant="caption" color="textSecondary" sx={{ display: 'block', textAlign: 'center', mt: 1.5 }}>
        {copy.preview.caption}
      </Typography>
    </Box>
  )
}
