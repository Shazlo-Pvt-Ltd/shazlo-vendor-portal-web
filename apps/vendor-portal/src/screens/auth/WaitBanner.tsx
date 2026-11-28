import { Box } from '@mui/material'
import { Banner } from '@shazlo/ui'
import { authCopy } from '../../copy/auth'
import { srOnly } from '../../lib/a11y'

const copy = authCopy.failures

/**
 * "Too many attempts. Try again in N s." after a 429 (the seconds come from `Retry-After`). The
 * number ticks on screen; a screen reader hears the wait once, not every second.
 */
export function WaitBanner({ seconds }: { seconds: number }) {
  return (
    <Banner
      tone="warning"
      title={
        <>
          <Box component="span" sx={srOnly}>
            {copy.waitAnnounced}
          </Box>
          <span aria-hidden="true">{copy.wait(seconds)}</span>
        </>
      }
    />
  )
}
