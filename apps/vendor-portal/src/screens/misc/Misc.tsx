import { Button } from '@mui/material'
import { EmptyState, PageHeader } from '@shazlo/ui'
import { Link as RouterLink, useRouteError } from 'react-router'
import { paths } from '../../app/paths'
import { miscCopy as copy } from '../../copy/misc'

type Page = keyof typeof copy.pages

// Store settings, Team and Help are in the sidebar but not designed yet (no wireframes).
export function ComingSoon({ page }: { page: Page }) {
  const p = copy.pages[page]
  return (
    <>
      <PageHeader title={p.title} subtitle={p.subtitle} />
      <EmptyState illustration={p.illustration} title={p.emptyTitle} body={p.emptyBody} action={<Button variant="outlined" component={RouterLink} to={paths.overview}>{copy.backToOverview}</Button>} />
    </>
  )
}

export function NotFound() {
  return (
    <EmptyState
      illustration="box"
      title={copy.notFoundTitle}
      body={copy.notFoundBody}
      action={<Button variant="contained" component={RouterLink} to={paths.overview}>{copy.backToOverview}</Button>}
    />
  )
}

export function RouteError() {
  const error = useRouteError()
  if (import.meta.env.DEV) console.error(error)
  return (
    <EmptyState
      illustration="sheet"
      title={copy.errorTitle}
      body={copy.errorBody}
      action={<Button variant="contained" onClick={() => window.location.reload()}>{copy.reload}</Button>}
    />
  )
}
