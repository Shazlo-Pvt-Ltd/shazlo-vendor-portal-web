import { Box, LinearProgress, Link, Stack, Typography } from '@mui/material'
import { Banner, brand } from '@shazlo/ui'
import { useState } from 'react'
import { Link as RouterLink } from 'react-router'
import type { Schemas } from '../api/client'
import { useMe } from '../api/queries'
import { paths } from '../app/paths'
import { shellCopy as copy } from '../copy/shell'

const dismissKey = (vendorId: string) => `shazlo.seller.setup-dismissed.${vendorId}`

function readDismissed(vendorId: string): boolean {
  try {
    return localStorage.getItem(dismissKey(vendorId)) === '1'
  } catch {
    return false
  }
}

export function setupSteps(setup: Schemas['Me']['setup']) {
  return [
    { key: 'password_set', done: setup.password_set, label: copy.setupSteps.password_set, to: paths.settings },
    { key: 'brand_page', done: setup.brand_page, label: copy.setupSteps.brand_page, to: paths.brand },
    { key: 'first_product', done: setup.first_product, label: copy.setupSteps.first_product, to: paths.newProduct },
    { key: 'return_policy', done: setup.return_policy, label: copy.setupSteps.return_policy, to: paths.settings },
    { key: 'live_products', done: setup.live_products >= setup.live_target, label: copy.setupSteps.live_products(setup.live_products, setup.live_target), to: paths.products },
  ]
}

// Options board pick: a slim progress banner on every page until setup is done or closed.
export function SetupBanner() {
  const me = useMe().data
  const [dismissed, setDismissed] = useState<string | null>(null)
  if (!me) return null
  const vendorId = me.vendor.id
  if (dismissed === vendorId || readDismissed(vendorId)) return null
  const steps = setupSteps(me.setup)
  const done = steps.filter((s) => s.done).length
  const next = steps.find((s) => !s.done)
  if (!next) return null

  const dismiss = () => {
    try {
      localStorage.setItem(dismissKey(vendorId), '1')
    } catch {
      // Without storage the banner stays closed for this visit only.
    }
    setDismissed(vendorId)
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
            <LinearProgress
              variant="determinate"
              value={(done / steps.length) * 100}
              aria-hidden="true"
              sx={{ flex: 1, maxWidth: 240, height: 6, borderRadius: 3, bgcolor: 'rgba(255, 252, 227, 0.9)', '& .MuiLinearProgress-bar': { bgcolor: brand.amber, borderRadius: 3 } }}
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
