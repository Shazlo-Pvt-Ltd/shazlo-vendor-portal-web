import { Button } from '@mui/material'
import { EmptyState, PageHeader } from '@shazlo/ui'
import { Link as RouterLink } from 'react-router'
import { paths } from '../../app/paths'
import { miscCopy as copy } from '../../copy/misc'

type Page = keyof typeof copy.pages

/** A page that exists in the navigation but is not built yet (Help & support). Later work replaces it. */
export function ComingSoon({ page }: { page: Page }) {
  const p = copy.pages[page]
  return (
    <>
      <PageHeader title={p.title} subtitle={p.subtitle} />
      <EmptyState
        illustration={p.illustration}
        title={p.emptyTitle}
        body={p.emptyBody}
        action={
          <Button variant="outlined" component={RouterLink} to={paths.overview}>
            {copy.backToOverview}
          </Button>
        }
      />
    </>
  )
}
