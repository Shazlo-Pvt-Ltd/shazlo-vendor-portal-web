import { Box, CssBaseline, Stack, ThemeProvider, Typography } from '@mui/material'
import { EmptyIllustration, Logo, theme } from '@shazlo/ui'
import { shellCopy } from '../copy/shell'

const copy = shellCopy.misconfigured

// Shown instead of the shell when its settings are wrong (src/config/env.ts): a page that says so,
// rather than a blank screen or a shell talking to the wrong server. The problems never repeat a value.
export function Misconfigured({ problems }: { problems: string[] }) {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box component="main" sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', px: 2, bgcolor: 'background.default' }}>
        <Stack spacing={2} role="alert" sx={{ alignItems: 'center', textAlign: 'center', maxWidth: 560 }}>
          <Logo product="One" tone="navy" />
          <EmptyIllustration name="sheet" />
          <Typography variant="h1" component="h1">
            {copy.title}
          </Typography>
          <Typography variant="body1" color="textSecondary">
            {copy.body}
          </Typography>
          <Box component="ul" sx={{ textAlign: 'left', m: 0, pl: 2.5, overflowWrap: 'anywhere' }}>
            {problems.map((problem) => (
              <Typography component="li" variant="body2" key={problem}>
                {problem}
              </Typography>
            ))}
          </Box>
        </Stack>
      </Box>
    </ThemeProvider>
  )
}
