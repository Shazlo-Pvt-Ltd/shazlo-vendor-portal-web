import { expect, type APIRequestContext } from '@playwright/test'
import { E2E, TEMPORARY_PASSWORD, uniqueEmail } from './env'

export interface TestAdmin {
  id: string
  email: string
  name: string
  roles: string[]
}

interface Session {
  access_token: string
  must_change_password: boolean
}

let cached: { token: string; until: number } | undefined

/**
 * An identity-api token for the seeded super admin, used only to create and deactivate other admins
 * through the API. A freshly seeded admin must change their password first, so the first call changes
 * it from the seed password to the test one. Kept for 10 minutes (the token lasts 15): every login
 * counts against identity-api's rate limits.
 */
export async function seedAdminToken(request: APIRequestContext): Promise<string> {
  if (cached !== undefined && cached.until > Date.now()) return cached.token
  const login = (password: string) => request.post(`${E2E.identityUrl}/v1/auth/login`, { data: { email: E2E.adminEmail, password } })
  let answer = await login(E2E.adminPassword)
  if (answer.status() === 401) {
    answer = await login(E2E.adminSeedPassword)
    expect(answer.ok(), 'the seeded admin can sign in (seed it with E2E_ADMIN_SEED_PASSWORD)').toBeTruthy()
  }
  expect(answer.ok(), `identity-api login answered ${answer.status()}`).toBeTruthy()
  let session = (await answer.json()) as Session
  if (session.must_change_password) {
    const changed = await request.post(`${E2E.identityUrl}/v1/auth/change-password`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      data: { current_password: E2E.adminSeedPassword, new_password: E2E.adminPassword },
    })
    expect(changed.ok(), `changing the seeded admin's password answered ${changed.status()}`).toBeTruthy()
    session = (await changed.json()) as Session
  }
  cached = { token: session.access_token, until: Date.now() + 10 * 60_000 }
  return session.access_token
}

/**
 * Creates an admin the way a super admin does: with a temporary password they must change at their
 * first sign-in. That makes every test's admin a "freshly set up" one, whatever order the tests run in.
 */
export async function createAdmin(request: APIRequestContext, label: string, roles: string[]): Promise<TestAdmin> {
  const token = await seedAdminToken(request)
  const email = uniqueEmail(label)
  const name = `E2E ${label}`
  const answer = await request.post(`${E2E.identityUrl}/v1/admins`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { email, display_name: name, password: TEMPORARY_PASSWORD, roles },
  })
  expect(answer.status(), `creating ${email} answered ${answer.status()}: ${await answer.text()}`).toBe(201)
  const body = (await answer.json()) as { id: string }
  return { id: body.id, email, name, roles }
}

/** Deactivates an admin as a super admin does: identity-api revokes their sessions at once. */
export async function deactivateAdmin(request: APIRequestContext, admin: TestAdmin): Promise<void> {
  const token = await seedAdminToken(request)
  const answer = await request.patch(`${E2E.identityUrl}/v1/admins/${admin.id}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { is_active: false },
  })
  expect(answer.ok(), `deactivating ${admin.email} answered ${answer.status()}: ${await answer.text()}`).toBeTruthy()
}
