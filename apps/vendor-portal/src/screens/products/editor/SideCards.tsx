import { Box, Link, Stack, Typography } from '@mui/material'
import { brand, neutral, SectionCard } from '@shazlo/ui'
import { memo } from 'react'
import { Link as RouterLink } from 'react-router'
import type { Schemas } from '../../../api/model'
import { useStoreDetails } from '../../../api/queries'
import { paths } from '../../../app/paths'
import { productEditorCopy } from '../../../copy/productEditor'
import { formatStamp } from '../../../lib/format'
import type { RevisionChange } from './revision'

const copy = productEditorCopy

// Main's revision panel as a side card (live products): what shoppers see now, and what the seller
// has changed, field by field. Every change, price and stock included, waits for review.
export const RevisionCard = memo(function RevisionCard({ live, working, changes, plain = false }: { live: Schemas['ProductVersion']; working: Schemas['WorkingVersion'] | null; changes: RevisionChange[]; plain?: boolean }) {
  const r = copy.revision
  const state = working?.state ?? 'editing'
  const body = (
    <>
      <Typography variant="body2" color="text.secondary">
        {r.version(live.version)}
      </Typography>
      {changes.length === 0 ? (
        <Typography variant="body2" sx={{ mt: 1 }}>
          {r.unchanged}
        </Typography>
      ) : (
        <>
          <Typography variant="h3" component="h3" sx={{ mt: 2, mb: 1 }}>
            {r.states[state]}
          </Typography>
          <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0, borderTop: `1px solid ${neutral.line}` }}>
            {changes.map((change) => (
              <Box component="li" key={change.field} sx={{ py: 1.25, borderBottom: `1px solid ${neutral.line}` }}>
                <Typography variant="body2" color="text.secondary">
                  {change.label}
                </Typography>
                {(['live', 'yours'] as const).map((side) => (
                  <Stack key={side} direction="row" spacing={1} sx={{ alignItems: 'baseline', mt: 0.25 }}>
                    <Typography component="span" variant="caption" color="text.secondary" sx={{ width: 40, flexShrink: 0 }}>
                      {r.columns[side]}
                    </Typography>
                    <Typography component="span" variant="body2" sx={{ overflowWrap: 'anywhere', fontVariantNumeric: 'tabular-nums' }}>
                      {change[side]}
                    </Typography>
                  </Stack>
                ))}
              </Box>
            ))}
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
            {r.statesNote[state]}
          </Typography>
        </>
      )}
    </>
  )
  if (plain) {
    return (
      <Box component="section" aria-label={r.title}>
        <Typography variant="h2" component="h2" sx={{ mb: 0.5 }}>
          {r.title}
        </Typography>
        {body}
      </Box>
    )
  }
  return <SectionCard title={r.title}>{body}</SectionCard>
})

// Newest first: a dot per event joined by a thin line.
export const HistoryCard = memo(function HistoryCard({ history }: { history: Schemas['Product']['history'] }) {
  return (
    <SectionCard title={copy.history.title}>
      <Box component="ol" sx={{ listStyle: 'none', p: 0, m: 0 }}>
        {history.map((entry, i) => {
          const last = i === history.length - 1
          const latest = i === 0
          return (
            <Box component="li" key={`${entry.event}-${entry.at}`} sx={{ position: 'relative', pl: 3.5, pb: last ? 0 : 2.5 }}>
              <Box
                aria-hidden="true"
                sx={{ position: 'absolute', left: 0, top: 5, width: 11, height: 11, borderRadius: '50%', boxSizing: 'border-box', border: `2px solid ${latest ? brand.brown : neutral.lineStrong}`, bgcolor: latest ? brand.brown : neutral.surface }}
              />
              {!last && <Box aria-hidden="true" sx={{ position: 'absolute', left: 5, top: 20, bottom: 0, width: '1px', bgcolor: neutral.line }} />}
              <Typography variant="body1">{copy.history.events[entry.event] ?? entry.event}</Typography>
              <Typography variant="caption" component="time" dateTime={entry.at} color="text.secondary" sx={{ display: 'block', fontVariantNumeric: 'tabular-nums' }}>
                {formatStamp(entry.at)}
              </Typography>
              {entry.note && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                  {entry.note}
                </Typography>
              )}
            </Box>
          )
        })}
      </Box>
    </SectionCard>
  )
})

// Returns and delivery are set once for the store, not per product (spec §7). The note says the
// store's return window when the store details have one, and links to where it is changed.
export function ReturnsNote({ plain = false }: { plain?: boolean }) {
  const returns = useStoreDetails().data?.returns
  const text = (
    <Typography variant="body2" color="text.secondary">
      {copy.returnsNote.body}
      {returns && ` ${copy.returnsNote.policy(returns.window_days)}`}{' '}
      <Link component={RouterLink} to={returns ? paths.storeSection('returns') : paths.storeDetails}>
        {copy.returnsNote.link}
      </Link>
    </Typography>
  )
  return plain ? text : <SectionCard title={copy.returnsNote.title}>{text}</SectionCard>
}
