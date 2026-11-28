import { Badge, Box, Divider, IconButton, Menu, MenuItem, Typography } from '@mui/material'
import { neutral, shadow, StatusPill } from '@shazlo/ui'
import { Bell } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useReviews } from '../api/queries'
import { paths } from '../app/paths'
import { shellCopy as copy } from '../copy/shell'
import { formatRelative } from '../lib/format'
import { useSession } from '../session/AuthProvider'
import { markNotificationsSeen, notificationsSeenAt } from './memory'

const WEEK = 7 * 24 * 3_600_000

type ReviewItem = NonNullable<ReturnType<typeof useReviews>['data']>['items'][number]

function hrefFor(item: ReviewItem) {
  return item.subject.type === 'product' ? paths.product(item.subject.id) : paths.brand
}

// Bell in the top bar (options board pick): the latest review decisions, newest first.
// The dot is only for what needs the seller: sent-back items they have not seen yet. Approvals
// are listed but never light the bell (calm rules, spec §8). "Seen" lasts for the session (./memory.ts).
export function NotificationsMenu() {
  const navigate = useNavigate()
  const vendorId = useSession().vendor?.id
  const decided = (useReviews(undefined, 20).data?.items ?? []).filter((r) => r.state !== 'waiting' && r.decided_at).slice(0, 6)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [seenAt, setSeenAt] = useState<number | null>(null)
  // Decisions older than a week are never "new"; measured from when the shell mounted.
  const [mountedAt] = useState(() => Date.now())

  const lastSeen = seenAt ?? (vendorId ? notificationsSeenAt(vendorId) : 0)
  const since = Math.max(lastSeen, mountedAt - WEEK)
  const fresh = decided.filter((r) => r.state === 'rejected' && Date.parse(r.decided_at!) > since).length

  const open = (el: HTMLElement) => {
    setAnchor(el)
    const now = Date.now()
    setSeenAt(now)
    if (vendorId) markNotificationsSeen(vendorId, now)
  }
  const go = (to: string) => {
    setAnchor(null)
    void navigate(to)
  }

  return (
    <>
      <IconButton
        aria-label={fresh ? copy.notificationsNeedChanges(fresh) : copy.notifications}
        aria-haspopup="menu"
        aria-expanded={anchor ? 'true' : undefined}
        onClick={(e) => open(e.currentTarget)}
        sx={{ color: neutral.ink }}
      >
        <Badge variant="dot" color="error" invisible={!fresh} overlap="circular">
          <Bell size={20} strokeWidth={1.75} aria-hidden="true" />
        </Badge>
      </IconButton>
      <Menu
        anchorEl={anchor}
        open={anchor !== null}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 340, maxWidth: 'calc(100vw - 32px)', border: `1px solid ${neutral.line}`, boxShadow: shadow.overlay } } }}
      >
        {decided.length === 0 && (
          <Box sx={{ px: 2, py: 1.5 }}>
            <Typography variant="body2" color="textSecondary">
              {copy.noNotifications}
            </Typography>
          </Box>
        )}
        {decided.map((item) => (
          <MenuItem key={item.id} onClick={() => go(hrefFor(item))} sx={{ alignItems: 'flex-start', gap: 1.5, py: 1.25, whiteSpace: 'normal' }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2">{item.state === 'rejected' ? copy.sentBack(item.subject.title) : copy.approved(item.subject.title)}</Typography>
              <Typography variant="caption" color="textSecondary">
                {formatRelative(item.decided_at!)}
              </Typography>
            </Box>
            <StatusPill status={item.state === 'rejected' ? 'sentBack' : 'live'} />
          </MenuItem>
        ))}
        <Divider />
        <MenuItem onClick={() => go(paths.review)}>
          <Typography variant="body2" color="info.main">
            {copy.seeAllDecisions}
          </Typography>
        </MenuItem>
      </Menu>
    </>
  )
}
