import { Box, Button, Checkbox, FormControlLabel, FormGroup, Link, Stack, Typography } from '@mui/material'
import { neutral, SectionCard } from '@shazlo/ui'
import { useId, useState } from 'react'
import { reviewCopy as copy } from '../../copy/review'

export type Checklist = ReturnType<typeof useChecklist>

// The reviewer's ticks, shared by the checklist card and (on phones) the decision bar.
export function useChecklist(checks: readonly string[]) {
  const [ticked, setTicked] = useState<boolean[]>(() => checks.map(() => false))
  const id = useId()
  return {
    checks,
    ticked,
    id,
    ready: ticked.every(Boolean),
    toggle: (index: number, on: boolean) => setTicked((t) => t.map((v, j) => (j === index ? on : v))),
  }
}

type Actions = { checklist: Checklist; approving: boolean; onApprove: () => void; onSendBack: () => void }

// The reviewer's checklist and the two decisions. Approving needs every check ticked; sending back
// is always possible, because a failed check is the reason to send something back. On phones the
// decisions move to <DecisionBar> and the card keeps the checks.
export function DecisionCard({ checklist, approving, onApprove, onSendBack, withActions = true }: Actions & { withActions?: boolean }) {
  const titleId = useId()
  const captionId = useId()
  const { checks, ticked, ready, toggle } = checklist
  return (
    <SectionCard title={<span id={titleId}>{copy.checklist.title}</span>}>
      <FormGroup role="group" id={checklist.id} aria-labelledby={titleId} sx={{ scrollMarginTop: 16, scrollMarginBottom: 160 }}>
        {checks.map((label, i) => (
          <FormControlLabel
            key={label}
            label={label}
            control={<Checkbox checked={ticked[i]} onChange={(_, on) => toggle(i, on)} />}
            sx={{ alignItems: 'flex-start', mr: 0, '& .MuiCheckbox-root': { mt: -0.75 }, '& .MuiFormControlLabel-label': { pt: '1px' } }}
          />
        ))}
      </FormGroup>
      {withActions && (
        <Stack spacing={1.25} sx={{ mt: 2.5 }}>
          <Button variant="contained" size="large" fullWidth disabled={!ready || approving} onClick={onApprove} aria-describedby={ready ? undefined : captionId}>
            {approving ? copy.checklist.approving : copy.checklist.approve}
          </Button>
          {!ready && (
            <Typography id={captionId} variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
              {copy.checklist.tickAll}
            </Typography>
          )}
          <Button variant="outlined" size="large" fullWidth onClick={onSendBack} disabled={approving}>
            {copy.checklist.sendBack}
          </Button>
        </Stack>
      )}
    </SectionCard>
  )
}

// Phones: the two decisions stay at the bottom of the screen while the reviewer scrolls the
// submission. Until every check is ticked, a link takes them to the checklist.
export function DecisionBar({ checklist, approving, onApprove, onSendBack }: Actions) {
  const captionId = useId()
  const { ready } = checklist
  const toChecklist = () => document.getElementById(checklist.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  return (
    <Box
      component="section"
      aria-label={copy.checklist.bar}
      sx={{ position: 'sticky', bottom: 0, zIndex: 3, mx: -2, mt: 3, px: 2, pt: 1.5, pb: 'calc(12px + env(safe-area-inset-bottom, 0px))', bgcolor: neutral.surface, borderTop: `1px solid ${neutral.line}` }}
    >
      {!ready && (
        <Typography id={captionId} variant="caption" color="text.secondary" component="p" sx={{ mb: 1, textAlign: 'center' }}>
          <Link component="button" type="button" onClick={toChecklist} sx={{ typography: 'caption', verticalAlign: 'baseline' }}>
            {copy.checklist.tickAll}
          </Link>
        </Typography>
      )}
      {/* Side by side when both labels fit on one line; stacked on the narrowest phones. */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, '& > .MuiButton-root': { flex: '1 1 auto', px: 2, whiteSpace: 'nowrap' } }}>
        <Button variant="contained" size="large" disabled={!ready || approving} onClick={onApprove} aria-describedby={ready ? undefined : captionId}>
          {approving ? copy.checklist.approving : copy.checklist.approve}
        </Button>
        <Button variant="outlined" size="large" onClick={onSendBack} disabled={approving}>
          {copy.checklist.sendBack}
        </Button>
      </Box>
    </Box>
  )
}
