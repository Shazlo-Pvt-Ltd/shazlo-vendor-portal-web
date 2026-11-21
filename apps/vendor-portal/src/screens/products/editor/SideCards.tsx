import { Box, Link, Stack, Typography } from '@mui/material'
import { brand, neutral, radius, SectionCard, status, statusBackground } from '@shazlo/ui'
import { Check, Clock } from 'lucide-react'
import { memo, useId } from 'react'
import { Link as RouterLink } from 'react-router'
import type { Schemas } from '../../../api/model'
import { useStoreDetails } from '../../../api/queries'
import { paths } from '../../../app/paths'
import { productEditorCopy } from '../../../copy/productEditor'
import { formatStamp } from '../../../lib/format'

const copy = productEditorCopy

// Shown on live products: which edits go straight to the app and which wait for review.
export function LiveNote() {
  const id = useId()
  const points = [
    { icon: Check, text: copy.liveNote.immediate },
    { icon: Clock, text: copy.liveNote.reviewed },
  ]
  return (
    <Box component="section" aria-labelledby={id} sx={{ bgcolor: statusBackground.info, borderRadius: `${radius.card}px`, px: { xs: 2, sm: 3 }, py: 2.5 }}>
      <Typography id={id} variant="h2" component="h2" sx={{ mb: 1.5 }}>
        {copy.liveNote.title}
      </Typography>
      <Stack component="ul" spacing={1.25} sx={{ listStyle: 'none', p: 0, m: 0 }}>
        {points.map(({ icon: Icon, text }) => (
          <Stack component="li" key={text} direction="row" spacing={1.25} sx={{ alignItems: 'flex-start' }}>
            <Box component="span" sx={{ color: status.info, display: 'flex', pt: '2px', flexShrink: 0 }}>
              <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
            </Box>
            <Typography variant="body2">{text}</Typography>
          </Stack>
        ))}
      </Stack>
    </Box>
  )
}

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
