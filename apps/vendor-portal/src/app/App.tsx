import { CssBaseline, ThemeProvider } from '@mui/material'
import { SnackbarProvider, theme } from '@shazlo/ui'
import { QueryClientProvider } from '@tanstack/react-query'
import { useEffect } from 'react'
import { RouterProvider, type createBrowserRouter } from 'react-router'
import { AppContextProvider, type AppContext } from '../api/context'
import { SellerGlobalStyles } from '../shell/SellerGlobalStyles'

type Router = ReturnType<typeof createBrowserRouter>

export function App({ context, router }: { context: AppContext; router: Router }) {
  useEffect(() => {
    // After a page load the access token is gone (it lives in memory only): swap the refresh
    // cookie for a new one. Parallel calls (StrictMode runs this twice) share one request.
    if (context.session.status() === 'loading') void context.api.refresh()
  }, [context])

  return (
    <AppContextProvider value={context}>
      <QueryClientProvider client={context.queryClient}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <SellerGlobalStyles />
          <SnackbarProvider>
            <RouterProvider router={router} />
          </SnackbarProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </AppContextProvider>
  )
}
