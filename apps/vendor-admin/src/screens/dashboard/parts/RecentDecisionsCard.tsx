import { Box, Link, Typography } from '@mui/material'
import { emphasis, EmptyState, SectionCard, StatusPill } from '@shazlo/ui'
import { ClipboardCheck } from 'lucide-react'
import { Link as RouterLink } from 'react-router'
import { useSummary } from '../../../api/queries'
import type * as M from '../../../api/model'
import { CardTitle } from '../../../components/CardTitle'
import { RowChevron } from '../../../components/rows'
import { dashboardCopy } from '../../../copy/dashboard'
import { formatRelative } from '../../../lib/format'
import { decisionPill } from '../../../lib/status'
import { inset, Loaded, rowLinkSx, rowSx, RowSkeletons } from './common'
import { dashboardLinks as links } from './links'

type Decision = M.Summary['recent'][number]
const copy = dashboardCopy.decisions

// One link per decision: what was decided, for which brand, the outcome, and who decided when. On a
// phone the outcome moves under the title.
function DecisionRow({ decision }: { decision: Decision }) {
  const pill = decisionPill[decision.decision]
  return (
    <Box component="li" sx={rowSx}>
      <Link component={RouterLink} to={links.decision(decision)} underline="none" sx={rowLinkSx}>
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: { xs: 'wrap', sm: 'nowrap' }, gap: { xs: 1, sm: 2 }, alignItems: { xs: 'flex-start', sm: 'center' } }}>
          <Box sx={{ flex: 1, minWidth: 0, flexBasis: { xs: '100%', sm: 0 } }}>
            <Typography component="span" variant="body1" sx={{ display: 'block', ...emphasis.semibold, color: 'text.primary', overflowWrap: 'anywhere' }}>
              {decision.title}
            </Typography>{' '}
            <Typography component="span" variant="body2" color="textSecondary" sx={{ display: 'block', mt: 0.25, overflowWrap: 'anywhere' }}>
              {decision.vendor.name} <span aria-hidden="true">·</span> {copy.kind[decision.kind]}
            </Typography>
          </Box>{' '}
          {/* On a phone this sits on its own line and may wrap; from 600 px it keeps its width. */}
          <Box sx={{ display: 'flex', flexDirection: { xs: 'row', sm: 'column' }, flexWrap: 'wrap', alignItems: { xs: 'center', sm: 'flex-end' }, gap: { xs: 1, sm: 0.5 }, flexShrink: { xs: 1, sm: 0 }, minWidth: 0 }}>
            <StatusPill status={pill.status} label={pill.label} />{' '}
            <Typography component="span" variant="caption" color="textSecondary" sx={{ overflowWrap: 'anywhere' }}>
              {copy.by(decision.reviewer)} <span aria-hidden="true">·</span> <time dateTime={decision.at}>{formatRelative(decision.at)}</time>
            </Typography>
          </Box>
        </Box>
        <RowChevron />
      </Link>
    </Box>
  )
}

export function RecentDecisionsCard() {
  const query = useSummary()
  return (
    <SectionCard title={<CardTitle icon={ClipboardCheck}>{copy.title}</CardTitle>} padded={false}>
      <Loaded query={query} data={query.data?.recent} subject={copy.label} errorTitle={copy.error} bannerSx={{ ...inset, pb: 2 }} skeleton={<RowSkeletons label={copy.loading} />}>
        {(recent) =>
          recent.length === 0 ? (
            <EmptyState illustration="clock" title={copy.empty.title} body={copy.empty.body} />
          ) : (
            <Box component="ul" aria-label={copy.label} sx={{ listStyle: 'none', m: 0, p: 0 }}>
              {recent.map((decision) => (
                <DecisionRow key={decision.id} decision={decision} />
              ))}
            </Box>
          )
        }
      </Loaded>
    </SectionCard>
  )
}
