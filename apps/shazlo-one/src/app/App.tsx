import { CssBaseline, ThemeProvider } from '@mui/material'
import { SnackbarProvider, theme } from '@shazlo/ui'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, type createBrowserRouter } from 'react-router'
import { AppContextProvider, type AppContext } from '../api/context'

type Router = ReturnType<typeof createBrowserRouter>

export function App({ context, router }: { context: AppContext; router: Router }) {
  return (
    <AppContextProvider value={context}>
      <QueryClientProvider client={context.queryClient}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <SnackbarProvider>
            <RouterProvider router={router} />
          </SnackbarProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </AppContextProvider>
  )
}
