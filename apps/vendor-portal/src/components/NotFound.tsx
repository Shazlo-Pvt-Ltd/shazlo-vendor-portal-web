import { Button } from '@mui/material'
import { Link } from 'react-router'
import { frameCopy as copy } from '../copy/frame'
import { useDocumentTitle } from '../app/title'
import { Notice, PlainPage } from './Notice'

/** "Nothing here." Inside the signed-in frame (`embedded`) it is just the page; alone it is a page. */
export function NotFound({ embedded = false }: { embedded?: boolean }) {
  useDocumentTitle(copy.notFound.pageTitle)
  const notice = (
    <Notice
      title={copy.notFound.title}
      illustration="box"
      actions={
        <Button component={Link} to="/" variant="contained">
          {copy.goHome}
        </Button>
      }
    >
      {copy.notFound.body}
    </Notice>
  )
  return embedded ? notice : <PlainPage>{notice}</PlainPage>
}
