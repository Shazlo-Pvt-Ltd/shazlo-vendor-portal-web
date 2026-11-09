import { useEffect, type ReactNode } from 'react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import {
  Button, Card, Content, Icon, kit, ListCard, ListHeader, PageHeader, Skeleton, StatusBadge, Text, TextLink, textStyle, type BadgeTone,
} from '@shazlo/ui/components'
import { shellApi, type ModuleSummary } from '../api/mock'
import { canUse, modules, type ShellModule } from '../app/registry'
import { useSession } from '../app/session'
import { TopBar } from '../app/topbar'

/** Per-module copy for the home card. A module without an entry gets a plain "Open" card. */
const moduleCopy: Record<string, { description: string; cta: string; ctaPath: string }> = {
  'vendor-admin': { description: 'Applications, brand pages and products', cta: 'Open review queue', ctaPath: '/queue' },
}

const outcomeBadge: Record<ModuleSummary['recentDecisions'][number]['outcome'], { tone: BadgeTone; label: string }> = {
  approved: { tone: 'approved', label: 'Approved' },
  sent_back: { tone: 'sentBack', label: 'Sent back' },
  more_info: { tone: 'pending', label: 'More info requested' },
}

const timeFmt = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

const twoUp = { display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'stretch' } as const
const half = { flex: '1 1 340px' } as const

/** A-02 · Home. */
export function Home() {
  const { session } = useSession()
  const summary = useQuery({ queryKey: ['vendor-summary'], queryFn: shellApi.vendorSummary, enabled: Boolean(session) })
  useEffect(() => { document.title = 'Home · Shazlo One' }, [])
  if (!session) return null
  const roles = session.admin.roles
  const visible = modules.filter(m => canUse(roles, m))
  const vendors = visible.find(m => m.id === 'vendor-admin')

  return (
    <Content>
      <TopBar crumbs={[{ label: 'Home' }]} />
      <PageHeader title="Home" subtitle={`${session.admin.name} · ${roles.join(' · ')}`} />

      <section aria-label="Modules" style={twoUp}>
        {visible.map(m => (
          <ModuleCard key={m.id} module={m} summary={m.id === 'vendor-admin' ? summary : undefined} />
        ))}
        <div
          style={{
            ...half,
            minHeight: 176,
            border: `1px dashed ${kit.field}`,
            borderRadius: 8,
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
          }}
        >
          <Icon name="plus" size={20} color={kit.subtle} />
          <Text v="small" tone="subtle" as="p">Other services add their admin UI here</Text>
          <Text v="caption" tone="subtle" as="p">You only see modules your roles allow</Text>
        </div>
      </section>

      {vendors && (
        <>
          <div style={twoUp}>
            <Card gap={12} style={half}>
              <Text v="title" as="h2">Waiting for review</Text>
              {summary.isPending && [0, 1, 2].map(i => <Skeleton key={i} height={16} />)}
              {summary.isError && <SummaryError onRetry={() => void summary.refetch()} />}
              {summary.data && (summary.data.byType.length === 0 ? (
                <Text v="small" tone="muted" as="p">Nothing is waiting. New submissions show up here.</Text>
              ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {summary.data.byType.map(t => (
                    <li key={t.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Text v="small" style={{ flex: 1, minWidth: 0 }}>{t.label}</Text>
                      <Text v="caption" tone="subtle">oldest {t.oldest}</Text>
                      <Text v="label" tabular style={{ minWidth: 8, textAlign: 'right' }}>{t.count}</Text>
                    </li>
                  ))}
                </ul>
              ))}
            </Card>

            <Card gap={12} style={half}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <Text v="title" as="h2">Publishing to the app</Text>
                {summary.data && (summary.data.publishing.failed > 0
                  ? <StatusBadge tone="failed">{summary.data.publishing.failed} failed</StatusBadge>
                  : <StatusBadge tone="live">All delivered</StatusBadge>)}
              </div>
              {summary.isPending && <><Skeleton height={14} /><Skeleton height={14} width="70%" /></>}
              {summary.isError && <SummaryError onRetry={() => void summary.refetch()} />}
              {summary.data && <Text v="small" tone="muted" as="p" style={{ lineHeight: '16px' }}>{publishingText(summary.data.publishing)}</Text>}
              <Button size="sm" icon="activity" to={`${vendors.basePath}/publishing`} style={{ alignSelf: 'flex-start' }}>Open publishing status</Button>
            </Card>
          </div>

          <ListCard role="region" aria-labelledby="recent-decisions">
            <ListHeader style={{ padding: '14px 20px' }}>
              <Text v="title" as="h2" id="recent-decisions">Your recent decisions</Text>
            </ListHeader>
            {summary.isPending && [0, 1, 2].map(i => (
              <div key={i} style={{ display: 'flex', gap: 16, padding: '12px 20px', alignItems: 'center' }}>
                <Skeleton width={37} height={15} />
                <Skeleton height={16} style={{ flex: 1 }} />
                <Skeleton width={83} height={19} radius={999} />
              </div>
            ))}
            {summary.isError && <div style={{ padding: '12px 20px' }}><SummaryError onRetry={() => void summary.refetch()} /></div>}
            {summary.data && summary.data.recentDecisions.length === 0 && (
              <div style={{ padding: '12px 20px' }}>
                <Text v="small" tone="muted" as="p">No decisions yet today. Approvals and send-backs you make in the review queue show up here.</Text>
              </div>
            )}
            {summary.data?.recentDecisions.map(d => {
              const b = outcomeBadge[d.outcome]
              return (
                <div key={`${d.at}-${d.title}`} style={{ display: 'flex', gap: 16, padding: '12px 20px', alignItems: 'center' }}>
                  <time dateTime={d.at} style={{ ...textStyle.mono, color: kit.subtle, flexShrink: 0 }}>{timeFmt.format(new Date(d.at))}</time>
                  <Text v="small" truncate style={{ flex: 1 }}>{d.title}</Text>
                  <StatusBadge tone={b.tone}>{b.label}</StatusBadge>
                </div>
              )
            })}
          </ListCard>
        </>
      )}
    </Content>
  )
}

function ModuleCard({ module, summary }: { module: ShellModule; summary?: UseQueryResult<ModuleSummary> }) {
  const copy = moduleCopy[module.id]
  const stats: Array<{ label: string; value: ReactNode }> | null = summary?.data
    ? [
        { label: 'Waiting', value: summary.data.waiting },
        { label: 'Oldest', value: summary.data.oldest },
        { label: 'Decided today', value: summary.data.decidedToday },
      ]
    : null
  return (
    <article aria-labelledby={`module-${module.id}`} style={{ ...half, background: kit.surface, border: `1px solid ${kit.line}`, borderRadius: 8, padding: 20, display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 36, height: 36, borderRadius: 8, background: kit.chip, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon name={module.icon} size={20} color={kit.ink} />
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <Text v="title" as="h2" id={`module-${module.id}`}>{module.title}</Text>
          {copy && <Text v="caption" tone="subtle">{copy.description}</Text>}
        </div>
      </div>
      {summary && (
        <div style={{ display: 'flex', gap: 24, alignItems: 'center', minHeight: 40, flexWrap: 'wrap' }}>
          {summary.isPending && [43, 36, 77].map(w => (
            <div key={w} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Skeleton width={24} height={23} />
              <Skeleton width={w} height={15} />
            </div>
          ))}
          {summary.isError && <SummaryError onRetry={() => void summary.refetch()} />}
          {stats?.map(s => (
            <div key={s.label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Text v="statSmall" tabular>{s.value}</Text>
              <Text v="caption" tone="subtle">{s.label}</Text>
            </div>
          ))}
        </div>
      )}
      <Button variant="primary" icon="arrowRight" fullWidth to={`${module.basePath}${copy?.ctaPath ?? ''}`} style={{ marginTop: 'auto' }}>
        {copy?.cta ?? `Open ${module.title}`}
      </Button>
    </article>
  )
}

function SummaryError({ onRetry }: { onRetry: () => void }) {
  return (
    <Text v="small" tone="error" as="p" role="alert" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <Icon name="alert" size={14} /> Counts didn’t load.
      <TextLink onClick={onRetry} v="small">Try again</TextLink>
    </Text>
  )
}

function publishingText(p: ModuleSummary['publishing']) {
  const delivered = `${p.delivered24h.toLocaleString('en-IN')} events delivered in the last 24 h.`
  if (p.failed === 0) return `${delivered} Nothing is stuck.`
  const type = p.failedEventTypes[0]
  if (p.failed === 1) return `${delivered} One ${type ? `${type} ` : ''}event is out of retries and needs a look.`
  return `${delivered} ${p.failed} events are out of retries and need a look.`
}
