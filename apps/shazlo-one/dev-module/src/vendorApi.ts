export interface AdminMe {
  id: string
  roles: string[]
}

/** What vendor-api answered, with nothing from the request in it (never the token). */
export type AdminMeResult =
  | { kind: 'ok'; admin: AdminMe }
  | { kind: 'unauthorized' }
  | { kind: 'error'; status: number | undefined; message: string }

function isAdminMe(value: unknown): value is AdminMe {
  if (typeof value !== 'object' || value === null) return false
  const body = value as Partial<AdminMe>
  return typeof body.id === 'string' && Array.isArray(body.roles) && body.roles.every((role) => typeof role === 'string')
}

/**
 * `GET /v1/admin/me` with the token the shell exchanged for this module (`aud=vendor-api`). It returns
 * the admin behind the token, which proves the token works end to end. A `401` is its own outcome: the
 * module answers it by asking the shell for a new token.
 */
export async function fetchAdminMe(origin: string, accessToken: string, signal?: AbortSignal): Promise<AdminMeResult> {
  try {
    const response = await fetch(`${origin}/v1/admin/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      // The token is the credential: no cookies, and no referrer.
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal,
    })
    if (response.status === 401) return { kind: 'unauthorized' }
    if (!response.ok) return { kind: 'error', status: response.status, message: `vendor-api answered ${response.status}.` }
    const body: unknown = await response.json()
    if (!isAdminMe(body)) return { kind: 'error', status: response.status, message: 'vendor-api sent an answer this module does not understand.' }
    return { kind: 'ok', admin: { id: body.id, roles: [...body.roles] } }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    return { kind: 'error', status: undefined, message: 'Could not reach vendor-api.' }
  }
}
