import { Box, Button, CircularProgress, CssBaseline, Stack, ThemeProvider, Typography } from '@mui/material'
import { EmptyIllustration, Logo, theme } from '@shazlo/ui'
import { QueryClientProvider } from '@tanstack/react-query'
import { createContext, Suspense, useContext, type ReactNode } from 'react'
import { Outlet, RouterProvider, type createBrowserRouter } from 'react-router'
import { ModuleRuntime, shellOrigin, useRuntime, type Host } from '../runtime/runtime'
import { PageFallback } from './PageFallback'

type Router = ReturnType<typeof createBrowserRouter>
type Config = { host: Host; apiUrl: string }
const ConfigContext = createContext<Config | null>(null)

function Panel({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <Stack spacing={1.5} role="alert" sx={{ alignItems: 'center', textAlign: 'center', minHeight: '100dvh', justifyContent: 'center', px: 3 }}>
      <Logo product="One" />
      <EmptyIllustration name="sheet" />
      <Typography variant="h1" component="h1">{title}</Typography>
      <Typography variant="body1" color="text.secondary" sx={{ maxWidth: '46ch' }}>{body}</Typography>
      {action}
    </Stack>
  )
}

// Until the shell sends `auth`, nothing renders that could call the API.
function Gate() {
  const { status, queryClient } = useRuntime()
  if (status === 'standalone') {
    const shell = shellOrigin()
    return <Panel title="Open this in Shazlo One" body="The vendor review module only works inside Shazlo One, which signs you in and keeps your session." action={<Button variant="contained" href={`${shell}/vendors${window.location.pathname}`}>Open Shazlo One</Button>} />
  }
  if (status === 'ended') return <Panel title="Your session ended" body="Shazlo One stopped sending a session to this module. Reload Shazlo One to sign in again." />
  if (status === 'waiting') {
    return (
      <Box role="status" aria-label="Connecting to Shazlo One" sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}>
        <CircularProgress size={28} aria-hidden="true" />
      </Box>
    )
  }
  return (
    <QueryClientProvider client={queryClient}>
      {/* Page titles wrap between words, never inside one (the shared header allows any break). */}
      <Box component="main" sx={{ px: { xs: 2, md: 5 }, pt: { xs: 3, md: 4 }, pb: 8, '& h1': { overflowWrap: 'break-word', hyphens: 'none', minWidth: 0, maxWidth: '100%' } }}>
        <Box sx={{ maxWidth: 1240, mx: 'auto' }}>
          <Suspense fallback={<PageFallback />}>
            <Outlet />
          </Suspense>
        </Box>
      </Box>
    </QueryClientProvider>
  )
}

export function ModuleRoot() {
  const config = useContext(ConfigContext)!
  return (
    <ModuleRuntime host={config.host} apiUrl={config.apiUrl}>
      <Gate />
    </ModuleRuntime>
  )
}

export function App({ host, apiUrl, router }: Config & { router: Router }) {
  return (
    <ConfigContext.Provider value={{ host, apiUrl }}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <RouterProvider router={router} />
      </ThemeProvider>
    </ConfigContext.Provider>
  )
}
