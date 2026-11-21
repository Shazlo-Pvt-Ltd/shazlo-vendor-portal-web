import { Skeleton } from '@mui/material'
import { PageHeader } from '@shazlo/ui'
import { HelpCircle, KeyRound, LogOut, Users } from 'lucide-react'
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
  return copy.person(me.data.user.name, me.data.role === 'vendor_staff' ? copy.staff : copy.owner)
}

// The phone Account tab (spec §3): Team (owners only), password, Help & support, Sign out. Works at every width.
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
      <HubList label={copy.listLabel} rows={rows} />
    </>
  )
}
