import { Box, Stack } from '@mui/material'
import { EmptyState, PageHeader } from '@shazlo/ui'
import { useVendorSummary } from '../api/queries'
import { modules } from '../app/registry'
import { homeCopy as copy } from '../copy/home'
import { useSession } from '../session/useSession'
import { AdminsCard } from './home/AdminsCard'
import { partOfDay } from './home/time'
import { PublishingCard, RecentDecisions, SummaryError, VendorsCard } from './home/VendorCards'

const vendorModule = modules.find((m) => m.id === 'vendor-admin')!

// A-02: what is waiting in each module the admin's role opens, then recent decisions.
export default function Home() {
  const { admin, can } = useSession()
  const vendors = can(vendorModule.roles)
  const superAdmin = Boolean(admin?.roles.includes('super_admin'))
  const summary = useVendorSummary(vendors)
  const firstName = admin?.display_name.trim().split(/\s+/)[0] ?? ''
  const data = summary.data
  const failed = summary.isError && !data

  return (
    <>
      <PageHeader title={copy.greeting(partOfDay(), firstName)} subtitle={copy.subtitle} />
      {!vendors && !superAdmin ? (
        <EmptyState illustration="store" title={copy.noModules.title} body={copy.noModules.body} />
      ) : (
        <Stack spacing={{ xs: 2.5, md: 3 }}>
          {vendors && failed && <SummaryError message={summary.error?.message ?? ''} onRetry={() => void summary.refetch()} />}
          {vendors && !failed && (
            <>
              <VendorsCard summary={data} />
              <PublishingCard summary={data} />
            </>
          )}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: superAdmin && vendors && !failed ? 'minmax(0, 2fr) minmax(0, 1fr)' : 'minmax(0, 1fr)' }, gap: { xs: 2.5, md: 3 }, alignItems: 'start' }}>
            {vendors && !failed && <RecentDecisions summary={data} />}
            {superAdmin && <AdminsCard />}
          </Box>
        </Stack>
      )}
    </>
  )
}
