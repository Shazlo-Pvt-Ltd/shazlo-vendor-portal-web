import { CssBaseline, ThemeProvider } from '@mui/material'
import { QueryClientProvider } from '@tanstack/react-query'
import { theme } from '@shazlo/ui'
import { useState, type ReactNode } from 'react'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { createQueryClient } from './queryClient'

/** Theme, error boundary and data cache around the whole app. */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient)
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </ErrorBoundary>
    </ThemeProvider>
  )
}
