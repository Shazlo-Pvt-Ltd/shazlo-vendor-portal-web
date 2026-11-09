// V-04 Overview (desktop) and V-04m Overview (mobile), from the Penpot page "01 · Vendor Portal".
import useMediaQuery from '@mui/material/useMediaQuery'
import { styled } from '@mui/material/styles'
import type { ElementType, ReactNode } from 'react'
import {
  Banner, Button, buttonCss, Card, Content, Icon, ImagePlaceholder, kit, ListCard, ListHeader, PageHeader, ProgressBar, Skeleton,
  StatusBadge, Text, TextLink,
} from '@shazlo/ui/components'
import { useBrandProfile, useOverview } from '../../api/hooks'
import type { BrandProfile, OverviewSummary, ReviewDecision } from '../../api/types'
import { RouterLink } from '../../app/RouterLink'
import { useSession } from '../../app/session'
import { TopBar } from '../../app/topbar'
import { MOBILE_QUERY } from '../../app/VendorShell'
import { longDate, relativeTime } from '../../lib/format'
import { changedList } from '../brand/brandForm'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Shopper-facing brand page in the consumer app. */
function liveBrandUrl(brandName: string) {
  return `https://shazlo.store/brands/${brandName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
}

const ExternalButton = styled('a')(buttonCss('ghost', 'sm'))

const StatsGrid = styled('div')({
  display: 'grid',
  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
  gap: 16,
  '@media (max-width: 1100px)': { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
  '@media (max-width: 899.95px)': { gap: 10 },
})

const Columns = styled('div')({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 360px',
  gap: 24,
  alignItems: 'start',
  '@media (max-width: 1180px)': { gridTemplateColumns: 'minmax(0, 1fr)' },
})

const StatLink = styled('a')({
  background: kit.surface,
  border: `1px solid ${kit.line}`,
  borderRadius: 8,
  display: 'flex',
  flexDirection: 'column',
  textDecoration: 'none',
  minWidth: 0,
  transition: 'border-color 150ms ease-out',
  '&:hover': { borderColor: kit.field },
  '&:focus-visible': { outline: `2px solid ${kit.focus}`, outlineOffset: 2 },
})
const StatLinkAny = StatLink as unknown as ElementType

const RowLink = styled('a')({
  display: 'flex',
  textDecoration: 'none',
  color: 'inherit',
  transition: 'background-color 150ms ease-out',
  '&:hover': { background: '#FFFBEC !important' },
  '&:focus-visible': { outline: `2px solid ${kit.focus}`, outlineOffset: -2 },
})
const RowLinkAny = RowLink as unknown as ElementType

export function Overview() {
  const mobile = useMediaQuery(MOBILE_QUERY, { noSsr: true })
  const { session } = useSession()
  const overview = useOverview()
  const brand = useBrandProfile()
  const vendor = session?.vendor

  const brandName = brand.data?.published?.brandName ?? vendor?.brandName ?? ''
  const topActions = brand.data?.published ? (
    <ExternalButton href={liveBrandUrl(brandName)} target="_blank" rel="noreferrer">
      <Icon name="external" size={14} />View live brand page
    </ExternalButton>
  ) : undefined

  return (
    <Content style={mobile ? { padding: '16px 16px 88px', gap: 16 } : undefined}>
      <TopBar crumbs={[{ label: 'Overview' }]} actions={topActions} />
      {!mobile && (
        <PageHeader
          title="Overview"
          subtitle={vendor ? `${vendor.brandName} · ${vendor.status === 'approved' && vendor.approvedAt ? `approved seller since ${longDate(vendor.approvedAt)}` : 'seller'}` : ' '}
          actions={(
            <>
              <Button variant="secondary" icon="upload" to="/products/import">Bulk import</Button>
              <Button variant="primary" icon="plus" to="/products/new">Add product</Button>
            </>
          )}
        />
      )}
      {overview.isError ? (
        <Banner role="alert" title="We couldn’t load your overview" action={<Button size="sm" icon="refresh" onClick={() => overview.refetch()}>Try again</Button>}>
          Check your connection and try again. Your products and brand page are safe.
        </Banner>
      ) : !overview.data ? (
        <OverviewSkeleton mobile={mobile} />
      ) : (
        <>
          <SentBackAlert count={overview.data.counts.sentBack} mobile={mobile} />
          <Stats counts={overview.data.counts} mobile={mobile} />
          {mobile ? (
            <>
              <Decisions decisions={overview.data.recentDecisions.slice(0, 3)} mobile />
              <BrandStatus query={brand} mobile />
            </>
          ) : (
            <Columns>
              <Decisions decisions={overview.data.recentDecisions} mobile={false} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24, minWidth: 0 }}>
                <BrandStatus query={brand} mobile={false} />
                <Checklist items={overview.data.checklist} />
              </div>
            </Columns>
          )}
        </>
      )}
    </Content>
  )
}

/* ---------- Sent-back alert (pinned above everything while anything is sent back) ---------- */

function SentBackAlert({ count, mobile }: { count: number; mobile: boolean }) {
  if (count === 0) return null
  const what = plural(count, 'product was', 'products were')
  if (mobile) {
    return (
      <>
        <Banner title={`${what} sent back`}>Fix the notes and resubmit.</Banner>
        <TextLink to="/review?tab=sent_back" underline style={{ display: 'flex', alignItems: 'center', minHeight: 44, margin: '-14px 0' }}>See feedback</TextLink>
      </>
    )
  }
  return (
    <Banner
      title={`${what} sent back by the review team`}
      action={<Button size="sm" to="/review?tab=sent_back">See feedback</Button>}
    >
      Fix the notes on each product and resubmit. They stay off the app until approved.
    </Banner>
  )
}

/* ---------- Stat cards: each opens Products filtered to that tab ---------- */

function Stats({ counts, mobile }: { counts: OverviewSummary['counts']; mobile: boolean }) {
  const cards: Array<{ tab: string; label: string; mobileLabel: string; value: number; hint: string }> = [
    { tab: 'live', label: 'Live on Shazlo', mobileLabel: 'Live', value: counts.live, hint: 'Visible in the app feed' },
    { tab: 'pending', label: 'Pending review', mobileLabel: 'Pending review', value: counts.pending, hint: 'Usually reviewed within 24 h' },
    { tab: 'sent_back', label: 'Sent back', mobileLabel: 'Sent back', value: counts.sentBack, hint: 'Needs your changes' },
    { tab: 'drafts', label: 'Drafts', mobileLabel: 'Drafts', value: counts.drafts, hint: 'Not submitted yet' },
  ]
  return (
    <StatsGrid aria-label="Catalog" role="list">
      {cards.map(c => (
        <div role="listitem" key={c.tab} style={{ display: 'flex', minWidth: 0 }}>
          <StatLinkAny
            as={RouterLink}
            to={`/products?tab=${c.tab}`}
            aria-label={`${c.value} ${c.label.toLowerCase()}: open Products filtered to ${c.mobileLabel.toLowerCase()}`}
            // Penpot strokes sit inside the box, so the 1 px border comes out of the padding.
            style={{ flex: 1, gap: mobile ? 2 : 6, padding: mobile ? '11px 13px' : '15px 19px' }}
          >
            {mobile ? (
              <>
                <Text v="display" tabular>{c.value}</Text>
                <Text v="caption" tone="muted">{c.mobileLabel}</Text>
              </>
            ) : (
              <>
                <Text v="small" tone="muted">{c.label}</Text>
                <Text v="stat" tabular>{c.value}</Text>
                <Text v="caption" tone="subtle">{c.hint}</Text>
              </>
            )}
          </StatLinkAny>
        </div>
      ))}
    </StatsGrid>
  )
}

/* ---------- Recent review decisions ---------- */

function decisionHref(d: ReviewDecision) {
  return d.subject.kind === 'product' ? `/products/${d.subject.productId}` : '/brand'
}

function quote(text: string) {
  return `“${text}”`
}

function Decisions({ decisions, mobile }: { decisions: ReviewDecision[]; mobile: boolean }) {
  return (
    <ListCard as="section" aria-labelledby="recent-decisions">
      <ListHeader style={mobile ? { padding: '12px 14px' } : undefined}>
        <Text v={mobile ? 'label' : 'title'} as="h2" id="recent-decisions">{mobile ? 'Recent decisions' : 'Recent review decisions'}</Text>
        <TextLink to="/review" underline v={mobile ? 'caption' : 'label'}>View all</TextLink>
      </ListHeader>
      {decisions.length === 0 && (
        <div style={{ padding: mobile ? '16px 14px' : '20px' }}>
          <Text tone="muted" as="p">No decisions yet. When the Shazlo review team approves or sends back something you submitted, it shows up here.</Text>
        </div>
      )}
      {decisions.map(d => (mobile ? <MobileDecision key={d.id} d={d} /> : <DesktopDecision key={d.id} d={d} />))}
    </ListCard>
  )
}

function DecisionBadge({ d }: { d: ReviewDecision }) {
  return d.outcome === 'approved' ? <StatusBadge tone="approved" /> : <StatusBadge tone="sentBack" />
}

function DesktopDecision({ d }: { d: ReviewDecision }) {
  return (
    <RowLinkAny as={RouterLink} to={decisionHref(d)} style={{ alignItems: 'center', gap: 14, padding: '14px 20px' }}>
      <ImagePlaceholder width={40} height={48} />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <Text v="label" truncate>{d.subject.title}</Text>
          <Text v="mono" tone="subtle" style={{ flexShrink: 0 }}>{d.subject.kind === 'product' ? d.subject.sku : '—'}</Text>
        </span>
        {d.reason && <Text v="small" tone="muted">{quote(d.reason)}</Text>}
      </span>
      <DecisionBadge d={d} />
      <Text v="caption" tone="subtle" style={{ whiteSpace: 'nowrap', minWidth: 41, textAlign: 'right' }}>
        <time dateTime={d.decidedAt}>{relativeTime(d.decidedAt)}</time>
      </Text>
      <span className="shz-visually-hidden">Reviewed by the Shazlo review team</span>
    </RowLinkAny>
  )
}

function MobileDecision({ d }: { d: ReviewDecision }) {
  return (
    <RowLinkAny as={RouterLink} to={decisionHref(d)} style={{ alignItems: 'flex-start', gap: 12, padding: '12px 14px', minHeight: 44 }}>
      <ImagePlaceholder width={40} height={48} />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0, alignItems: 'flex-start' }}>
        <Text v="label" truncate style={{ maxWidth: '100%' }}>{d.subject.title}</Text>
        {d.reason && <Text v="caption" tone="muted" truncate style={{ maxWidth: '100%' }} title={d.reason}>{quote(d.reason)}</Text>}
        <DecisionBadge d={d} />
      </span>
      <Icon name="chevronRight" size={16} color={kit.subtle} />
    </RowLinkAny>
  )
}

/* ---------- Brand page status ---------- */

function BrandStatus({ query, mobile }: { query: ReturnType<typeof useBrandProfile>; mobile: boolean }) {
  const pad = mobile ? 14 : 20
  if (query.isError) {
    return (
      <Card pad={pad} gap={mobile ? 10 : 16}>
        <Text v={mobile ? 'label' : 'title'} as="h2">Brand page</Text>
        <Text tone="muted" as="p">We couldn’t load your brand page status.</Text>
        <Button fullWidth icon="refresh" onClick={() => query.refetch()}>Try again</Button>
      </Card>
    )
  }
  const b = query.data
  if (!b) {
    return (
      <Card pad={pad} gap={mobile ? 10 : 16} aria-busy="true">
        <Skeleton width={110} height={20} />
        <Skeleton height={32} />
        <Skeleton height={33} radius={6} />
      </Card>
    )
  }
  const { badge, text, mobileText, action } = brandCopy(b)
  return (
    <Card pad={pad} gap={mobile ? 10 : 16} as="section" aria-labelledby="brand-status">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Text v={mobile ? 'label' : 'title'} as="h2" id="brand-status">Brand page</Text>
        {badge}
      </div>
      <Text v={mobile ? 'caption' : 'small'} tone="muted" as="p">{mobile ? mobileText : text}</Text>
      <Button fullWidth icon={action.icon} to="/brand">{action.label}</Button>
    </Card>
  )
}

function brandCopy(b: BrandProfile): { badge: ReactNode; text: string; mobileText: string; action: { label: string; icon: 'edit' | 'eye' } } {
  const published = b.published && b.publishedAt ? `Published ${shortDate(b.publishedAt)}.` : 'Not published yet.'
  const n = b.changedFields.length
  const changes = plural(n, 'unpublished change', 'unpublished changes')
  const badge = b.published ? <StatusBadge tone="live" /> : <StatusBadge tone="draft" />
  if (b.status === 'pending_review') {
    return {
      badge: <StatusBadge tone="pending" />,
      text: `${published} Your draft (${changedList(b.changedFields)}) is with the review team. The live page stays the same until they approve it.`,
      mobileText: 'Draft is with the review team.',
      action: { label: 'View draft', icon: 'eye' },
    }
  }
  if (b.status === 'rejected') {
    const reason = b.lastDecision?.reason
    return {
      badge: <StatusBadge tone="sentBack" />,
      text: `${published} Your draft was sent back${reason ? `: “${reason}”` : '.'}`,
      mobileText: 'Draft was sent back. Fix and resubmit.',
      action: { label: 'Fix and resubmit', icon: 'edit' },
    }
  }
  if (n > 0) {
    return {
      badge,
      text: `${published} You have a draft with ${changes} (${changedList(b.changedFields)}).`,
      mobileText: `Draft with ${changes}.`,
      action: { label: 'Continue editing', icon: 'edit' },
    }
  }
  return {
    badge,
    text: `${published} Shoppers see this version in the app.`,
    mobileText: 'Shoppers see this version in the app.',
    action: { label: 'Edit brand page', icon: 'edit' },
  }
}

const dayMonth = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' })
const shortDate = (iso: string) => dayMonth.format(new Date(iso))

/* ---------- First-run checklist (disappears once complete) ---------- */

const checklistLinks: Record<string, string> = { brand: '/brand', first: '/products/new', returns: '/brand', ten: '/products' }

function Checklist({ items }: { items: OverviewSummary['checklist'] }) {
  const done = items.filter(i => i.done).length
  if (items.length === 0 || done === items.length) return null
  return (
    <Card gap={12} as="section" aria-labelledby="setup-checklist">
      <Text v="title" as="h2" id="setup-checklist">Getting set up</Text>
      <ProgressBar value={done} max={items.length} label="Setup progress" />
      <Text v="caption" tone="subtle">{done} of {items.length} done</Text>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {items.map(item => (
          <li key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              aria-hidden
              style={{
                width: 16, height: 16, borderRadius: 4, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: item.done ? kit.brown : kit.surface, border: item.done ? 0 : `1px solid ${kit.field}`, color: kit.offWhite,
              }}
            >
              {item.done && <Icon name="check" size={12} strokeWidth={2.5} />}
            </span>
            {item.done || !checklistLinks[item.id] ? (
              <Text>{item.label}<span className="shz-visually-hidden">{item.done ? ', done' : ', not done yet'}</span></Text>
            ) : (
              <TextLink to={checklistLinks[item.id]} v="small" style={{ color: kit.ink }}>
                {item.label}<span className="shz-visually-hidden">, not done yet</span>
              </TextLink>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}

/* ---------- Loading ---------- */

function OverviewSkeleton({ mobile }: { mobile: boolean }) {
  return (
    <div aria-busy="true" aria-label="Loading your overview" style={{ display: 'flex', flexDirection: 'column', gap: mobile ? 16 : 24 }}>
      <Skeleton height={65} radius={6} />
      <StatsGrid>
        {[0, 1, 2, 3].map(i => <Skeleton key={i} height={mobile ? 73 : 111} radius={8} />)}
      </StatsGrid>
      <Columns>
        <ListCard>
          <div style={{ padding: '16px 20px' }}><Skeleton width={190} height={20} /></div>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ display: 'flex', gap: 14, padding: '14px 20px', alignItems: 'center' }}>
              <Skeleton width={40} height={48} radius={6} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}><Skeleton width="45%" /><Skeleton width="75%" /></div>
            </div>
          ))}
        </ListCard>
        {!mobile && <Skeleton height={157} radius={8} />}
      </Columns>
    </div>
  )
}
