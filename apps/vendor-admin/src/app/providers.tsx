import { CssBaseline, ThemeProvider } from '@mui/material'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { theme } from '@shazlo/ui'
import { KitGlobalStyles, ToastProvider, UiLinkProvider } from '@shazlo/ui/components'
import { RouterLink } from './RouterLink'

export function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 } } })
}

export function AppProviders({ children, client }: { children: ReactNode; client?: QueryClient }) {
  const [qc] = useState(() => client ?? makeQueryClient())
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <KitGlobalStyles />
      <QueryClientProvider client={qc}>
        <UiLinkProvider component={RouterLink}>
          <ToastProvider>
            {children}
          </ToastProvider>
        </UiLinkProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
