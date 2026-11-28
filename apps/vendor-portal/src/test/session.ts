import { getApiClient } from '../api/instance'
import { registerSessionHooks } from '../api/session'
import { DEMO_LOGIN } from '../mocks/db'
import type { SessionStore } from '../session/store'
import { createVendorSessionStore } from '../session/vendorSession'

/**
 * Signs a demo user in against the mock API through the session's own public API: the real
 * session store (access token in memory, refresh from the emulated cookie), registered with the
 * client as the app's AuthProvider does. Close the store at the end of the test.
 */
export async function signInDemoUser(credentials: { email: string; password: string } = DEMO_LOGIN, onCleared: () => void = () => {}): Promise<SessionStore> {
  const store = createVendorSessionStore(onCleared)
  registerSessionHooks({
    getAccessToken: store.getAccessToken,
    onUnauthorized: store.renew,
    onApiError: (error) => {
      if (error.code === 'vendor_not_allowed') store.markBlocked()
    },
  })
  // The login sets the (emulated) refresh cookie; starting the store restores the session from it,
  // as the app does after a page load. A started store also renews and ends the session itself.
  await getApiClient().POST('/v1/auth/login', { body: credentials })
  await store.start()
  if (store.getSnapshot().status !== 'signedIn') throw new Error(`The demo user could not sign in (${store.getSnapshot().status}).`)
  return store
}
