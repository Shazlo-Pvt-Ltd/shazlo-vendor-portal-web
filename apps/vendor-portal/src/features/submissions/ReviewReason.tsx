import { Box } from '@mui/material'

/**
 * An admin's reason for not approving something, exactly as they wrote it: as text (React escapes
 * it, so a reason that looks like HTML is shown literally), with its line breaks kept.
 */
export function ReviewReason({ reason }: { reason: string | null | undefined }) {
  const text = reason?.trim()
  return (
    <Box component="span" sx={{ whiteSpace: 'pre-line', overflowWrap: 'anywhere' }} data-testid="review-reason">
      {text ? text : 'No reason was given.'}
    </Box>
  )
}
