import { isRouteErrorResponse, useRouteError } from 'react-router'
import { ErrorScreen } from './ErrorScreen'
import { NotFound } from './NotFound'

/** The router's error element: a 404 is a not-found page, anything else a plain error screen. */
export function RouteError() {
  const error = useRouteError()
  if (isRouteErrorResponse(error) && error.status === 404) {
    return <NotFound />
  }
  if (import.meta.env.DEV) {
    console.error(error)
  }
  return <ErrorScreen />
}
