import { useNavigate } from 'react-router'
import { Button, Card, Content, EmptyState, Icon, kit, PageHeader, Text, type IconName } from '@shazlo/ui/components'
import { useSession } from '../../app/session'
import { TopBar } from '../../app/topbar'

/** Sidebar sections that exist in the wireframe nav but have no screen in this release. */
export function ComingSoon({ title }: { title: string }) {
  return (
    <Content>
      <TopBar crumbs={[{ label: title }]} />
      <PageHeader title={title} />
      <Card pad={0}>
        <EmptyState icon="clock" title="Not in this release yet" action={<Button variant="secondary" to="/">Back to overview</Button>}>
          {title} arrives in a later phase. Until then, write to partners@shazlo.store and the partner team will help.
        </EmptyState>
      </Card>
    </Content>
  )
}

export function NotFound() {
  return (
    <Content>
      <TopBar crumbs={[{ label: 'Page not found' }]} />
      <Card pad={0}>
        <EmptyState icon="search" title="We couldn’t find that page" action={<Button variant="primary" to="/">Go to overview</Button>}>
          The link may be old, or the item was archived.
        </EmptyState>
      </Card>
    </Content>
  )
}

/** Mobile "More" tab: the sidebar items that don't fit in the tab bar. */
export function MoreMenu() {
  const { session, signOut } = useSession()
  const navigate = useNavigate()
  const items: Array<{ to: string; icon: IconName; label: string }> = [
    { to: '/products/import', icon: 'sheet', label: 'Bulk import' },
    { to: '/settings', icon: 'sliders', label: 'Store settings' },
    { to: '/team', icon: 'users', label: 'Team' },
    { to: '/help', icon: 'help', label: 'Help & support' },
  ]
  return (
    <Content>
      <Text v="display" as="h1">More</Text>
      <div style={{ background: kit.surface, border: `1px solid ${kit.line}`, borderRadius: 8, overflow: 'hidden' }}>
        {items.map((item, i) => (
          <button
            key={item.to}
            type="button"
            onClick={() => navigate(item.to)}
            style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', minHeight: 52, padding: '0 16px', border: 0, borderTop: i ? `1px solid ${kit.line}` : 0, background: 'transparent', cursor: 'pointer', color: kit.ink }}
          >
            <Icon name={item.icon} size={20} color={kit.muted} />
            <Text v="body" style={{ flex: 1, textAlign: 'left' }}>{item.label}</Text>
            <Icon name="chevronRight" size={16} color={kit.subtle} />
          </button>
        ))}
      </div>
      {session && (
        <Button variant="secondary" icon="logout" fullWidth onClick={async () => { await signOut(); navigate('/sign-in') }}>
          Sign out of {session.user.name.split(' ')[0]}’s account
        </Button>
      )}
    </Content>
  )
}
