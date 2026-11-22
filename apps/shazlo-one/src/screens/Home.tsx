import { Stack } from '@mui/material'
import { EmptyState, PageHeader } from '@shazlo/ui'
import { useVendorSummary } from '../api/queries'
import { modules } from '../app/registry'
import { homeCopy as copy } from '../copy/home'
import { useSession } from '../session/useSession'
import { partOfDay } from './home/time'
import { PublishingCard, RecentDecisions, SummaryError, VendorsCard } from './home/VendorCards'

const vendorModule = modules.find((m) => m.id === 'vendor-admin')!

// A-02: what is waiting in each module the admin's role opens, then recent decisions. Super admins
// pass every role check, so they always see the vendor cards.
export default function Home() {
  const { admin, can } = useSession()
  const vendors = can(vendorModule.roles)
  const summary = useVendorSummary(vendors)
  const firstName = admin?.display_name.trim().split(/\s+/)[0] ?? ''
  const data = summary.data
  const failed = summary.isError && !data

  return (
    <>
      <PageHeader title={copy.greeting(partOfDay(), firstName)} subtitle={copy.subtitle} />
      {!vendors ? (
        <EmptyState illustration="store" title={copy.noModules.title} body={copy.noModules.body} />
      ) : failed ? (
        <SummaryError message={summary.error?.message ?? ''} onRetry={() => void summary.refetch()} />
      ) : (
        <Stack spacing={{ xs: 2.5, md: 3 }}>
          <VendorsCard summary={data} />
          <PublishingCard summary={data} />
          <RecentDecisions summary={data} />
        </Stack>
      )}
    </>
  )
}
