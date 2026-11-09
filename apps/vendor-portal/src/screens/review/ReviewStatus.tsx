// V-09 Review status, from the Penpot page "01 · Vendor Portal".
import { styled } from '@mui/material/styles'
import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import {
  Banner, Button, Card, Content, EmptyState, Icon, ImagePlaceholder, kit, ListCard, PageHeader, Skeleton, StatusBadge, Tabs, Text,
} from '@shazlo/ui/components'
import { useBrandProfile, useOverview, useProducts, useSubmissions } from '../../api/hooks'
import type { BrandProfile, Product, Submission } from '../../api/types'
import { TopBar } from '../../app/topbar'
import { changedList } from '../brand/brandForm'
import { clock, waited, when } from './when'

type TabKey = 'all' | 'waiting' | 'sent_back' | 'approved'
const TAB_KEYS: TabKey[] = ['all', 'waiting', 'sent_back', 'approved']

const Columns = styled('div')({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 320px',
  gap: 24,
  alignItems: 'start',
  '@media (max-width: 1180px)': { gridTemplateColumns: 'minmax(0, 1fr)' },
})

export function ReviewStatus() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab')
  const tab: TabKey = TAB_KEYS.includes(raw as TabKey) ? (raw as TabKey) : 'all'
  const submissions = useSubmissions()
  const overview = useOverview()
  const products = useProducts()
  const brand = useBrandProfile()

  // "Tabs filter by state; the counts match V-06": the chips show the catalog counts from Products.
  const c = overview.data?.counts
  const tabs = [
    { value: 'all' as const, label: 'All', count: c?.total },
    { value: 'waiting' as const, label: 'Waiting', count: c?.pending },
    { value: 'sent_back' as const, label: 'Sent back', count: c?.sentBack },
    { value: 'approved' as const, label: 'Approved', count: c?.live },
  ]

  const list = submissions.data ?? []
  const waiting = list.filter(s => !s.decision)
  const decided = list.filter(s => s.decision)
  const byId = new Map((products.data ?? []).map(p => [p.id, p]))

  return (
    <Content style={{ gap: 20 }}>
      <TopBar crumbs={[{ label: 'Review status' }]} />
      <PageHeader title="Review status" subtitle="Everything you have sent to the Shazlo review team, and what they decided." />
      <Tabs label="Filter by review state" items={tabs} value={tab} onChange={v => setParams(v === 'all' ? {} : { tab: v }, { replace: true })} />
      {submissions.isError ? (
        <Banner role="alert" title="We couldn’t load your review status" action={<Button size="sm" icon="refresh" onClick={() => submissions.refetch()}>Try again</Button>}>
          Check your connection and try again. Nothing you submitted is lost.
        </Banner>
      ) : !submissions.data ? (
        <ReviewSkeleton />
      ) : (
        <>
          <SlaStrip waiting={waiting} />
          <Columns>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
              {(tab === 'all' || tab === 'waiting') && (
                <ItemList title="Waiting for review" id="waiting" items={waiting} empty={(
                  <EmptyState icon="clock" title="Nothing is waiting for review" action={<Button to="/products">Go to products</Button>}>
                    Submit a product or your brand page draft and it shows up here until the review team decides.
                  </EmptyState>
                )}>
                  {s => <WaitingItem key={s.id} s={s} product={productOf(s, byId)} brand={brand.data} />}
                </ItemList>
              )}
              {tab !== 'waiting' && (
                <ItemList
                  title={tab === 'sent_back' ? 'Sent back' : tab === 'approved' ? 'Approved' : 'Recently decided'}
                  id="decided"
                  items={decided.filter(s => tab === 'all' || (tab === 'sent_back' ? s.decision?.outcome === 'rejected' : s.decision?.outcome === 'approved'))}
                  empty={(
                    <EmptyState icon={tab === 'sent_back' ? 'check' : 'clock'} title={tab === 'sent_back' ? 'Nothing is sent back' : 'No decisions yet'}>
                      {tab === 'sent_back'
                        ? 'Every item the review team looked at was approved. Sent-back items show here with the reason and a link to fix them.'
                        : 'Decisions from the Shazlo review team show up here, usually within 24 hours of submitting.'}
                    </EmptyState>
                  )}
                >
                  {s => <DecidedItem key={s.id} s={s} product={productOf(s, byId)} brand={brand.data} />}
                </ItemList>
              )}
            </div>
            <SideColumn />
          </Columns>
        </>
      )}
    </Content>
  )
}

const productOf = (s: Submission, byId: Map<string, Product>) => (s.subject.kind === 'product' ? byId.get(s.subject.productId) : undefined)

/* ---------- SLA strip: the 24-hour target and the oldest waiting item ---------- */

function SlaStrip({ waiting }: { waiting: Submission[] }) {
  const oldest = waiting.reduce<string | undefined>((min, s) => (!min || s.submittedAt < min ? s.submittedAt : min), undefined)
  return (
    <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderRadius: 8, background: kit.chip }}>
      <Icon name="clock" size={16} color={kit.ink} />
      <Text tone="muted" as="p" style={{ flex: 1 }}>
        Most items are reviewed within 24 hours. {oldest ? `Your oldest waiting item has been in the queue for ${waited(oldest, { long: true })}.` : 'Nothing of yours is waiting right now.'}
      </Text>
    </div>
  )
}

/* ---------- Lists ---------- */

function ItemList({ title, id, items, empty, children }: { title: string; id: string; items: Submission[]; empty: ReactNode; children: (s: Submission) => ReactNode }) {
  return (
    <ListCard as="section" aria-labelledby={`review-${id}`}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 20px' }}>
        <Text v="title" as="h2" id={`review-${id}`}>{title}</Text>
        <Text v="caption" tone="subtle" aria-label={`${items.length} items`}>{items.length}</Text>
      </div>
      {items.length === 0 ? <div>{empty}</div> : items.map(children)}
    </ListCard>
  )
}

function typeLabel(s: Submission, product?: Product) {
  if (s.subject.kind === 'brand_page') return 'Brand page'
  return product?.status === 'approved' && product.pendingEdit ? 'Edit to a live product' : 'Product'
}

function ItemShell({ children, aside, thumb }: { children: ReactNode; aside: ReactNode; thumb?: string }) {
  return (
    <article style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '14px 20px', flexWrap: 'wrap' }}>
      <ImagePlaceholder width={40} height={48} src={thumb} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 260px', minWidth: 0 }}>{children}</div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, marginLeft: 'auto' }}>{aside}</div>
    </article>
  )
}

function TitleRow({ title, type }: { title: string; type: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
      <Text v="label" as="h3">{title}</Text>
      <Text v="caption" tone="subtle">{type}</Text>
    </div>
  )
}

const thumbOf = (p?: Product) => p?.images.find(i => i.slot === 'front')?.url

function WaitingItem({ s, product, brand }: { s: Submission; product?: Product; brand?: BrandProfile }) {
  const type = typeLabel(s, product)
  const isEdit = type === 'Edit to a live product'
  const submitted = `Submitted ${when(s.submittedAt, { olderWithTime: true })}`
  const meta = s.subject.kind === 'brand_page'
    ? `${submitted}${brand?.changedFields.length ? ` · ${changedList(brand.changedFields)}` : ''}`
    : isEdit
      ? `${submitted} · the live version stays in the app`
      : `${submitted} · waiting ${waited(s.submittedAt)}`
  return (
    <ItemShell thumb={thumbOf(product)} aside={<StatusBadge tone="pending">{isEdit ? 'Edit in review' : 'Pending review'}</StatusBadge>}>
      <TitleRow title={s.subject.title} type={type} />
      <Text v="caption" tone="subtle">{meta}</Text>
    </ItemShell>
  )
}

function DecidedItem({ s, product, brand }: { s: Submission; product?: Product; brand?: BrandProfile }) {
  const d = s.decision
  if (!d) return null
  const sentBack = d.outcome === 'rejected'
  // Offer the fix only while the item is still sent back (not once it has been resubmitted).
  const needsFix = sentBack && (s.subject.kind === 'product' ? product?.status === 'rejected' : brand?.status === 'rejected')
  const fixTo = s.subject.kind === 'product' ? `/products/${s.subject.productId}` : '/brand'
  const meta = sentBack
    ? `Sent back ${when(d.decidedAt)}`
    : d.liveAt
      ? `Approved ${when(d.decidedAt)} · live in the app since ${clock(d.liveAt)}`
      : `Approved ${when(d.decidedAt)} · publishing to the app`
  const badge = sentBack ? <StatusBadge tone="sentBack" /> : d.liveAt ? <StatusBadge tone="live" /> : <StatusBadge tone="publishing" />
  return (
    <ItemShell
      thumb={thumbOf(product)}
      aside={(
        <>
          {badge}
          {needsFix && <Button size="sm" to={fixTo} aria-label={`Fix and resubmit ${s.subject.title}`}>Fix and resubmit</Button>}
        </>
      )}
    >
      <TitleRow title={s.subject.title} type={typeLabel(s, product)} />
      <Text v="caption" tone="subtle">{meta}</Text>
      {sentBack && d.reason && (
        <figure style={{ margin: 0, display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px', borderRadius: 6, background: kit.canvas }}>
          <Icon name="info" size={14} color={kit.ink} style={{ marginTop: 1, flexShrink: 0 }} />
          <blockquote style={{ margin: 0, flex: 1, minWidth: 0 }}>
            <Text as="p">“{d.reason}”</Text>
          </blockquote>
          <figcaption className="shz-visually-hidden">Shazlo review team</figcaption>
        </figure>
      )}
    </ItemShell>
  )
}

/* ---------- Side column ---------- */

const steps = [
  { title: 'Submitted', body: 'Your item joins the queue. You can still see it, but not edit it.' },
  { title: 'Reviewed', body: 'Usually within 24 hours, by the Shazlo team.' },
  { title: 'Live or sent back', body: 'Live items appear in the app within minutes. Sent-back items come with a reason.' },
]
const checks = ['Front, back and close-up photos', 'Price matches the tag (MRP)', 'Category and fabric are right', 'Nothing on the prohibited list']

function SideColumn() {
  return (
    <aside style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
      <Card gap={12} as="section" aria-labelledby="how-review-works">
        <Text v="title" as="h2" id="how-review-works">How review works</Text>
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {steps.map((step, i) => (
            <li key={step.title} style={{ display: 'flex', gap: 10 }}>
              <Text v="caption" aria-hidden style={{ width: 22, height: 22, borderRadius: 999, border: `1px solid ${kit.ink}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</Text>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <Text v="label" as="h3">{step.title}</Text>
                <Text tone="muted" as="p">{step.body}</Text>
              </div>
            </li>
          ))}
        </ol>
      </Card>
      <section aria-labelledby="what-we-check" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 16, borderRadius: 8, background: kit.chip }}>
        <Text v="label" as="h2" id="what-we-check">What we check</Text>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {checks.map(item => (
            <li key={item} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="check" size={14} color={kit.ink} />
              <Text tone="muted">{item}</Text>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  )
}

/* ---------- Loading ---------- */

function ReviewSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading review status" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Skeleton height={40} radius={8} />
      <Columns>
        <ListCard>
          <div style={{ padding: '14px 20px' }}><Skeleton width={150} height={20} /></div>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ display: 'flex', gap: 14, padding: '14px 20px' }}>
              <Skeleton width={40} height={48} radius={6} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}><Skeleton width="40%" /><Skeleton width="55%" /></div>
              <Skeleton width={100} height={19} radius={999} />
            </div>
          ))}
        </ListCard>
        <SideColumn />
      </Columns>
    </div>
  )
}
