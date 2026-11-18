import { Box, Typography } from '@mui/material'
import { useEffect } from 'react'

interface Props {
  title: string
}

/** A screen that a later issue fills in. It already sets the page title, as every screen must. */
export function PlaceholderPage({ title }: Props) {
  useEffect(() => {
    document.title = `${title} · Shazlo Vendor Portal`
  }, [title])
  return (
    <Box component="main" sx={{ p: 3 }}>
      <Typography component="h1" variant="h4">
        {title}
      </Typography>
    </Box>
  )
}
