import { Button, Link } from '@mui/material'
import { Notice, PlainPage } from '../components/Notice'
import { useDocumentTitle } from '../app/title'
import { SUPPORT_EMAIL } from '../config/support'
import { frameCopy } from '../copy/frame'
import { useSession } from './AuthProvider'

const copy = frameCopy.blocked

/**
 * Shown for a vendor that is rejected or suspended. It explains and offers support; it never
 * redirects to login, which would loop (the account would be refused again).
 */
export function BlockedPage() {
  const { logout } = useSession()
  useDocumentTitle(copy.pageTitle)
  return (
    <PlainPage>
      <Notice
        title={copy.title}
        illustration="store"
        actions={
          <>
            <Button variant="contained" component="a" href={`mailto:${SUPPORT_EMAIL}`}>
              {copy.email}
            </Button>
            <Button variant="outlined" onClick={() => void logout()}>
              {copy.otherAccount}
            </Button>
          </>
        }
      >
        <p>{copy.body}</p>
        <p>
          {copy.ask} <Link href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</Link>
        </p>
      </Notice>
    </PlainPage>
  )
}
