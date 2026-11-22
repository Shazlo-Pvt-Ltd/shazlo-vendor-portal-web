import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { makeStore, sessionBody } from '../../session/testing'
import { BASE, apiErrorResponse, useApiServer } from '../../test/msw'
import { renderRoute } from '../../test/renderRoute'
import { typeFast } from '../../test/typeFast'
import { setViewport } from '../../test/viewport'
import type { Revision } from './form'
import type { ProductDetail } from './status'
import { detail, fullRevision } from './testing'

// The uploader has its own tests; here it only has to hand back uploaded images, one per click.
let uploads = 0
vi.mock('../uploads/ImageUploader', () => ({
  ImageUploader: ({ label, onUploaded }: { label: string; onUploaded: (asset: unknown, file: File) => void }) => {
    const upload = () => {
      uploads += 1
      onUploaded({ id: `asset-${uploads}`, url: `https://res.cloudinary.com/demo/${uploads}.jpg`, status: 'ready' }, new File([], 'x.jpg'))
    }
    return (
      <>
        <button type="button" onClick={upload}>
          Upload {label}
        </button>
        <button type="button" onClick={() => [upload(), upload(), upload()]}>
          Upload three at once
        </button>
      </>
    )
  },
}))

const server = useApiServer()
const LIST = `${BASE}/v1/vendor/products`

const image = (n: number, alt: string | null = null) => ({ asset_id: `img-${n}`, url: `https://res.cloudinary.com/demo/img-${n}.jpg`, position: n, alt_text: alt })

const product = (overrides: Partial<ProductDetail> = {}) => detail('p1', { sku: 'KURTA-001', working: fullRevision({ images: [image(1)] }), ...overrides })

interface Calls {
  posts: Record<string, unknown>[]
  puts: Record<string, unknown>[]
  submits: string[]
}

/** A fake product API. `onPut` and `onSubmit` replace the default answers. */
function serve(
  initial: ProductDetail | null,
  options: { onPost?: () => Response; onPut?: () => Response; onSubmit?: () => Response } = {},
): Calls {
  const calls: Calls = { posts: [], puts: [], submits: [] }
  let current = initial
  const fromBody = (body: Record<string, unknown>, base: ProductDetail): ProductDetail => {
    // Like vendor-api, variants come back in SKU order (letter case ignored).
    const variants = (body.variants as Record<string, unknown>[])
      .map((v, i) => ({ id: `v${i}`, sku: '', ...v }))
      .sort((a, b) => String(a.sku).toLowerCase().localeCompare(String(b.sku).toLowerCase())) as Revision['variants']
    const images = (body.images as { asset_id: string; alt_text: string | null }[]).map((img, i) => ({
      ...img,
      url: `https://res.cloudinary.com/demo/${img.asset_id}.jpg`,
      position: i + 1,
    }))
    const working = fullRevision({ ...(body as Partial<Revision>), id: 'r-new', version: (base.live?.version ?? 0) + 1, state: 'editing', variants, images })
    return { ...base, working }
  }
  server.use(
    http.get(LIST, () => HttpResponse.json({ items: [], total: 0, limit: 25, offset: 0 })),
    http.get(`${LIST}/:id`, () => (current ? HttpResponse.json(current) : apiErrorResponse(404, 'product_not_found'))),
    http.post(LIST, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      calls.posts.push(body)
      if (options.onPost) return options.onPost()
      current = fromBody(body, detail('new-1', { sku: String(body.sku) }))
      return HttpResponse.json(current, { status: 201 })
    }),
    http.put(`${LIST}/:id`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      calls.puts.push(body)
      if (options.onPut) return options.onPut()
      current = fromBody(body, current!)
      return HttpResponse.json(current)
    }),
    http.post(`${LIST}/:id/submit`, ({ params }) => {
      calls.submits.push(String(params.id))
      if (options.onSubmit) return options.onSubmit()
      current = {
        ...current!,
        status: current!.live ? current!.status : 'pending_review',
        working: { ...current!.working!, state: 'in_review', submitted_at: '2026-11-18T10:00:00Z' },
      }
      return HttpResponse.json(current)
    }),
  )
  return calls
}

async function open(path: string, initial: ProductDetail | null, options: Parameters<typeof serve>[1] = {}) {
  setViewport(1280)
  const calls = serve(initial, options)
  const store = makeStore({ refresh: async () => sessionBody() }).store
  const router = renderRoute(path, { store })
  await screen.findByRole('heading', { level: 1 }, { timeout: 15_000 })
  await screen.findByLabelText(/^Title/)
  return { ...calls, router, user: userEvent.setup() }
}

const input = (label: RegExp, scope: HTMLElement = document.body) => within(scope).getByLabelText(label) as HTMLInputElement
const variantGroup = (n: number) => screen.getByRole('group', { name: `Variant ${n}` })
const isDisabled = (element: Element) => element.matches(':disabled')

async function fillNewProduct(user: ReturnType<typeof userEvent.setup>) {
  await typeFast(user, input(/^Product SKU/), 'KURTA-001')
  await typeFast(user, input(/^Title/), 'Block-print kurta')
  await typeFast(user, input(/^Category/), 'kurtas')
  await user.click(screen.getByRole('combobox', { name: /^For/ }))
  await user.click(await screen.findByRole('option', { name: 'Women' }))
  const v1 = variantGroup(1)
  await typeFast(user, input(/^SKU/, v1), 'KURTA-001-M')
  await typeFast(user, input(/^Size/, v1), 'M')
  await typeFast(user, input(/^Price/, v1), '1999.99')
}

describe('creating a product', () => {
  it('creates it with exact paise and opens its page', async () => {
    const { user, posts, router } = await open('/products/new', null)
    expect(screen.getByRole('heading', { level: 1, name: 'New product' })).toBeTruthy()
    await fillNewProduct(user)
    await typeFast(user, input(/^MRP/, variantGroup(1)), '2,499.50')
    await user.click(screen.getByRole('button', { name: 'Add a variant' }))
    const v2 = variantGroup(2)
    await waitFor(() => expect(document.activeElement).toBe(input(/^SKU/, v2)))
    await typeFast(user, input(/^SKU/, v2), 'KURTA-001-L')
    await typeFast(user, input(/^Size/, v2), 'L')
    await typeFast(user, input(/^Price/, v2), '0.10')
    await user.click(screen.getByRole('button', { name: 'Upload Add images' }))

    await user.click(screen.getByRole('button', { name: 'Create product' }))
    expect(await screen.findByText('Product created')).toBeTruthy()
    expect(posts).toEqual([
      {
        sku: 'KURTA-001',
        title: 'Block-print kurta',
        description: null,
        category: 'kurtas',
        subcategory: null,
        gender: 'women',
        fabric: null,
        weight_grams: null,
        returnable: false,
        return_window_days: null,
        variants: [
          { sku: 'KURTA-001-M', size: 'M', color: '', price_paise: 199999, mrp_paise: 249950, is_active: true },
          { sku: 'KURTA-001-L', size: 'L', color: '', price_paise: 10, mrp_paise: 10, is_active: true },
        ],
        images: [{ asset_id: `asset-${uploads}`, alt_text: null }],
      },
    ])
    await waitFor(() => expect(router.state.location.pathname).toBe('/products/new-1'))
    // The page now shows the saved product (variants in SKU order); the prices come back exactly as typed.
    await screen.findByRole('heading', { level: 1, name: 'Block-print kurta' })
    expect(input(/^Price/, variantGroup(1)).value).toBe('0.10')
    expect(input(/^Price/, variantGroup(2)).value).toBe('1999.99')
  })

  it('checks the rules before sending anything, and focuses the first problem', async () => {
    const { user, posts } = await open('/products/new', null)
    await fillNewProduct(user)
    await typeFast(user, input(/^MRP/, variantGroup(1)), '1999.98')
    await user.click(screen.getByRole('button', { name: 'Add a variant' }))
    await typeFast(user, input(/^SKU/, variantGroup(2)), 'kurta-001-m')
    await typeFast(user, input(/^Price/, variantGroup(2)), '10')
    await user.click(screen.getByRole('button', { name: 'Create product' }))

    expect(within(variantGroup(1)).getByText('The MRP cannot be below the price.')).toBeTruthy()
    expect(within(variantGroup(2)).getByText(/Another variant of this product has this SKU/)).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(input(/^MRP/, variantGroup(1))))
    expect(posts).toEqual([])
  })

  it('needs an active variant and an image to submit, and says so before asking the API', async () => {
    const { user, posts, submits } = await open('/products/new', null)
    await fillNewProduct(user)
    await user.click(within(variantGroup(1)).getByRole('switch'))
    await user.click(screen.getByRole('button', { name: 'Create and submit for review' }))
    expect(await screen.findByText('To submit, add an active variant and an image.')).toBeTruthy()
    expect(screen.getByText('Add at least one image before you submit.')).toBeTruthy()
    expect(posts).toEqual([])
    expect(submits).toEqual([])
  })

  it('explains a SKU that is already used', async () => {
    const { user } = await open('/products/new', null, { onPost: () => apiErrorResponse(409, 'sku_taken', 'You already use this SKU') })
    await fillNewProduct(user)
    await user.click(screen.getByRole('button', { name: 'Create product' }))
    expect(await screen.findByText(/You already use one of these SKUs on another product/)).toBeTruthy()
  })

  it("puts a 422's field messages next to their fields", async () => {
    const { user } = await open('/products/new', null, {
      onPost: () =>
        HttpResponse.json(
          {
            error: {
              code: 'validation_error',
              message: 'Invalid',
              details: [
                { loc: ['body', 'title'], msg: 'String should have at most 200 characters', type: 'x' },
                { loc: ['body', 'variants', 0, 'price_paise'], msg: 'Input should be less than or equal to 1000000000000', type: 'x' },
              ],
            },
          },
          { status: 422 },
        ),
    })
    await fillNewProduct(user)
    await user.click(screen.getByRole('button', { name: 'Create product' }))
    expect(await screen.findByText('String should have at most 200 characters')).toBeTruthy()
    expect(within(variantGroup(1)).getByText('Input should be less than or equal to 1000000000000')).toBeTruthy()
  })
})

describe('editing a product', () => {
  it('saves the whole revision, with prices that round-trip exactly', async () => {
    const working = fullRevision({
      images: [image(1, 'Front')],
      variants: [
        { id: 'v1', sku: 'A', size: 'S', color: '', price_paise: 10, mrp_paise: 10, is_active: true },
        { id: 'v2', sku: 'B', size: 'M', color: '', price_paise: 199999, mrp_paise: 199999, is_active: true },
      ],
    })
    const { user, puts } = await open('/products/p1', product({ working }))
    expect(input(/^Price/, variantGroup(1)).value).toBe('0.10')
    expect(input(/^Price/, variantGroup(2)).value).toBe('1999.99')
    // Nothing changed: nothing to save.
    expect(isDisabled(screen.getByRole('button', { name: 'Save changes' }))).toBe(true)

    await user.clear(input(/^Title/))
    await typeFast(user, input(/^Title/), 'Renamed kurta')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Product saved')).toBeTruthy()
    expect(puts).toHaveLength(1)
    expect(puts[0]).toMatchObject({
      title: 'Renamed kurta',
      variants: [
        { sku: 'A', price_paise: 10, mrp_paise: 10 },
        { sku: 'B', price_paise: 199999, mrp_paise: 199999 },
      ],
      images: [{ asset_id: 'img-1', alt_text: 'Front' }],
    })
    expect(puts[0]).not.toHaveProperty('sku')
  })

  it('keeps the SKU, size and colour of a saved variant fixed', async () => {
    await open('/products/p1', product())
    const v1 = variantGroup(1)
    expect(input(/^SKU/, v1).readOnly).toBe(true)
    expect(input(/^Size/, v1).readOnly).toBe(true)
    expect(input(/^Colour/, v1).readOnly).toBe(true)
    expect(input(/^Price/, v1).readOnly).toBe(false)
    expect(input(/^Product SKU/).readOnly).toBe(true)
  })

  it('shows the SKU and the status chip under the title, in markup React accepts', async () => {
    const error = vi.spyOn(console, 'error')
    await open('/products/p1', product())
    const header = screen.getByRole('heading', { level: 1 }).parentElement!
    expect(within(header).getByText('SKU KURTA-001')).toBeTruthy()
    expect(header.querySelector('.MuiChip-root')).not.toBeNull()
    expect(header.querySelector('p div, p p')).toBeNull()
    expect(error.mock.calls.flat().join('\n')).not.toMatch(/cannot be a descendant of|cannot contain a nested/)
  })

  it('clears the return window when the product is not returnable', async () => {
    const { user, puts } = await open('/products/p1', product({ working: fullRevision({ images: [image(1)], returnable: true, return_window_days: 7 }) }))
    expect(input(/^Return window/).value).toBe('7')
    await user.click(screen.getByRole('switch', { name: 'Shoppers can return it' }))
    expect(input(/^Return window/).value).toBe('')
    expect(isDisabled(input(/^Return window/))).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await screen.findByText('Product saved')
    expect(puts[0]).toMatchObject({ returnable: false, return_window_days: null })
  })

  it('orders images with the keyboard: the moved image keeps focus, the move is announced, and the order is saved', async () => {
    const { user, puts } = await open('/products/p1', product({ working: fullRevision({ images: [image(1, 'Front'), image(2, 'Back'), image(3, 'Side')] }) }))
    const list = screen.getByRole('list', { name: 'Product images, in order' })
    expect(within(list).getAllByRole('listitem')[0]!.textContent).toContain('Cover')

    const moveUp = screen.getByRole('button', { name: 'Move image 2 up' })
    moveUp.focus()
    await user.keyboard('{Enter}')
    // "Back" is now first, so it is the cover, and its own "Move up" is gone: focus is on its "Move down".
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move image 1 down' })))
    expect(input(/Description of image 1/).value).toBe('Back')
    expect(screen.getByText('Image 2 moved to position 1 of 3. It is now the cover.')).toBeTruthy()

    await user.keyboard('{Enter}')
    await waitFor(() => expect(input(/Description of image 2/).value).toBe('Back'))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move image 2 down' })))

    await user.click(screen.getByRole('button', { name: 'Make image 3 the cover' }))
    expect(input(/Description of image 1/).value).toBe('Side')

    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await screen.findByText('Product saved')
    expect((puts[0]!.images as { asset_id: string }[]).map((i) => i.asset_id)).toEqual(['img-3', 'img-1', 'img-2'])
  })

  it('keeps focus on the image that became the cover, and in the list after removing one', async () => {
    const { user } = await open('/products/p1', product({ working: fullRevision({ images: [image(1, 'Front'), image(2, 'Back'), image(3, 'Side')] }) }))
    await user.click(screen.getByRole('button', { name: 'Make image 3 the cover' }))
    // Its "Make cover" and "Move up" are gone or disabled: focus lands on its "Move down", not on the page.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move image 1 down' })))
    expect(input(/Description of image 1/).value).toBe('Side')

    await user.click(screen.getByRole('button', { name: 'Remove image 2' }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove image 2' })))
    expect(input(/Description of image 2/).value).toBe('Back')
  })

  it('says when more images were chosen than fit, instead of dropping them silently', async () => {
    const images = Array.from({ length: 8 }, (_, i) => image(i + 1))
    const { user, puts } = await open('/products/p1', product({ working: fullRevision({ images }) }))
    await user.click(screen.getByRole('button', { name: 'Upload three at once' }))
    expect(screen.getByText(/Only 10 images fit/)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /^Remove image/ })).toHaveLength(10)
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await screen.findByText('Product saved')
    expect(puts[0]!.images).toHaveLength(10)
  })

  it('submits after a confirmation, then shows the version in review, read-only', async () => {
    const { user, submits } = await open('/products/p1', product())
    await user.click(screen.getByRole('button', { name: 'Submit for review' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/It goes on sale once it is approved/)).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Submit for review' }))
    expect(await screen.findByText('Submitted for review')).toBeTruthy()
    expect(submits).toEqual(['p1'])
    expect(await screen.findByText(/Version 1 is in review/)).toBeTruthy()
    expect(isDisabled(input(/^Title/))).toBe(true)
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
  })

  it('saves unsaved changes before submitting', async () => {
    const { user, puts, submits } = await open('/products/p1', product())
    await user.clear(input(/^Title/))
    await typeFast(user, input(/^Title/), 'Changed')
    await user.click(screen.getByRole('button', { name: 'Submit for review' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Your unsaved changes are saved first/)).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Submit for review' }))
    await screen.findByText('Submitted for review')
    expect(puts).toHaveLength(1)
    expect(submits).toEqual(['p1'])
  })

  it('lists what is missing when the API answers product_incomplete', async () => {
    const working = fullRevision({ images: [image(1)], variants: [{ id: 'v1', sku: 'A', size: '', color: '', price_paise: 100, mrp_paise: 100, is_active: true }] })
    const { user } = await open('/products/p1', product({ working }), {
      onSubmit: () => apiErrorResponse(422, 'product_incomplete', 'Add at least one image to submit'),
    })
    // The image was removed in another tab, say: the form still has it, the server does not.
    await user.click(screen.getByRole('button', { name: 'Submit for review' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Submit for review' }))
    expect(await screen.findByText(/To submit, add an active variant and an image\./)).toBeTruthy()
  })

  it('explains nothing_to_submit and reloads the product', async () => {
    const { user, submits } = await open('/products/p1', product(), {
      onSubmit: () => apiErrorResponse(409, 'nothing_to_submit', 'There are no unsubmitted changes to send for review'),
    })
    await user.click(screen.getByRole('button', { name: 'Submit for review' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Submit for review' }))
    expect(await screen.findByText(/There is nothing new to submit/)).toBeTruthy()
    expect(submits).toEqual(['p1'])
  })

  it('explains a version that went into review meanwhile, and reloads the product', async () => {
    let gets = 0
    const { user } = await open('/products/p1', product(), { onPut: () => apiErrorResponse(409, 'product_in_review') })
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'GET' && request.url.endsWith('/v1/vendor/products/p1')) gets += 1
    })
    await user.clear(input(/^Title/))
    await typeFast(user, input(/^Title/), 'Changed')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText(/A version of this product is in review, so it cannot be changed/)).toBeTruthy()
    await waitFor(() => expect(gets).toBeGreaterThan(0))
    server.events.removeAllListeners()
  })

  it('explains an archived product', async () => {
    const { user } = await open('/products/p1', product(), { onPut: () => apiErrorResponse(409, 'product_archived') })
    await user.clear(input(/^Title/))
    await typeFast(user, input(/^Title/), 'Changed')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('This product is archived, so it cannot be changed or submitted.')).toBeTruthy()
  })

  it('asks before leaving with unsaved changes', async () => {
    const { user, router } = await open('/products/p1', product())
    await user.clear(input(/^Title/))
    await typeFast(user, input(/^Title/), 'Changed')
    await user.click(screen.getByRole('link', { name: 'All products' }))
    const dialog = await screen.findByRole('dialog', { name: 'Leave without saving?' })
    await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }))
    expect(router.state.location.pathname).toBe('/products/p1')
    expect(input(/^Title/).value).toBe('Changed')
  })
})

describe('the states of a product', () => {
  it('shows the live version beside the form of an approved product, and says the live one does not change', async () => {
    const live = fullRevision({ id: 'live', state: 'approved', title: 'Live kurta', images: [image(1)] })
    const working = fullRevision({ id: 'w', version: 2, title: 'Edited kurta', images: [image(1)] })
    const { user, puts } = await open('/products/p1', product({ status: 'approved', live, working }))
    expect(screen.getByText(/Editing creates a new version. The live product does not change until it is approved./)).toBeTruthy()
    const panel = screen.getByRole('region', { name: 'Live version' })
    expect(within(panel).getByText('Live kurta')).toBeTruthy()
    expect(within(panel).getByText('₹1,499')).toBeTruthy()
    expect(input(/^Title/).value).toBe('Edited kurta')
    // Saved but unsubmitted changes can be submitted as they are.
    expect(isDisabled(screen.getByRole('button', { name: 'Submit for review' }))).toBe(false)

    await user.clear(input(/^Title/))
    await typeFast(user, input(/^Title/), 'Edited again')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await screen.findByText('Product saved')
    expect(puts).toHaveLength(1)
    expect(within(screen.getByRole('region', { name: 'Live version' })).getByText('Live kurta')).toBeTruthy()
  })

  it('starts from the live version when nothing is being edited, and needs a change to submit', async () => {
    const live = fullRevision({ id: 'live', state: 'approved', title: 'Live kurta', images: [image(1)] })
    await open('/products/p1', product({ status: 'approved', live, working: null }))
    expect(input(/^Title/).value).toBe('Live kurta')
    expect(isDisabled(screen.getByRole('button', { name: 'Submit for review' }))).toBe(true)
    expect(screen.getByText('Make a change to submit a new version for review.')).toBeTruthy()
  })

  it('is read-only while a version is in review, with the date it was submitted', async () => {
    const live = fullRevision({ id: 'live', state: 'approved', images: [image(1)] })
    const working = fullRevision({ id: 'w', version: 2, state: 'in_review', submitted_at: '2026-11-12T09:00:00Z', images: [image(1)] })
    await open('/products/p1', product({ status: 'approved', live, working }))
    expect(screen.getByText(/Version 2 is in review/).closest('.MuiAlert-root')?.textContent).toContain('since 12 Nov 2026')
    expect(screen.getByText(/The live product stays as it is meanwhile/)).toBeTruthy()
    for (const label of [/^Title/, /^Category/, /^Weight/]) expect(isDisabled(input(label))).toBe(true)
    expect(isDisabled(screen.getByRole('button', { name: 'Move image 1 down' }))).toBe(true)
    expect(isDisabled(input(/Description of image 1/))).toBe(true)
    expect(screen.getByRole('list', { name: 'Product images, in order' }).querySelector('[draggable="true"]')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Upload Add images' })).toBeNull()
  })

  it("shows a rejected version's reason as plain text, ready to fix", async () => {
    const working = fullRevision({
      version: 1,
      state: 'rejected',
      submitted_at: '2026-11-12T09:00:00Z',
      images: [image(1)],
      review: { status: 'rejected', reason: '<b>Blurry</b> photos.\nRetake the cover.', decided_at: '2026-11-13T09:00:00Z' },
    })
    await open('/products/p1', product({ status: 'rejected', working }))
    const alert = screen.getByText(/Version 1 was not approved/).closest('.MuiAlert-root') as HTMLElement
    expect(alert.textContent).toContain('<b>Blurry</b> photos.')
    expect(alert.querySelector('b')).toBeNull()
    expect(isDisabled(input(/^Title/))).toBe(false)
    expect(screen.getByText('Change something, then submit it again.')).toBeTruthy()
  })

  it('shows an archived product without a way to change it', async () => {
    await open('/products/p1', product({ status: 'archived', live: fullRevision({ images: [image(1)] }), working: null }))
    expect(screen.getByText(/This product is archived/)).toBeTruthy()
    expect(isDisabled(input(/^Title/))).toBe(true)
    expect(screen.queryByRole('button', { name: 'Submit for review' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Live version' })).toBeNull()
  })

  it('says when a product does not exist', async () => {
    setViewport(1280)
    serve(null)
    renderRoute('/products/missing', { store: makeStore({ refresh: async () => sessionBody() }).store })
    expect(await screen.findByRole('heading', { level: 1, name: 'Product not found' }, { timeout: 15_000 })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to products' })).toBeTruthy()
  })
})
