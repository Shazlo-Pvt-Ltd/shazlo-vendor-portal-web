import { Button } from '@mui/material'
import { frameCopy as copy } from '../copy/frame'
import { Notice, PlainPage } from './Notice'

interface Props {
  onRetry?: () => void
  /** Inside the seller frame the navigation is still there; alone, the message is the whole page. */
  embedded?: boolean
}

/** What a seller sees when something broke: no details, a way to try again, a way out. */
export function ErrorScreen({ onRetry, embedded = false }: Props) {
  const notice = (
    <Notice
      title={copy.error.title}
      illustration="sheet"
      focus={embedded}
      actions={
        <>
          {onRetry ? (
            <Button variant="contained" onClick={onRetry}>
              {copy.error.tryAgain}
            </Button>
          ) : null}
          <Button variant={onRetry ? 'outlined' : 'contained'} onClick={() => window.location.reload()}>
            {copy.error.reload}
          </Button>
        </>
      }
    >
      {copy.error.body}
    </Notice>
  )
  return embedded ? <div role="alert">{notice}</div> : <PlainPage>{notice}</PlainPage>
}
