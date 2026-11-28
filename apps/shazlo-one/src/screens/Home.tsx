import { Stack } from '@mui/material'
import { EmptyState, PageHeader } from '@shazlo/ui'
import { registry } from '../app/registry'
import { homeCopy as copy } from '../copy/home'
import { useSession } from '../session/useSession'
import { partOfDay } from './home/time'
import { ModuleCards } from './home/ModuleCards'

// A-02: what is waiting in each module the admin's role opens, in registry order. Super admins pass
// every role check, so they see every module.
export default function Home() {
  const { admin, can } = useSession()
  const allowed = registry.filter((m) => can(m.roles))
  const firstName = admin?.display_name.trim().split(/\s+/)[0] ?? ''

  return (
    <>
      <PageHeader title={copy.greeting(partOfDay(), firstName)} subtitle={copy.subtitle} />
      {allowed.length === 0 ? (
        <EmptyState illustration="store" title={copy.noModules.title} body={copy.noModules.body} />
      ) : (
        <Stack spacing={{ xs: 2.5, md: 3 }}>
          {allowed.map((entry) => (
            <ModuleCards key={entry.id} entry={entry} />
          ))}
        </Stack>
      )}
    </>
  )
}
