import { CssBaseline, ThemeProvider } from '@mui/material'
import { theme } from '@shazlo/ui'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { AuthProvider } from '../session/AuthProvider'
import type { SessionStore } from '../session/store'
import { SellerGlobalStyles } from '../shell/SellerGlobalStyles'
import { createQueryClient } from './queryClient'

/** The theme, the seller page rules and the last-resort error boundary. */
export function ThemeProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <SellerGlobalStyles />
      <ErrorBoundary>{children}</ErrorBoundary>
    </ThemeProvider>
  )
}

interface ProvidersProps {
  children: ReactNode
  /** For tests: a session store instead of the one talking to vendor-api. */
  session?: SessionStore
  /** For tests: a query client without retries. */
  queryClient?: QueryClient
}

/** Everything around the routes: theme, error boundary, data cache and the session. */
export function Providers({ children, session, queryClient: provided }: ProvidersProps) {
  const [queryClient] = useState(() => provided ?? createQueryClient())
  return (
    <ThemeProviders>
      <QueryClientProvider client={queryClient}>
        <AuthProvider store={session}>{children}</AuthProvider>
      </QueryClientProvider>
    </ThemeProviders>
  )
}
