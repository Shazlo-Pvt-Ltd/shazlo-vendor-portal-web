import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { makeStore, sessionBody } from '../../session/testing'
import { BASE, apiErrorResponse, useApiServer } from '../../test/msw'
import { renderRoute } from '../../test/renderRoute'
import { typeFast } from '../../test/typeFast'
import { setViewport } from '../../test/viewport'
import type { BrandDraft, BrandVersion } from './rules'

// The uploader has its own tests; here it only has to hand back an uploaded image.
vi.mock('../uploads/ImageUploader', () => ({
  ImageUploader: ({ label, onUploaded }: { label: string; onUploaded: (asset: unknown, file: File) => void }) => (
    <button
      type="button"
      onClick={() => onUploaded({ id: `asset-${label}`, url: `https://img.example/${label}.png`, status: 'ready' }, new File([], 'x.png'))}
    >
      Upload {label}
    </button>
  ),
}))

const server = useApiServer()
const DRAFT = `${BASE}/v1/vendor/brand-profile`

const draft = (overrides: Partial<BrandDraft> = {}): BrandDraft =>
  ({
    id: 'profile-1',
    version: 2,
    state: 'draft',
    brand_name: 'Atelier Rao',
    tagline: 'Block prints',
    about: 'A small studio in Jaipur.',
    logo_asset_id: null,
    logo_url: null,
    banner_asset_id: null,
    banner_url: null,
    website_url: 'https://atelier.example',
    instagram_handle: 'atelier.rao',
    categories: ['kurtas'],
    price_min_paise: 99900,
    price_max_paise: 999900,
    submitted_at: null,
    published_at: null,
    review: null,
    in_review_version: null,
    updated_at: '2026-11-10T09:30:00Z',
    ...overrides,
  }) as BrandDraft

const published = (overrides: Partial<BrandVersion> = {}): BrandVersion =>
  ({ ...draft(), id: 'profile-0', version: 1, state: 'published', brand_name: 'Live Atelier', published_at: '2026-11-05T09:30:00Z', ...overrides }) as BrandVersion

const submission = (overrides: Record<string, unknown> = {}) => ({
  subject: 'brand_profile',
  id: 'profile-1',
  sku: null,
  title: null,
  version: 1,
  status: 'approved',
  reason: null,
  submitted_at: '2026-11-09T09:30:00Z',
  decided_at: '2026-11-10T09:30:00Z',
  ...overrides,
})

interface Setup {
  draft?: BrandDraft
  published?: BrandVersion | null
  latest?: Record<string, unknown> | null
}

function serve({ draft: d = draft(), published: p = null, latest = null }: Setup = {}) {
  const puts: Record<string, unknown>[] = []
  const posts: string[] = []
  server.use(
    http.get(DRAFT, () => HttpResponse.json(d)),
    http.get(`${DRAFT}/published`, () => (p ? HttpResponse.json(p) : apiErrorResponse(404, 'no_published_profile'))),
    http.get(`${BASE}/v1/vendor/submissions`, () => HttpResponse.json({ items: latest ? [latest] : [], total: latest ? 1 : 0, limit: 1, offset: 0 })),
    http.put(DRAFT, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      puts.push(body)
      return HttpResponse.json({ ...d, brand_name: String(body.brand_name).trim(), price_min_paise: body.price_min_paise, price_max_paise: body.price_max_paise, logo_asset_id: body.logo_asset_id, logo_url: null })
    }),
    http.post(`${DRAFT}/submit`, () => {
      posts.push('submit')
      return HttpResponse.json(published({ id: 'profile-1', state: 'pending_review' }))
    }),
  )
  return { puts, posts }
}

async function open(setup: Setup = {}) {
  setViewport(1280)
  const calls = serve(setup)
  const store = makeStore({ refresh: async () => sessionBody() }).store
  const router = renderRoute('/brand', { store })
  await screen.findByRole('heading', { level: 1, name: 'Brand page' }, { timeout: 15_000 })
  await screen.findByLabelText(/Brand name/)
  return { ...calls, router, user: userEvent.setup() }
}

const field = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement
// A field inside a disabled <fieldset> is disabled, though its own `disabled` property still says false.
const isDisabled = (element: Element) => element.matches(':disabled')

describe('the brand page editor', () => {
  it('loads the draft into the form, with prices in rupees, and shows it in the preview', async () => {
    await open()
    expect(field(/Brand name/).value).toBe('Atelier Rao')
    expect(field(/Lowest price/).value).toBe('999')
    expect(field(/Highest price/).value).toBe('9999')
    expect(field(/Instagram/).value).toBe('atelier.rao')
    const preview = screen.getByRole('region', { name: 'Live preview' })
    expect(within(preview).getAllByText('Atelier Rao').length).toBeGreaterThan(0)
    expect(within(preview).getAllByText('kurtas').length).toBeGreaterThan(0)
    expect(within(preview).getAllByText(/₹999 – ₹9,999/).length).toBeGreaterThan(0)
  })

  it('updates the preview as the vendor types, at a phone and at a desktop width', async () => {
    const { user } = await open()
    const name = field(/Brand name/)
    await user.clear(name)
    await typeFast(user, name, 'Rao & Sons')
    await user.clear(field(/Tagline/))
    await typeFast(user, field(/Tagline/), 'Cotton, always')
    const preview = screen.getByRole('region', { name: 'Live preview' })
    expect(within(preview).getAllByText('Rao & Sons').length).toBeGreaterThan(0)
    expect(within(preview).getAllByText('Cotton, always').length).toBeGreaterThan(0)
    expect(within(preview).getByTestId('preview-frame').getAttribute('data-width')).toBe('phone')
    await user.click(within(preview).getByRole('button', { name: 'Desktop' }))
    expect(within(preview).getByTestId('preview-frame').getAttribute('data-width')).toBe('desktop')
  })

  it('never renders what the vendor typed as HTML, and only links https addresses', async () => {
    const { user } = await open()
    const name = field(/Brand name/)
    await user.clear(name)
    await typeFast(user, name, '<img src=x onerror=alert(1)><b>bold</b>')
    const preview = screen.getByRole('region', { name: 'Live preview' })
    expect(within(preview).getAllByText('<img src=x onerror=alert(1)><b>bold</b>').length).toBeGreaterThan(0)
    expect(preview.querySelector('b')).toBeNull()
    expect(preview.querySelector('img[src="x"]')).toBeNull()

    const website = field(/Website/)
    await user.clear(website)
    await typeFast(user, website, 'javascript:alert(1)')
    expect(preview.querySelector('a[href^="javascript"]')).toBeNull()
    await user.clear(website)
    await typeFast(user, website, 'https://atelier.example')
    expect(within(preview).getByRole('link', { name: 'Website' }).getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('falls back to an initial when there is no logo, and shows the logo once it is uploaded', async () => {
    const { user } = await open()
    const preview = screen.getByRole('region', { name: 'Live preview' })
    expect(preview.querySelector('img')).toBeNull()
    expect(within(preview).getAllByText('A').length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: 'Upload Brand logo' }))
    expect(preview.querySelector('img')?.getAttribute('src')).toBe('https://img.example/Brand%20logo.png')
  })

  it('shows the instagram handle it will save, for a pasted address', async () => {
    const { user } = await open()
    const instagram = field(/Instagram/)
    await user.clear(instagram)
    await typeFast(user, instagram, 'https://www.instagram.com/atelier.rao/?igsh=1')
    expect(screen.getByText('We will save this as @atelier.rao')).toBeTruthy()
  })
})

describe('saving', () => {
  it('sends the whole draft with exact paise, then reports it saved and is clean again', async () => {
    const { user, puts } = await open()
    const min = field(/Lowest price/)
    await user.clear(min)
    await typeFast(user, min, '99.90')
    const max = field(/Highest price/)
    await user.clear(max)
    await typeFast(user, max, '1,000')
    await user.click(screen.getByRole('button', { name: 'Upload Banner' }))
    expect(screen.getByText('Unsaved changes')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(await screen.findByText('Brand page saved')).toBeTruthy()
    expect(puts).toEqual([
      {
        brand_name: 'Atelier Rao',
        tagline: 'Block prints',
        about: 'A small studio in Jaipur.',
        logo_asset_id: null,
        banner_asset_id: 'asset-Banner',
        website_url: 'https://atelier.example',
        instagram_handle: 'atelier.rao',
        categories: ['kurtas'],
        price_min_paise: 9990,
        price_max_paise: 100000,
      },
    ])
    await waitFor(() => expect(screen.queryByText('Unsaved changes')).toBeNull())
    expect((screen.getByRole('button', { name: 'Save draft' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('does not call the API for a form with a problem, and says what is wrong next to the input', async () => {
    const { user, puts } = await open()
    const name = field(/Brand name/)
    await user.clear(name)
    await user.click(screen.getByRole('button', { name: 'Upload Brand logo' })) // make it dirty so Save is enabled
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(await screen.findByText('Enter your brand name.')).toBeTruthy()
    expect(document.activeElement).toBe(name)
    expect(puts).toHaveLength(0)
  })

  it("shows the server's field errors next to their inputs", async () => {
    const { user } = await open()
    server.use(
      http.put(DRAFT, () =>
        HttpResponse.json(
          { error: { code: 'validation_error', message: 'Invalid', details: [{ loc: ['body', 'website_url'], msg: 'must be an https:// address without spaces', type: 'value_error' }] } },
          { status: 422 },
        ),
      ),
    )
    await user.click(screen.getByRole('button', { name: 'Upload Brand logo' }))
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    const website = field(/Website/)
    await waitFor(() => expect(website.getAttribute('aria-invalid')).toBe('true'))
    expect(screen.getByText('must be an https:// address without spaces')).toBeTruthy()
    expect(screen.queryByText('Brand page saved')).toBeNull()
  })
})

describe('leaving with unsaved changes', () => {
  it('asks first, stays when told to keep editing, and leaves when told to', async () => {
    const { user, router } = await open()
    await typeFast(user, field(/Tagline/), ' more')
    await router.navigate('/products')
    const dialog = await screen.findByRole('dialog', { name: 'Leave without saving?' })
    await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(router.state.location.pathname).toBe('/brand')
    expect(field(/Tagline/).value).toBe('Block prints more')

    await router.navigate('/products')
    await user.click(await screen.findByRole('button', { name: 'Leave and lose changes' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/products'))
  })

  it('does not ask when nothing changed', async () => {
    const { router } = await open()
    await router.navigate('/products')
    await waitFor(() => expect(router.state.location.pathname).toBe('/products'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('warns before the tab is closed, only while there are unsaved changes', async () => {
    const { user } = await open()
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)
    await typeFast(user, field(/Tagline/), '!')
    const dirty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)
  })
})

describe('the states of the page', () => {
  it('is editable when it is a draft, with nothing in review', async () => {
    await open()
    expect(isDisabled(field(/Brand name/))).toBe(false)
    expect(screen.queryByText(/is in review/)).toBeNull()
    expect((screen.getByRole('button', { name: 'Submit for review' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('locks a version in review and says since when; editing a new draft is a deliberate step', async () => {
    const { user } = await open({ draft: draft({ in_review_version: 1 }), latest: submission({ status: 'pending', version: 1, decided_at: null }) })
    expect(screen.getByText(/Version 1 is in review/)).toBeTruthy()
    expect(screen.getByText(/since 9 Nov 2026/)).toBeTruthy()
    expect(isDisabled(field(/Brand name/))).toBe(true)
    expect((screen.getByRole('button', { name: 'Save draft' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Submit for review' }) as HTMLButtonElement).disabled).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Edit a new draft' }))
    expect(isDisabled(field(/Brand name/))).toBe(false)
    expect(screen.getByText(/You are editing a new draft/)).toBeTruthy()
    // Submitting stays off until the decision: the API allows one version in review.
    expect((screen.getByRole('button', { name: 'Submit for review' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows the reason a version was not approved, with a new draft to fix it in', async () => {
    await open({ latest: submission({ status: 'rejected', version: 1, reason: 'The banner is blurry' }) })
    expect(screen.getByText(/Version 1 was not approved/)).toBeTruthy()
    expect(screen.getByText(/The banner is blurry/)).toBeTruthy()
    expect(isDisabled(field(/Brand name/))).toBe(false)
  })

  it('shows nothing published yet, and then the published version with its date', async () => {
    const { user } = await open()
    await user.click(screen.getByRole('tab', { name: 'Published version' }))
    expect(await screen.findByText('Nothing is published yet.')).toBeTruthy()
  })

  it('shows the published version without touching what is being edited', async () => {
    const { user } = await open({ published: published() })
    await typeFast(user, field(/Tagline/), ' edited')
    await user.click(screen.getByRole('tab', { name: 'Published version' }))
    expect(await screen.findByText(/Version 1, published on 5 Nov 2026/)).toBeTruthy()
    const preview = screen.getByRole('region', { name: 'Published version' })
    expect(within(preview).getAllByText('Live Atelier').length).toBeGreaterThan(0)
    await user.click(screen.getByRole('tab', { name: 'Draft' }))
    expect(field(/Tagline/).value).toBe('Block prints edited')
  })

  it('offers to retry when the draft cannot be loaded', async () => {
    setViewport(1280)
    server.use(http.get(DRAFT, () => apiErrorResponse(500, 'server_error')), http.get(`${BASE}/v1/vendor/submissions`, () => HttpResponse.json({ items: [], total: 0, limit: 1, offset: 0 })))
    renderRoute('/brand', { store: makeStore({ refresh: async () => sessionBody() }).store })
    expect(await screen.findByRole('button', { name: 'Try again' }, { timeout: 15_000 })).toBeTruthy()
  })
})

describe('submitting for review', () => {
  it('asks for a category before it asks the API', async () => {
    const { user, posts } = await open({ draft: draft({ categories: [] }) })
    await user.click(screen.getByRole('button', { name: 'Submit for review' }))
    expect(await screen.findByText(/Add at least one category before you submit/)).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(posts).toHaveLength(0)
  })

  it('says what happens next, and sends nothing if the vendor cancels', async () => {
    const { user, posts } = await open()
    await user.click(screen.getByRole('button', { name: 'Submit for review' }))
    const dialog = await screen.findByRole('dialog', { name: 'Submit your brand page for review?' })
    expect(within(dialog).getByText(/Our team will review this version/)).toBeTruthy()
    expect(within(dialog).getByText(/does not change/)).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(posts).toHaveLength(0)
  })

  it('submits after confirming and reports it', async () => {
    const { user, posts } = await open()
    await user.click(screen.getByRole('button', { name: 'Submit for review' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Submit for review' }))
    expect(await screen.findByText('Submitted for review')).toBeTruthy()
    expect(posts).toEqual(['submit'])
  })

  it('saves unsaved changes first, so the reviewed page is the one on screen', async () => {
    const { user, puts, posts } = await open()
    await typeFast(user, field(/Tagline/), ' new')
    await user.click(screen.getByRole('button', { name: 'Submit for review' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Your unsaved changes are saved first/)).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Submit for review' }))
    await screen.findByText('Submitted for review')
    expect(puts).toHaveLength(1)
    expect(posts).toEqual(['submit'])
  })

  it.each([
    ['review_pending', /already waiting for a decision.*keep editing a new draft/],
    ['nothing_to_submit', /nothing new to submit/],
  ])('explains a 409 %s', async (code, message) => {
    const { user } = await open()
    server.use(http.post(`${DRAFT}/submit`, () => apiErrorResponse(409, code)))
    await user.click(screen.getByRole('button', { name: 'Submit for review' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Submit for review' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toMatch(message)
  })
})
