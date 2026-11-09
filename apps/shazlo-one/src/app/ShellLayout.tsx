import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router'
import Popover from '@mui/material/Popover'
import useMediaQuery from '@mui/material/useMediaQuery'
import {
  AppFrame, Avatar, Button, Icon, IconButton, kit, Logo, MainColumn, NavGroup, NavItem, ProductTag, Sidebar, Text, TopBar as TopBarBox,
} from '@shazlo/ui/components'
import { useQuery } from '@tanstack/react-query'
import { shellApi } from '../api/mock'
import { canUse, modules } from './registry'
import { useSession } from './session'
import { TopBarMounts, TopBarProvider } from './topbar'

export const ENVIRONMENT = (import.meta.env.VITE_SHAZLO_ENV as string | undefined) ?? 'staging'

/** Navy shell from A-02 / A-03 / A-11: workspace nav, modules filtered by role, account footer, env tag. */
export function ShellLayout() {
  const { session, signOut, hasRole } = useSession()
  const { pathname } = useLocation()
  const compact = useMediaQuery('(max-width: 899.95px)')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [bellAnchor, setBellAnchor] = useState<HTMLElement | null>(null)
  const summary = useQuery({ queryKey: ['vendor-summary'], queryFn: shellApi.vendorSummary, enabled: Boolean(session) })

  // Close the phone drawer after navigating.
  useEffect(() => { setDrawerOpen(false) }, [pathname])

  if (!session) return null
  const roles = session.admin.roles
  const visible = modules.filter(m => canUse(roles, m))
  const failed = summary.data?.publishing.failed ?? 0
  const canSeeVendors = visible.some(m => m.id === 'vendor-admin')

  const nav = (
    <Sidebar tone="dark" width={232} aria-label="Shazlo One" id="shell-nav" className="shz-one-nav" data-open={drawerOpen || undefined}>
      <div style={{ padding: '0 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Logo tag="ONE" tone="inverse" />
        {compact && <IconButton tone="dark" aria-label="Close menu" onClick={() => setDrawerOpen(false)}><Icon name="x" size={18} /></IconButton>}
      </div>
      <NavGroup label="Workspace">
        <NavItem tone="dark" to="/" icon="home" label="Home" active={pathname === '/'} />
      </NavGroup>
      {visible.length > 0 && (
        <NavGroup label="Modules">
          {visible.map(m => (
            <NavItem key={m.id} tone="dark" to={m.basePath} icon={m.icon} label={m.title} count={m.id === 'vendor-admin' ? summary.data?.waiting : undefined} active={pathname.startsWith(m.basePath)} />
          ))}
        </NavGroup>
      )}
      {hasRole('super_admin') && (
        <NavGroup label="Administration">
          <NavItem tone="dark" to="/admins" icon="shield" label="Admins & roles" active={pathname.startsWith('/admins')} />
        </NavGroup>
      )}
      <div style={{ flex: 1 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 8px 0' }}>
        <Avatar initials={session.admin.initials} />
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
          <Text v="label" tone="inverse" truncate>{session.admin.name}</Text>
          <Text v="mono" tone="subtle" truncate title={roles.join(' · ')}>{roles.join(' · ')}</Text>
        </span>
        <IconButton tone="dark" aria-label="Sign out" title="Sign out" onClick={() => void signOut()}><Icon name="logout" size={16} /></IconButton>
      </div>
    </Sidebar>
  )

  return (
    <TopBarProvider>
      <style>{css}</style>
      <a href="#main" className="shz-skip">Skip to content</a>
      <AppFrame style={{ gap: 0 }}>
        {nav}
        {compact && drawerOpen && <div className="shz-one-scrim" aria-hidden onClick={() => setDrawerOpen(false)} />}
        <MainColumn>
          <TopBarBox className="shz-one-topbar">
            {compact && (
              <IconButton aria-label="Open menu" aria-controls="shell-nav" aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)} style={{ margin: '0 4px 0 -6px' }}>
                <Icon name="menu" size={20} />
              </IconButton>
            )}
            <TopBarMounts
              trailing={
                <>
                  <ProductTag>{ENVIRONMENT.toUpperCase()}</ProductTag>
                  <IconButton aria-label="Help" title="Help" onClick={() => window.open('mailto:platform@shazlo.store')}><Icon name="help" size={18} /></IconButton>
                  <IconButton aria-label="Notifications" title="Notifications" aria-haspopup="dialog" onClick={e => setBellAnchor(e.currentTarget)}><Icon name="bell" size={18} /></IconButton>
                </>
              }
            />
          </TopBarBox>
          <div id="main" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <Outlet />
          </div>
        </MainColumn>
      </AppFrame>
      <Popover
        open={Boolean(bellAnchor)}
        anchorEl={bellAnchor}
        onClose={() => setBellAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { mt: 1, width: 300, maxWidth: 'calc(100vw - 32px)', background: kit.surface, border: `1px solid ${kit.line}`, borderRadius: '8px', boxShadow: '0 12px 32px rgba(23, 18, 14, 0.14)' } } }}
      >
        <div role="dialog" aria-label="Notifications" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16 }}>
          <Text v="label" as="h2">Notifications</Text>
          {canSeeVendors && failed > 0 ? (
            <>
              <Text v="small" tone="muted" as="p">
                {failed === 1 ? 'One publishing event is out of retries and needs a look.' : `${failed} publishing events are out of retries and need a look.`}
              </Text>
              <Button size="sm" icon="activity" to="/vendors/publishing" onClick={() => setBellAnchor(null)} style={{ alignSelf: 'flex-start' }}>Open publishing status</Button>
            </>
          ) : (
            <Text v="small" tone="muted" as="p">Nothing needs your attention right now.</Text>
          )}
        </div>
      </Popover>
    </TopBarProvider>
  )
}

// Below 900 px the navy nav becomes an off-canvas drawer opened from the top bar.
const css = `
@media (max-width: 899.95px) {
  .shz-one-nav { position: fixed !important; left: 0; top: 0; z-index: 40; transform: translateX(-100%); visibility: hidden; transition: transform 200ms ease-out, visibility 0s linear 200ms; box-shadow: 0 0 32px rgba(23, 18, 14, 0.3); }
  .shz-one-nav[data-open] { transform: none; visibility: visible; transition: transform 200ms ease-out; }
  .shz-one-topbar { padding: 0 16px !important; justify-content: flex-start !important; }
  .shz-one-topbar > div:last-child { margin-left: auto; }
}
.shz-one-scrim { position: fixed; inset: 0; background: rgba(23, 18, 14, 0.45); z-index: 30; }
`
