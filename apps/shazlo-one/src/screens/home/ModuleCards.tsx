import { Box, Button, Link, Skeleton, Stack, Typography, useMediaQuery, useTheme } from '@mui/material'
import type { RegistryEntry, SummaryActivity, SummaryActivityItem, SummaryFigure, SummarySection } from '@shazlo/shell-protocol'
import { Banner, brand, emphasis, EmptyState, neutral, SectionCard, StatFigure, StatusPill } from '@shazlo/ui'
import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link as RouterLink } from 'react-router'
import { useModuleManifest, useModuleSummary } from '../../api/modules'
import { iconFor } from '../../app/icons'
import { resolveModule, type ResolvedModule } from '../../app/registry'
import { homeCopy } from '../../copy/home'
import { formatCount, formatRelative } from '../../lib/format'
import { formatMinutes } from './time'

// ADR 0011: a module's cards on Home, drawn from its summary. The shell draws every module the same
// way and never learns what the figures mean; the words, numbers and links are the module's.

const copy = homeCopy
const touch = { minHeight: { xs: 44, md: 36 } }

// A banner's button sits beside its text; on a phone that leaves the text a narrow column, so the
// button moves under the text instead.
function usePhone() {
  const theme = useTheme()
  return useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true })
}
const actionBelow = (action: ReactNode) => <Box sx={{ mt: 1.25 }}>{action}</Box>
const grid = { display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' }, gap: { xs: 1.5, md: 2 } } as const

// Paths in a summary are inside the module; the shell's are under the module's base path.
const inModule = (module: ResolvedModule, path: string) => module.basePath + path

function figureValue(figure: SummaryFigure): string {
  if (figure.value === null) return '—'
  return figure.unit === 'minutes' ? formatMinutes(figure.value) : formatCount(figure.value)
}

function FigureSkeletons({ label }: { label: string }) {
  return (
    <Box role="status" aria-label={label} aria-busy="true" sx={grid}>
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} variant="rounded" height={112} />
      ))}
    </Box>
  )
}

// The first section's action is the module's main one (a filled button); later sections link quietly.
// A section whose alert carries an action shows it there instead, once.
function SummarySectionCard({ module, section, primary }: { module: ResolvedModule; section: SummarySection; primary: boolean }) {
  const phone = usePhone()
  const { action, alert } = section
  let header: ReactNode
  if (action && !alert?.action) {
    header = primary ? (
      <Button variant="contained" component={RouterLink} to={inModule(module, action.path)} sx={{ ...touch, whiteSpace: 'nowrap' }}>
        {action.label}
      </Button>
    ) : (
      <Link component={RouterLink} to={inModule(module, action.path)} variant="body2" sx={{ whiteSpace: 'nowrap', py: 1 }}>
        {action.label}
      </Link>
    )
  }
  const alertButton = alert?.action && (
    <Button variant="outlined" component={RouterLink} to={inModule(module, alert.action.path)} sx={{ ...touch, whiteSpace: 'nowrap', bgcolor: 'background.paper' }}>
      {alert.action.label}
    </Button>
  )
  return (
    <SectionCard title={section.title} icon={section.icon ? iconFor(section.icon) : module.icon} action={header}>
      <Stack spacing={2}>
        {alert && (phone ? <Banner tone={alert.tone} title={alert.text}>{alertButton && actionBelow(alertButton)}</Banner> : <Banner tone={alert.tone} title={alert.text} action={alertButton || undefined} />)}
        <Box role="group" aria-label={section.title} sx={grid}>
          {section.figures.map((f) => (
            <StatFigure key={f.label} label={f.label} value={figureValue(f)} baseline={f.hint ?? undefined} href={f.path ? inModule(module, f.path) : undefined} linkComponent={RouterLink} />
          ))}
        </Box>
      </Stack>
    </SectionCard>
  )
}

const rowPadding = { px: { xs: 2, sm: 3 } }
const chevron = 'activity-chevron'

function ActivityText({ item, names }: { item: SummaryActivityItem; names: Record<string, string> }) {
  const positive = item.status.tone === 'positive'
  // A missing key: the module does not track who acted. Null: it did not record who it was.
  const actor = item.actor_id === undefined ? null : (item.actor_id && names[item.actor_id]) || copy.activity.formerAdmin
  return (
    <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: { xs: 'wrap', sm: 'nowrap' }, gap: { xs: 1, sm: 2 }, alignItems: 'flex-start' }}>
      <Box sx={{ flex: 1, minWidth: 0, flexBasis: { xs: '100%', sm: 0 } }}>
        <Typography component="span" variant="body1" sx={{ display: 'block', ...emphasis.semibold, color: 'text.primary', overflowWrap: 'anywhere' }}>
          {item.title}
        </Typography>
        {item.subtitle && (
          <Typography component="span" variant="body2" color="textSecondary" sx={{ display: 'block', mt: 0.25, overflowWrap: 'anywhere' }}>
            {item.subtitle}
          </Typography>
        )}
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, alignItems: { xs: 'flex-start', sm: 'flex-end' }, flexShrink: 0 }}>
        <StatusPill status={positive ? 'live' : 'sentBack'} label={item.status.label} />
        <Typography component="span" variant="caption" color="textSecondary" sx={{ whiteSpace: 'nowrap' }}>
          {actor && (
            <>
              {copy.activity.by(actor)}
              <Box component="span" aria-hidden="true" sx={{ mx: 0.5 }}>
                ·
              </Box>
            </>
          )}
          <time dateTime={item.at}>{formatRelative(item.at)}</time>
        </Typography>
      </Box>
    </Box>
  )
}

// A row with a path is one link (no other control inside it), so it opens from anywhere on the row.
function ActivityRow({ module, item, names }: { module: ResolvedModule; item: SummaryActivityItem; names: Record<string, string> }) {
  const rowLayout = { ...rowPadding, display: 'flex', alignItems: 'center', gap: { xs: 1, sm: 2 }, py: 1.75 } as const
  return (
    <Box component="li" sx={{ borderTop: `1px solid ${neutral.line}` }}>
      {item.path ? (
        <Link
          component={RouterLink}
          to={inModule(module, item.path)}
          underline="none"
          sx={{
            ...rowLayout,
            color: 'text.primary',
            cursor: 'pointer',
            // The card clips anything outside the row, so the ring sits just inside it.
            '&:focus-visible': { outline: `2px solid ${brand.navy}`, outlineOffset: -2 },
            '@media (hover: hover)': { '&:hover': { bgcolor: 'action.hover' }, [`&:hover .${chevron}`]: { color: neutral.ink, transform: 'translateX(2px)' } },
          }}
        >
          <ActivityText item={item} names={names} />
          <Box component="span" className={chevron} sx={{ display: 'flex', flexShrink: 0, color: neutral.inkSecondary, '@media (prefers-reduced-motion: no-preference)': { transition: 'transform 120ms ease-out, color 120ms ease-out' } }}>
            <ChevronRight size={18} strokeWidth={1.75} aria-hidden="true" />
          </Box>
        </Link>
      ) : (
        <Box sx={rowLayout}>
          <ActivityText item={item} names={names} />
        </Box>
      )}
    </Box>
  )
}

function ActivityCard({ module, activity, names }: { module: ResolvedModule; activity: SummaryActivity; names: Record<string, string> }) {
  return (
    <SectionCard title={activity.title} icon={activity.icon ? iconFor(activity.icon) : module.icon} padded={false}>
      {activity.items.length === 0 ? (
        <EmptyState illustration="clock" title={activity.empty.title} body={activity.empty.body ?? undefined} />
      ) : (
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, pb: 1 }}>
          {activity.items.map((item) => (
            <ActivityRow key={item.id} module={module} item={item} names={names} />
          ))}
        </Box>
      )}
    </SectionCard>
  )
}

function SummaryError({ module, message, onRetry }: { module: ResolvedModule; message: string; onRetry: () => void }) {
  const phone = usePhone()
  const retry = (
    <Button variant="outlined" sx={{ ...touch, bgcolor: 'background.paper' }} onClick={onRetry}>
      {copy.retry}
    </Button>
  )
  return (
    <Banner tone="error" title={copy.module.error(module.title)} action={phone ? undefined : retry}>
      {message}
      {phone && actionBelow(retry)}
    </Banner>
  )
}

// Everything Home shows for one module. Each module loads and fails on its own: one that is down shows
// its error here and nowhere else.
export function ModuleCards({ entry }: { entry: RegistryEntry }) {
  const manifest = useModuleManifest(entry)
  const module = resolveModule(entry, manifest.data)
  const summary = useModuleSummary(entry)
  const open = (
    <Button variant="outlined" component={RouterLink} to={inModule(module, module.home.path)} sx={{ ...touch, whiteSpace: 'nowrap' }}>
      {copy.module.open(module.title)}
    </Button>
  )
  if (!entry.summaryUrl) {
    return (
      <SectionCard title={module.title} icon={module.icon} action={open}>
        <Typography variant="body1" color="textSecondary" sx={{ pb: 1.5 }}>
          {copy.module.noSummary.body}
        </Typography>
      </SectionCard>
    )
  }
  if (summary.isError) return <SummaryError module={module} message={summary.error.message} onRetry={() => void summary.refetch()} />
  if (!summary.data) {
    return (
      <SectionCard title={module.title} icon={module.icon}>
        <FigureSkeletons label={copy.module.loading(module.title)} />
      </SectionCard>
    )
  }
  const { summary: data, names } = summary.data
  return (
    <>
      {data.sections.map((section, i) => (
        <SummarySectionCard key={section.title} module={module} section={section} primary={i === 0} />
      ))}
      {data.activity && <ActivityCard module={module} activity={data.activity} names={names} />}
    </>
  )
}
