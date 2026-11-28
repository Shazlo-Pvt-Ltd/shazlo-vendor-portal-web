import { Box, Card, Skeleton, Stack, Typography } from '@mui/material'
import { PageHeader } from '@shazlo/ui'
import { HelpCircle, KeyRound, LogOut, Users } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { useMe } from '../../api/queries'
import { paths } from '../../app/paths'
import { hubsCopy } from '../../copy/hubs'
import { useSession } from '../../session/AuthProvider'
import { useSignOut } from '../../session/useSignOut'
import { HubList, type HubRow } from './HubList'

const copy = hubsCopy.account

function Person() {
  const me = useMe()
  if (me.isPending) return <Skeleton variant="text" width={220} sx={{ display: 'inline-block', maxWidth: '100%' }} />
  if (!me.data) return null
  return (
    <Box component="span" sx={{ overflowWrap: 'anywhere' }}>
      {copy.person(me.data.user.name, me.data.role === 'vendor_staff' ? copy.staff : copy.owner)}
    </Box>
  )
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography component="dt" variant="body2" color="textSecondary">
        {label}
      </Typography>
      <Typography component="dd" variant="body1" sx={{ m: 0, mt: 0.25, overflowWrap: 'anywhere' }}>
        {children}
      </Typography>
    </Box>
  )
}

// Who is signed in (useMe). While it loads, or if it fails, the session already knows the same
// three facts, so the card never stays empty.
function Profile() {
  const me = useMe()
  const session = useSession()
  const titleId = useId()
  const owner = me.data ? me.data.role === 'vendor_owner' : session.role === 'owner'
  const email = me.data?.user.email ?? session.user?.email
  const store = me.data?.vendor.brand_name ?? session.vendor?.name
  const p = copy.profile
  const value = (text: string | undefined) => text || <Skeleton variant="text" width={160} sx={{ maxWidth: '100%' }} />
  return (
    <Card component="section" aria-labelledby={titleId} sx={{ px: { xs: 2, sm: 2.5 }, py: 2.5, mb: 3 }}>
      <Typography id={titleId} variant="h2" component="h2" sx={{ mb: 2 }}>
        {p.title}
      </Typography>
      <Stack component="dl" spacing={2} sx={{ m: 0 }}>
        <Detail label={p.email}>{value(email)}</Detail>
        <Detail label={p.role}>{owner ? p.ownerNote : copy.staff}</Detail>
        <Detail label={p.store}>{value(store)}</Detail>
      </Stack>
    </Card>
  )
}

// The phone Account tab (spec §3): who is signed in, then Team (owners only), password, Help &
// support, Sign out. Works at every width.
export default function AccountHub() {
  const { role } = useSession()
  const signOut = useSignOut()
  const rows: HubRow[] = [
    ...(role === 'owner' ? [{ key: 'team', title: copy.team.title, body: copy.team.body, icon: Users, to: paths.team }] : []),
    { key: 'password', title: copy.password.title, body: copy.password.body, icon: KeyRound, to: paths.accountPassword },
    { key: 'help', title: copy.help.title, body: copy.help.body, icon: HelpCircle, to: paths.help },
    { key: 'sign-out', title: copy.signOut, icon: LogOut, onClick: () => void signOut() },
  ]
  return (
    <>
      <PageHeader title={copy.title} subtitle={<Person />} />
      <Profile />
      <HubList label={copy.listLabel} rows={rows} />
    </>
  )
}
