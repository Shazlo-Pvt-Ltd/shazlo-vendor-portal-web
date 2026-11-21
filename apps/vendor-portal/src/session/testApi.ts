import { getResponse, http, HttpResponse, type RequestHandler } from 'msw'
import { vi } from 'vitest'
import { resetApiClient } from '../api/instance'
import type { SessionStore } from './store'
import { makeStore, sessionBody } from './testing'

/*
 * Light test helpers for the session and the frame: a fake API and a fake window width. They
 * import nothing of the app's screens (see ./renderPortal.tsx for rendering the whole app).
 */

/** The API origin the helpers configure (VITE_VENDOR_API_URL). */
export const TEST_API = 'https://api.test'

/** The three navigation widths of the shell (src/shell/layout.ts), as typical devices. */
export const WIDTHS = { phone: 390, tablet: 768, desktop: 1280 } as const

/** Pretends the window is `width` px wide, for MUI's useMediaQuery (jsdom has no layout). */
export function setTestViewport(width: number): void {
  vi.stubGlobal('matchMedia', (query: string) => {
    const min = /min-width:\s*([\d.]+)px/.exec(query)
    const max = /max-width:\s*([\d.]+)px/.exec(query)
    const matches = (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]))
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }
  })
}

/** An answer in vendor-api's error shape. */
export const apiErrorBody = (status: number, code: string, message = code) =>
  HttpResponse.json({ error: { code, message, request_id: 'req-test' } }, { status })

/**
 * Points the API client at {@link TEST_API} and answers its calls with `handlers` (MSW handlers,
 * resolved in a stubbed `fetch`, so no mock server elsewhere in the run sees them). Anything else
 * gets a 404, so a screen shows its error state instead of waiting. Returns every request made.
 */
export function stubApi(handlers: RequestHandler[] = []): Request[] {
  vi.stubEnv('VITE_VENDOR_API_URL', TEST_API)
  resetApiClient()
  const requests: Request[] = []
  const fallback = http.all('*', () => apiErrorBody(404, 'not_found', 'Not answered in this test.'))
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    requests.push(request.clone())
    const response = await getResponse([...handlers, fallback], request)
    // A network failure (HttpResponse.error()) makes fetch reject, as in a browser.
    if (!response || response.type === 'error') throw new TypeError('Failed to fetch')
    return response
  })
  return requests
}

/** A session store that restores a signed-in user without calling the API. */
export function signedInStore(options: Parameters<typeof sessionBody>[0] = {}): SessionStore {
  return makeStore({ refresh: async () => sessionBody(options) }).store
}
