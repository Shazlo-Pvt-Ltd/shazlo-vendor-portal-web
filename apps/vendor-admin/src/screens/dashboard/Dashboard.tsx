import { Button, Stack } from '@mui/material'
import { PageHeader } from '@shazlo/ui'
import { Link as RouterLink } from 'react-router'
import { modulePaths } from '../../app/routes'
import { dashboardCopy as copy } from '../../copy/dashboard'
import { phoneFullWidth } from '../../lib/responsive'
import { useModuleTitle } from '../../runtime/runtime'
import { BrandsWaitingCard } from './parts/BrandsWaitingCard'
import { touch } from './parts/common'
import { PublishingCard, QueueCard, VendorsCard } from './parts/FigureCards'
import { RecentDecisionsCard } from './parts/RecentDecisionsCard'

// The module's landing page (Shazlo One opens it from Vendors): the vendor side at a glance. Each
// card loads, fails and retries on its own, and every figure opens the list it counts.
export default function Dashboard() {
  useModuleTitle(copy.title)
  return (
    <>
      <PageHeader
        title={copy.heading}
        subtitle={copy.subtitle}
        actions={
          <Button variant="contained" component={RouterLink} to={modulePaths.queue} sx={{ ...touch, ...phoneFullWidth }}>
            {copy.openQueue}
          </Button>
        }
      />
      <Stack spacing={3}>
        <VendorsCard />
        <QueueCard />
        <BrandsWaitingCard />
        <PublishingCard />
        <RecentDecisionsCard />
      </Stack>
    </>
  )
}
