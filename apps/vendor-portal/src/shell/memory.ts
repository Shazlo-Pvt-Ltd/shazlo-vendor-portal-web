import { registerSensitiveReset } from '../security/sensitiveState'

/*
 * Small things the shell remembers between pages: a closed setup banner, when the bell was last
 * opened. They live in memory for this tab (the portal keeps nothing in web storage) and are
 * forgotten when the session ends, so the next person on this device starts fresh.
 */
const dismissedSetup = new Set<string>()
const seenNotifications = new Map<string, number>()

registerSensitiveReset(() => {
  dismissedSetup.clear()
  seenNotifications.clear()
})

export function isSetupDismissed(vendorId: string): boolean {
  return dismissedSetup.has(vendorId)
}

export function dismissSetup(vendorId: string): void {
  dismissedSetup.add(vendorId)
}

/** When this store's notifications were last opened, in milliseconds; 0 if never in this tab. */
export function notificationsSeenAt(vendorId: string): number {
  return seenNotifications.get(vendorId) ?? 0
}

export function markNotificationsSeen(vendorId: string, at: number = Date.now()): void {
  seenNotifications.set(vendorId, at)
}
