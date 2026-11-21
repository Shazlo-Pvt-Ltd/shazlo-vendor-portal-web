import { Button } from '@mui/material'
import { EmptyState, PageHeader } from '@shazlo/ui'
import { Link as RouterLink } from 'react-router'
import { paths } from '../../app/paths'
import { miscCopy as copy } from '../../copy/misc'
import { AuthLayout, AuthTitle } from '../auth/AuthLayout'

type Page = keyof typeof copy.pages

// Signed-out pages (reached from an email) use the sign-in frame; the rest sit in the seller shell.
const SIGNED_OUT: ReadonlySet<Page> = new Set(['verifyEmail'])

/** A page that exists in the navigation but is not built yet. Later work replaces each one. */
export function ComingSoon({ page }: { page: Page }) {
  const p = copy.pages[page]
  if (SIGNED_OUT.has(page)) {
    return (
      <AuthLayout>
        <AuthTitle title={p.title} subtitle={p.subtitle} />
        <EmptyState
          illustration={p.illustration}
          title={p.emptyTitle}
          body={p.emptyBody}
          action={
            <Button variant="outlined" component={RouterLink} to={paths.signIn}>
              {copy.backToSignIn}
            </Button>
          }
        />
      </AuthLayout>
    )
  }
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
