import { Alert, Box, Typography } from '@mui/material'

interface Props {
  problems: string[]
}

/** Shown instead of a blank page when the build's environment is wrong. */
export function Misconfigured({ problems }: Props) {
  return (
    <Box component="main" sx={{ p: 3, maxWidth: 640, mx: 'auto', mt: 8 }}>
      <Typography component="h1" variant="h4" gutterBottom>
        The portal is misconfigured
      </Typography>
      <Typography sx={{ mb: 2 }}>
        It cannot reach its server. If you are the developer, fix the setting below and rebuild; if
        you are a vendor, please tell Shazlo support.
      </Typography>
      <Alert severity="error">
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      </Alert>
    </Box>
  )
}
