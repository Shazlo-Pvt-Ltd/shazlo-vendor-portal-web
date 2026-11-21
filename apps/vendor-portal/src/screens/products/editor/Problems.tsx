import { Box, Button, Link, Stack, Typography } from '@mui/material'
import { Banner, neutral } from '@shazlo/ui'
import { forwardRef, type ReactNode } from 'react'
import { Link as RouterLink } from 'react-router'
import { paths } from '../../../app/paths'
import { catalogCopy } from '../../../copy/catalog'
import { productEditorCopy } from '../../../copy/productEditor'
import { SUBMIT_REQUIREMENTS, type SubmitRequirement } from '../../../lib/catalog'
import type { Problems } from './layout'

const copy = productEditorCopy

export const problemEntries = (problems: Problems) => SUBMIT_REQUIREMENTS.flatMap((key) => (problems[key] ? [[key, problems[key]] as const] : []))

// One line per problem, each a link to where it is fixed. Store details are fixed on their own page.
function ProblemLinks({ problems, onGo }: { problems: Problems; onGo: (key: SubmitRequirement) => void }) {
  return (
    <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
      {problemEntries(problems).map(([key, message]) => {
        const text = copy.banners.problem(catalogCopy.submitRequirements[key], message)
        const sx = { textAlign: 'left', verticalAlign: 'baseline', color: 'inherit', textDecorationColor: 'currentColor' } as const
        return (
          <li key={key}>
            {key === 'store_details' ? (
              <Link component={RouterLink} to={paths.storeDetails} variant="body2" sx={sx}>
                {text}
              </Link>
            ) : (
              <Link component="button" type="button" variant="body2" onClick={() => onGo(key)} sx={sx}>
                {text}
              </Link>
            )}
          </li>
        )
      })}
    </Box>
  )
}

// The list at the top after a send that was refused (GOV.UK error summary): it takes focus, and
// each line goes away as soon as it is fixed.
export const ProblemSummary = forwardRef<HTMLDivElement, { problems: Problems; onGo: (key: SubmitRequirement) => void }>(function ProblemSummary({ problems, onGo }, ref) {
  return (
    <Box ref={ref} tabIndex={-1} sx={{ outline: 'none' }}>
      <Banner tone="error" title={copy.banners.problems}>
        <ProblemLinks problems={problems} onGo={onGo} />
      </Banner>
    </Box>
  )
})

export type SummaryRow = { step: string; value: string; onChange: () => void }

// Phones: the page after the four steps. What is still missing, with links back to the step, then
// the answers so far with Change, then Send for review in the sticky footer.
export function CheckPage({ problems, onGo, rows, readOnly, banners }: { problems: Problems; onGo: (key: SubmitRequirement) => void; rows: SummaryRow[]; readOnly: boolean; banners?: ReactNode }) {
  const missing = problemEntries(problems).length > 0
  return (
    <Stack spacing={3}>
      {banners}
      {!readOnly &&
        (missing ? (
          <Box component="section" aria-label={copy.check.missingTitle}>
            <Typography variant="h2" component="h2">
              {copy.check.missingTitle}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {copy.check.missingBody}
            </Typography>
            <ProblemLinks problems={problems} onGo={onGo} />
          </Box>
        ) : (
          <Box>
            <Typography variant="h2" component="h2">
              {copy.check.ready}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {copy.check.readyBody}
            </Typography>
          </Box>
        ))}
      <Box component="ul" aria-label={copy.check.summaryLabel} sx={{ listStyle: 'none', m: 0, p: 0, borderTop: `1px solid ${neutral.line}` }}>
        {rows.map((row) => (
          <Stack component="li" key={row.step} direction="row" spacing={2} sx={{ alignItems: 'center', py: 1.5, borderBottom: `1px solid ${neutral.line}` }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" color="text.secondary">
                {row.step}
              </Typography>
              <Typography variant="body1" sx={{ overflowWrap: 'anywhere' }}>
                {row.value}
              </Typography>
            </Box>
            <Button variant="text" onClick={row.onChange} aria-label={copy.check.changeLabel(row.step)} sx={{ minHeight: 44, flexShrink: 0 }}>
              {copy.check.change}
            </Button>
          </Stack>
        ))}
      </Box>
    </Stack>
  )
}
