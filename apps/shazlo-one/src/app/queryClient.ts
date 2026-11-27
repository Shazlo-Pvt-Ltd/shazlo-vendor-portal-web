import { QueryClient } from '@tanstack/react-query'

const MAX_RETRIES = 2

/** The HTTP status carried by an error, if it has one (the API client's errors do). */
function statusOf(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status: unknown }).status
    return typeof status === 'number' ? status : undefined
  }
  return undefined
}

/**
 * Retry a failed query only when trying again could help: a 4xx answer (a missing page, a refused
 * request, a validation error) will be the same next time; a network error or a 5xx may not be.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  const status = statusOf(error)
  if (status !== undefined && status >= 400 && status < 500) {
    return false
  }
  return failureCount < MAX_RETRIES
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        staleTime: 30_000,
        refetchOnWindowFocus: true,
      },
    },
  })
}
