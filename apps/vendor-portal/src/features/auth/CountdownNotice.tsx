import { Alert } from '@mui/material'

const visuallyHidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const

/**
 * "Too many attempts, try again in N s". Screen readers hear the wait once, not every second.
 */
export function CountdownNotice({ seconds }: { seconds: number }) {
  return (
    <Alert severity="warning" sx={{ mb: 2 }}>
      <span style={visuallyHidden}>Too many attempts. Try again in about {seconds} seconds.</span>
      <span aria-hidden="true">Too many attempts. Try again in {seconds} s.</span>
    </Alert>
  )
}
