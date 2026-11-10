import GlobalStyles from '@mui/material/GlobalStyles'
import { styled } from '@mui/material/styles'
import { Outlet } from 'react-router'
import { Card, EmptyState, kit, Skeleton, Text } from '@shazlo/ui/components'
import { PHONE } from '../screens/shared/ui'
import { ShellConnection, useShell } from './shell'

/** A-04 page padding inside the iframe: 24 / 28 / 28 / 28, and 16 px on phones. */
const Main = styled('main')({
  minHeight: '100dvh',
  background: kit.canvas,
  padding: '24px 28px 28px',
  display: 'flex',
  flexDirection: 'column',
  gap: 18,
  [PHONE]: { padding: '16px 16px 24px', gap: 16 },
})

/**
 * Phone touch targets (44 px). `button[class]` outranks the kit's single-class min-heights; kit
 * buttons rendered as links opt in with `shz-btn`. Tabs keep their underline at the bottom.
 */
const phoneTouch = (
  <GlobalStyles
    styles={{
      [PHONE]: {
        'button[class], a.shz-btn': { minHeight: 44 },
        'button[class]': { minWidth: 44 },
        '[role="tab"][class]': { justifyContent: 'flex-end' },
        'label:has(> input[type="checkbox"]), label:has(> input[type="radio"])': { minHeight: 44 },
        summary: { padding: '13px 0' },
      },
    }}
  />
)

function Gate() {
  const { status } = useShell()
  if (status === 'connecting') {
    return (
      <div role="status" aria-label="Connecting to Shazlo One" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Skeleton width={220} height={30} style={{ maxWidth: '100%' }} />
        <Skeleton width={360} style={{ maxWidth: '100%' }} />
        <div style={{ display: 'flex', gap: 16 }}>{[0, 1, 2, 3].map(i => <Skeleton key={i} height={96} radius={8} />)}</div>
        <Skeleton height={320} radius={8} />
      </div>
    )
  }
  if (status === 'ended' || status === 'unsupported') {
    return (
      <Card pad={0} style={{ maxWidth: 560, width: '100%', margin: 'clamp(16px, 8vh, 80px) auto' }}>
        <EmptyState icon="lock" title={status === 'ended' ? 'Open this from Shazlo One' : 'Shazlo One needs an update'}>
          {status === 'ended'
            ? 'The vendor admin module only works inside Shazlo One, which signs you in. Go to one.shazlo.store and open Vendors.'
            : 'This module and the shell speak different protocol versions. Reload Shazlo One; if it keeps happening, tell the platform team.'}
        </EmptyState>
      </Card>
    )
  }
  return (
    <>
      {status === 'standalone' && (
        <div style={{ background: kit.chip, border: `1px solid ${kit.line}`, borderRadius: 6, padding: '8px 12px' }}>
          <Text v="caption" tone="muted">Development preview outside Shazlo One, signed in as a sample vendor_reviewer. In production this module only accepts a session from the shell.</Text>
        </div>
      )}
      <Outlet />
    </>
  )
}

/** Everything inside the iframe: the module's own page padding. */
export function ModuleFrame() {
  return (
    <ShellConnection>
      {phoneTouch}
      <Main id="main">
        <Gate />
      </Main>
    </ShellConnection>
  )
}
