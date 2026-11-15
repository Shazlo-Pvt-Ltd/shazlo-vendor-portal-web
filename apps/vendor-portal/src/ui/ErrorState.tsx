import { Alert, AlertTitle, Button, Typography } from '@mui/material'
import { ApiError } from '../api/errors'
import { friendlyError } from '../features/errors'

interface Props {
  /** The failure: an `ApiError`, a `NetworkError` or anything else. Its details are never shown raw. */
  error: unknown
  title?: string
  onRetry?: () => void
}

/**
 * A call failed. Shows a plain sentence, "Try again", and the request ID (to quote to support)
 * when the server gave one. Never a status code, a stack trace or a server detail.
 */
export function ErrorState({ error, title = "We couldn't load this", onRetry }: Props) {
  const requestId = error instanceof ApiError ? error.requestId : undefined
  return (
    <Alert
      severity="error"
      role="alert"
      action={onRetry ? <Button color="inherit" size="small" onClick={onRetry}>Try again</Button> : undefined}
    >
      <AlertTitle>{title}</AlertTitle>
      {friendlyError(error).message}
      {requestId ? (
        <Typography variant="caption" component="p" sx={{ mt: 1 }}>
          If this keeps happening, tell support this reference: {requestId}
        </Typography>
      ) : null}
    </Alert>
  )
}
