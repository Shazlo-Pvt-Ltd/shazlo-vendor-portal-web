import { Box, Link } from '@mui/material'
import { brand, emphasis, neutral, radius } from '@shazlo/ui'
import { useEffect, useRef } from 'react'
import { Link as RouterLink, useLocation } from 'react-router'
import { currentLink, type ResolvedModule } from '../app/registry'
import { shellCopy as copy } from '../copy/shell'
import { MODULE_NAV } from './metrics'

// The shell's focus ring on light chrome, drawn inside the link so the scroller never clips it.
const focusRing = { outline: `2px solid ${brand.navy}`, outlineOffset: -2 } as const

// The open module's pages as a row in the top bar, under the crumbs: the same pages the sidebar
// nests under the module, one click away. Both mark the current page with currentLink; on the
// module's home page none is current. A link only changes the shell URL, and ModuleHost turns that
// into a `navigate` message, so the module moves without reloading.
export function ModuleNav({ module, phone }: { module: ResolvedModule; phone: boolean }) {
  const { pathname } = useLocation()
  const current = currentLink(module, pathname)
  const row = useRef<HTMLElement>(null)

  // On a narrow phone the row is wider than the screen and scrolls inside itself; the current page
  // is scrolled into view when the row appears and whenever it changes.
  const currentPath = current?.path
  useEffect(() => {
    if (!currentPath) return
    row.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [currentPath])

  return (
    <Box
      component="nav"
      ref={row}
      aria-label={copy.moduleNav(module.title)}
      sx={{
        height: MODULE_NAV,
        // Lined up with the crumbs: the links' own padding makes up the rest of the gutter. Below
        // 600 px the links are tighter (8 px, no gap between them), so all three fit at 360 px.
        px: phone ? { xs: 1, sm: 1.5 } : 3.5,
        borderBottom: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
        overflowX: 'auto',
        overflowY: 'hidden',
        overscrollBehaviorX: 'contain',
        scrollbarWidth: 'none',
        '&::-webkit-scrollbar': { display: 'none' },
      }}
    >
      <Box component="ul" sx={{ display: 'flex', gap: phone ? { xs: 0, sm: 0.5 } : 0.5, width: 'max-content', height: '100%', m: 0, p: 0, listStyle: 'none' }}>
        {module.links.map((l) => {
          const active = l === current
          const Icon = l.icon
          return (
            <Box component="li" key={l.path} sx={{ display: 'flex' }}>
              <Link
                component={RouterLink}
                to={module.basePath + l.path}
                underline="none"
                variant="body1"
                aria-current={active ? 'page' : undefined}
                sx={{
                  position: 'relative',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: phone ? { xs: 0.5, sm: 1 } : 1,
                  // Touch screens get at least 44 px; the row itself is 48 px with its rule.
                  minHeight: phone ? 44 : 40,
                  px: phone ? { xs: 1, sm: 1.5 } : 1.5,
                  whiteSpace: 'nowrap',
                  color: active ? neutral.ink : 'text.secondary',
                  ...(active ? emphasis.semibold : {}),
                  borderRadius: `${radius.control}px ${radius.control}px 0 0`,
                  transition: 'background-color 120ms, color 120ms, box-shadow 120ms',
                  '@media (hover: hover)': {
                    '&:hover': { bgcolor: 'action.hover', color: neutral.ink, ...(active ? {} : { boxShadow: `inset 0 -2px 0 ${neutral.lineStrong}` }) },
                  },
                  '&:focus-visible': focusRing,
                }}
              >
                <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
                {l.label}
                {/* The current page's indicator: a brown bar under it, as under the module's own tabs. */}
                {active && <Box component="span" data-indicator aria-hidden="true" sx={{ position: 'absolute', left: 8, right: 8, bottom: 0, height: 3, borderRadius: '3px 3px 0 0', bgcolor: brand.brown }} />}
              </Link>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
