import { CssBaseline, GlobalStyles, ThemeProvider } from '@mui/material'
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
      {/* A focus ring on everything that takes focus, for keyboard users. */}
      <GlobalStyles
        styles={(t) => ({
          ':focus-visible': { outline: `3px solid ${t.palette.primary.dark}`, outlineOffset: '2px' },
        })}
      />
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </ErrorBoundary>
    </ThemeProvider>
  )
}
