import { Box, LinearProgress, Link, Stack, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { Banner, brand } from '@shazlo/ui'
import { useState } from 'react'
import { Link as RouterLink } from 'react-router'
import { useMe } from '../api/queries'
import { shellCopy as copy } from '../copy/shell'
import { dismissSetup, isSetupDismissed } from './memory'
import { setupSteps } from './setup'

// Setup progress on Home (tablets and desktops) until setup is done or the seller closes it.
// Phones show the same tasks as Home's "What to do next" card and task list instead.
// Closing it lasts until the session ends (./memory.ts); nothing is written to the device.
export function SetupBanner() {
  const me = useMe().data
  const [, setClosed] = useState(0)
  if (!me) return null
  const vendorId = me.vendor.id
  if (isSetupDismissed(vendorId)) return null
  const steps = setupSteps(me.setup)
  const done = steps.filter((s) => s.done).length
  const next = steps.find((s) => !s.done)
  if (!next) return null

  const dismiss = () => {
    dismissSetup(vendorId)
    setClosed((n) => n + 1)
  }

  return (
    <Box sx={{ mb: { xs: 2.5, md: 3 } }}>
      <Banner
        tone="info"
        label={copy.setupTitle(done, steps.length)}
        onClose={dismiss}
        title={
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 1, sm: 2 }} sx={{ alignItems: { sm: 'center' } }}>
            <Typography variant="body1" component="span" sx={{ whiteSpace: 'nowrap' }}>
              {copy.setupTitle(done, steps.length)}
            </Typography>
            {/* Navy, not yellow: amber on the pale banner is too faint to read as progress. */}
            <LinearProgress
              variant="determinate"
              value={(done / steps.length) * 100}
              aria-hidden="true"
              sx={{ flex: 1, maxWidth: 240, height: 6, borderRadius: 3, bgcolor: alpha(brand.navy, 0.12), '& .MuiLinearProgress-bar': { bgcolor: brand.navy, borderRadius: 3 } }}
            />
            <Typography variant="body2" component="span" color="text.secondary">
              {copy.setupNext}{' '}
              <Link component={RouterLink} to={next.to}>
                {next.label}
              </Link>
            </Typography>
          </Stack>
        }
      />
    </Box>
  )
}
