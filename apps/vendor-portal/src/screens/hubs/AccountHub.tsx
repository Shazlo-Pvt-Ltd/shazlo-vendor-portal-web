import { Skeleton } from '@mui/material'
import { PageHeader } from '@shazlo/ui'
import { HelpCircle, LogOut, Users } from 'lucide-react'
import { useNavigate } from 'react-router'
import { useMe } from '../../api/queries'
import { paths } from '../../app/paths'
import { useSession } from '../../auth/session'
import { hubsCopy } from '../../copy/hubs'
import { HubList } from './HubList'

const copy = hubsCopy.account

function Person() {
  const me = useMe()
  if (me.isPending) return <Skeleton variant="text" width={220} sx={{ display: 'inline-block', maxWidth: '100%' }} />
  if (!me.data) return null
  return copy.person(me.data.user.name, me.data.role === 'vendor_staff' ? copy.staff : copy.owner)
}

// The phone Account tab (spec §3): Team, Help & support, Sign out. Works at every width.
export default function AccountHub() {
  const { signOut } = useSession()
  const navigate = useNavigate()
  return (
    <>
      <PageHeader title={copy.title} subtitle={<Person />} />
      <HubList
        label={copy.listLabel}
        rows={[
          { key: 'team', title: copy.team.title, body: copy.team.body, icon: Users, to: paths.team },
          { key: 'help', title: copy.help.title, body: copy.help.body, icon: HelpCircle, to: paths.help },
          { key: 'sign-out', title: copy.signOut, icon: LogOut, onClick: () => void signOut().then(() => navigate(paths.signIn, { replace: true })) },
        ]}
      />
    </>
  )
}
