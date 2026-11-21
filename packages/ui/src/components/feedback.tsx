import { Box, IconButton, Snackbar, Stack, Typography } from '@mui/material'
import { AlertTriangle, CheckCircle2, Info, X, type LucideIcon } from 'lucide-react'
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { brand, neutral, radius, status, statusBackground } from '../tokens'
import { EmptyIllustration, type IllustrationName } from './illustrations'

type Tone = 'info' | 'success' | 'warning' | 'error'

const tones: Record<Tone, { icon: LucideIcon; fg: string; bg: string }> = {
  info: { icon: Info, fg: status.info, bg: statusBackground.info },
  success: { icon: CheckCircle2, fg: status.success, bg: statusBackground.success },
  warning: { icon: AlertTriangle, fg: status.warning, bg: statusBackground.warning },
  error: { icon: AlertTriangle, fg: status.error, bg: statusBackground.error },
}

// Review outcomes and page-level notices. A tinted fill and an icon; no side stripe.
export function Banner({ tone, title, children, action, onClose, label }: { tone: Tone; title: ReactNode; children?: ReactNode; action?: ReactNode; onClose?: () => void; label?: string }) {
  const { icon: Icon, fg, bg } = tones[tone]
  return (
    <Box
      role={tone === 'warning' || tone === 'error' ? 'alert' : 'status'}
      aria-label={label}
      sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', bgcolor: bg, borderRadius: `${radius.card}px`, px: { xs: 2, sm: 2.5 }, py: 1.75, color: neutral.ink }}
    >
      <Box component="span" sx={{ color: fg, display: 'flex', pt: '2px', flexShrink: 0 }}>
        <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body1" component="div">
          {title}
        </Typography>
        {children && (
          <Typography variant="body2" component="div" color="text.secondary" sx={{ mt: 0.25 }}>
            {children}
          </Typography>
        )}
      </Box>
      {action && <Box sx={{ flexShrink: 0, alignSelf: 'center' }}>{action}</Box>}
      {onClose && (
        <IconButton aria-label="Dismiss" size="small" onClick={onClose} sx={{ mt: -0.5, mr: -1, color: neutral.inkSecondary }}>
          <X size={16} aria-hidden="true" />
        </IconButton>
      )}
    </Box>
  )
}

// Says what will appear here and how to add the first one. Schoolbell only for the tip.
export function EmptyState({ illustration, title, body, tip, action }: { illustration?: IllustrationName; title: string; body?: ReactNode; tip?: string; action?: ReactNode }) {
  return (
    <Stack spacing={1.5} sx={{ alignItems: 'center', textAlign: 'center', py: { xs: 5, sm: 7 }, px: 2 }}>
      {tip && (
        <Typography variant="informal" sx={{ color: brand.brown, transform: 'rotate(-2deg)' }}>
          {tip}
        </Typography>
      )}
      {illustration && <EmptyIllustration name={illustration} />}
      <Typography variant="h2" component="h2">
        {title}
      </Typography>
      {body && (
        <Typography variant="body1" color="text.secondary" sx={{ maxWidth: '46ch' }}>
          {body}
        </Typography>
      )}
      {action && <Box sx={{ pt: 1 }}>{action}</Box>}
    </Stack>
  )
}

type Notify = (message: string) => void
const SnackbarContext = createContext<Notify | null>(null)

// Small confirmations ("Draft saved"). Review outcomes use a Banner instead.
export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<{ text: string; key: number } | null>(null)
  const notify = useCallback<Notify>((text) => setMessage({ text, key: Date.now() }), [])
  return (
    <SnackbarContext.Provider value={notify}>
      {children}
      <Snackbar
        key={message?.key}
        open={message !== null}
        onClose={(_, reason) => reason !== 'clickaway' && setMessage(null)}
        autoHideDuration={4000}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        message={message?.text}
        slotProps={{
          content: { role: 'status', sx: { bgcolor: neutral.ink, color: brand.offWhite, borderRadius: `${radius.control}px`, typography: 'body2' } },
        }}
        sx={{ bottom: { xs: 'calc(80px + env(safe-area-inset-bottom, 0px))', md: 24 } }}
      />
    </SnackbarContext.Provider>
  )
}

export function useSnackbar(): Notify {
  const notify = useContext(SnackbarContext)
  if (!notify) throw new Error('useSnackbar needs a SnackbarProvider above it')
  return notify
}
