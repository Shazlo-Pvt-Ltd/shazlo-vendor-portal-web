import { Box, Typography } from '@mui/material'
import type { ReactNode } from 'react'

interface Props {
  title: string
  description?: ReactNode
  /** The way forward, for example a button that adds the first item. */
  action?: ReactNode
}

/** Nothing here yet: say so, and say what to do about it. */
export function EmptyState({ title, description, action }: Props) {
  return (
    <Box sx={{ textAlign: 'center', py: 6, px: 2 }}>
      <Typography component="h2" variant="h6" gutterBottom>
        {title}
      </Typography>
      {description ? (
        <Typography color="text.secondary" sx={{ mb: action ? 2 : 0 }}>
          {description}
        </Typography>
      ) : null}
      {action}
    </Box>
  )
}
