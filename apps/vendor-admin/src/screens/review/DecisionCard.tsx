import { Button, Checkbox, FormControlLabel, FormGroup, Stack, Typography } from '@mui/material'
import { SectionCard } from '@shazlo/ui'
import { useId, useState } from 'react'
import { reviewCopy as copy } from '../../copy/review'

// The reviewer's checklist and the two decisions. Approving needs every check ticked; sending back
// is always possible, because a failed check is the reason to send something back.
export function DecisionCard({ checks, approving, onApprove, onSendBack }: { checks: readonly string[]; approving: boolean; onApprove: () => void; onSendBack: () => void }) {
  const [ticked, setTicked] = useState<boolean[]>(() => checks.map(() => false))
  const titleId = useId()
  const captionId = useId()
  const ready = ticked.every(Boolean)
  return (
    <SectionCard title={<span id={titleId}>{copy.checklist.title}</span>}>
      <FormGroup role="group" aria-labelledby={titleId}>
        {checks.map((label, i) => (
          <FormControlLabel
            key={label}
            label={label}
            control={<Checkbox checked={ticked[i]} onChange={(_, on) => setTicked((t) => t.map((v, j) => (j === i ? on : v)))} />}
            sx={{ alignItems: 'flex-start', mr: 0, '& .MuiCheckbox-root': { mt: -0.75 }, '& .MuiFormControlLabel-label': { pt: '1px' } }}
          />
        ))}
      </FormGroup>
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
    </SectionCard>
  )
}
