import { Box, Stack, Typography } from '@mui/material'
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import { usePageTitle } from '../hooks/usePageTitle'

/**
 * Given by the shell. A page heading calls it when it appears and takes focus if it returns true:
 * once per navigation after the first, so keyboard and screen-reader users land on the new page,
 * not on the link they pressed. (The first page load does not steal focus.)
 */
export const FocusRequestContext = createContext<(() => boolean) | undefined>(undefined)

interface Props {
  /** The page's one `h1`. Also the page title. */
  title: string
  description?: ReactNode
  /** Buttons for the page's main actions, aligned to the right (below the title on a phone). */
  actions?: ReactNode
}

/** The top of every screen: its single `h1`, an optional description and actions. */
export function PageHeader({ title, description, actions }: Props) {
  usePageTitle(title)
  const request = useContext(FocusRequestContext)
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (request?.()) {
      heading.current?.focus()
    }
  }, [request])

  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={2}
      sx={{ alignItems: { sm: 'flex-start' }, justifyContent: 'space-between', mb: 3 }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography component="h1" variant="h4" tabIndex={-1} ref={heading} sx={{ outline: 'none', overflowWrap: 'anywhere' }}>
          {title}
        </Typography>
        {description ? (
          // Text is a paragraph. Anything else (a chip, a row of them) may hold a `<div>`, which a
          // `<p>` cannot contain, so it gets a `<div>` instead.
          <Typography component={typeof description === 'string' ? 'p' : 'div'} color="text.secondary" sx={{ mt: 0.5 }}>
            {description}
          </Typography>
        ) : null}
      </Box>
      {actions ? <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>{actions}</Stack> : null}
    </Stack>
  )
}
