import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearSensitiveState } from '../security/sensitiveState'
import { dismissSetup, isSetupDismissed, markNotificationsSeen, notificationsSeenAt } from './memory'

afterEach(() => clearSensitiveState())

describe('what the shell remembers', () => {
  it('remembers a closed setup banner per store, for this tab only', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    expect(isSetupDismissed('v1')).toBe(false)
    dismissSetup('v1')
    expect(isSetupDismissed('v1')).toBe(true)
    expect(isSetupDismissed('v2')).toBe(false)
    expect(setItem).not.toHaveBeenCalled()
  })

  it('remembers when the bell was last opened, per store', () => {
    expect(notificationsSeenAt('v1')).toBe(0)
    markNotificationsSeen('v1', 1_000)
    expect(notificationsSeenAt('v1')).toBe(1_000)
    expect(notificationsSeenAt('v2')).toBe(0)
  })

  it('forgets everything when the session ends, so the next person starts fresh', () => {
    dismissSetup('v1')
    markNotificationsSeen('v1', 1_000)
    clearSensitiveState()
    expect(isSetupDismissed('v1')).toBe(false)
    expect(notificationsSeenAt('v1')).toBe(0)
  })
})
