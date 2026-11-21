import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ApiError, NetworkError } from '../../api/errors'
import { DEFAULT_MAX_BYTES, acceptedMessage, checkFile, isTrustedUploadUrl } from './rules'
import { UploadError, UploadRejected, isAbort, uploadImage, xhrSend, type UploadStage } from './upload'
import { API_KEY, SIGNATURE, UPLOAD_URL, assetOut, fakeDeps, image, rejected, signResponse } from './testing'

const signal = () => new AbortController().signal

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected the upload to fail')
}

describe('checking a file before anything is sent', () => {
  it('says what is accepted, in plain words', () => {
    expect(acceptedMessage(['image/jpeg', 'image/png', 'image/webp'], DEFAULT_MAX_BYTES)).toBe('Use a JPG, PNG or WebP under 10 MB')
  })

  it.each([
    ['image/gif', 1000],
    ['application/pdf', 1000],
    ['', 1000],
    ['image/svg+xml', 1000],
  ])('refuses the type %j', (type, size) => {
    expect(checkFile(image('x', type, size), { allowedTypes: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: DEFAULT_MAX_BYTES })).toMatch(/not accepted.*JPG, PNG or WebP under 10 MB/)
  })

  it('refuses a file over the limit, but not one exactly at it', () => {
    const limits = { allowedTypes: ['image/png'], maxBytes: 1000 }
    expect(checkFile(image('x', 'image/png', 1001), limits)).toMatch(/too large/)
    expect(checkFile(image('x', 'image/png', 1000), limits)).toBeUndefined()
  })

  it('refuses an empty file', () => {
    expect(checkFile(image('x', 'image/png', 0), { allowedTypes: ['image/png'], maxBytes: 1000 })).toMatch(/empty/)
  })

  it.each([
    [UPLOAD_URL, true],
    ['https://api.cloudinary.com/v1_1/my-cloud_1/image/upload', true],
    ['http://api.cloudinary.com/v1_1/democloud/image/upload', false],
    ['https://evil.example/v1_1/democloud/image/upload', false],
    ['https://api.cloudinary.com.evil.example/v1_1/democloud/image/upload', false],
    ['https://user:pw@api.cloudinary.com/v1_1/democloud/image/upload', false],
    ['https://api.cloudinary.com/v1_1/democloud/image/upload?x=1', false],
    ['https://api.cloudinary.com/v1_1/democloud/raw/upload', false],
    ['not a url', false],
  ])('trusts only Cloudinary\'s upload address: %s', (url, trusted) => {
    expect(isTrustedUploadUrl(url)).toBe(trusted)
  })
})

describe('uploadImage', () => {
  it('signs, sends with progress, registers, and returns the ready asset', async () => {
    const { deps, calls } = fakeDeps()
    const stages: UploadStage[] = []
    const progress: number[] = []
    const asset = await uploadImage(image(), 'brand_logo', { signal: signal(), deps, onStage: (s) => stages.push(s), onProgress: (p) => progress.push(p) })
    expect(asset.status).toBe('ready')
    expect(calls).toEqual(['sign', 'send', 'register'])
    expect(stages).toEqual(['signing', 'uploading', 'registering'])
    expect(progress).toEqual([0, 0.5, 1, 1])
  })

  it('asks to sign exactly the kind, type and size of the file', async () => {
    const sign = vi.fn(async () => signResponse())
    const { deps } = fakeDeps({ sign })
    await uploadImage(image('a.webp', 'image/webp', 4321), 'product_image', { signal: signal(), deps })
    expect(sign).toHaveBeenCalledWith('product_image', expect.objectContaining({ size: 4321, type: 'image/webp' }), expect.anything())
  })

  it.each([
    ['the wrong type', image('x.gif', 'image/gif')],
    ['too large', image('big.png', 'image/png', DEFAULT_MAX_BYTES + 1)],
    ['empty', image('empty.png', 'image/png', 0)],
  ])('refuses %s without any request', async (_name, file) => {
    const { deps, calls } = fakeDeps()
    const error = await failure(uploadImage(file, 'brand_logo', { signal: signal(), deps }))
    expect(error).toBeInstanceOf(UploadError)
    expect((error as UploadError).retryable).toBe(false)
    expect(calls).toEqual([])
  })

  it('checks again against the limits the server returns, and sends nothing if they are stricter', async () => {
    const { deps, calls } = fakeDeps({ sign: async () => signResponse({ max_bytes: 500, allowed_content_types: ['image/png'] }) })
    const error = await failure(uploadImage(image('x.png', 'image/png', 2000), 'brand_logo', { signal: signal(), deps }))
    expect((error as UploadError).message).toMatch(/too large/)
    expect(calls).toEqual([])
  })

  it('does not send the file anywhere but Cloudinary\'s upload address', async () => {
    const send = vi.fn()
    const { deps } = fakeDeps({ sign: async () => signResponse({ upload_url: 'https://evil.example/upload' }), send })
    const error = await failure(uploadImage(image(), 'brand_logo', { signal: signal(), deps }))
    expect(error).toBeInstanceOf(UploadError)
    expect(send).not.toHaveBeenCalled()
  })

  describe('an expired signature', () => {
    it('is replaced before sending when it has already run out', async () => {
      let signs = 0
      const { deps, calls } = fakeDeps({
        sign: async () => { signs += 1; return signResponse({ expires_at: new Date(signs === 1 ? Date.now() - 1000 : Date.now() + 3_600_000).toISOString() }) },
      })
      await uploadImage(image(), 'brand_logo', { signal: signal(), deps })
      expect(signs).toBe(2)
      expect(calls.filter((c) => c === 'send')).toHaveLength(1)
    })

    it('is replaced once, automatically, when the image host rejects it', async () => {
      let sends = 0
      const { deps, calls } = fakeDeps({ send: async () => { sends += 1; if (sends === 1) throw rejected(401) } })
      const asset = await uploadImage(image(), 'brand_logo', { signal: signal(), deps })
      expect(asset.status).toBe('ready')
      expect(calls.filter((c) => c === 'sign')).toHaveLength(2)
      expect(sends).toBe(2)
    })

    it('gives up after one new signature, so a rejected file cannot loop', async () => {
      let sends = 0
      const { deps, calls } = fakeDeps({ send: async () => { sends += 1; throw rejected(401) } })
      const error = await failure(uploadImage(image(), 'brand_logo', { signal: signal(), deps }))
      expect(error).toBeInstanceOf(UploadError)
      expect(sends).toBe(2)
      expect(calls).not.toContain('register')
    })
  })

  it('marks a 5xx from the image host as worth retrying and a 4xx as not', async () => {
    const make = (status: number) => fakeDeps({ send: async () => { throw rejected(status) } }).deps
    expect(((await failure(uploadImage(image(), 'brand_logo', { signal: signal(), deps: make(503) }))) as UploadError).retryable).toBe(true)
    expect(((await failure(uploadImage(image(), 'brand_logo', { signal: signal(), deps: make(413) }))) as UploadError).retryable).toBe(false)
  })

  it('turns a network failure into a retryable message', async () => {
    const { deps } = fakeDeps({ send: async () => { throw new NetworkError('network') } })
    const error = (await failure(uploadImage(image(), 'brand_logo', { signal: signal(), deps }))) as UploadError
    expect(error.retryable).toBe(true)
    expect(error.message).toMatch(/Could not reach the server/)
  })

  describe('cancelling', () => {
    it('stops while sending and never registers', async () => {
      const controller = new AbortController()
      const { deps, calls } = fakeDeps({
        send: async () => {
          calls.push('send')
          controller.abort()
          throw new DOMException('The upload was cancelled.', 'AbortError')
        },
      })
      const error = await failure(uploadImage(image(), 'brand_logo', { signal: controller.signal, deps }))
      expect(isAbort(error)).toBe(true)
      expect(calls).toEqual(['sign', 'send'])
    })

    it('stops while signing', async () => {
      const controller = new AbortController()
      const { deps, calls } = fakeDeps({ sign: async () => { controller.abort(); throw new DOMException('x', 'AbortError') } })
      expect(isAbort(await failure(uploadImage(image(), 'brand_logo', { signal: controller.signal, deps })))).toBe(true)
      expect(calls).not.toContain('send')
    })

    it('does not register a file that finished sending just as the user cancelled', async () => {
      const controller = new AbortController()
      const { deps, calls } = fakeDeps({ send: async () => { controller.abort() } })
      expect(isAbort(await failure(uploadImage(image(), 'brand_logo', { signal: controller.signal, deps })))).toBe(true)
      expect(calls).not.toContain('register')
    })
  })

  describe('registering', () => {
    it('waits and tries again while the image host has not finished with the file (409)', async () => {
      let tries = 0
      const waits: number[] = []
      const { deps } = fakeDeps({
        register: async () => { tries += 1; if (tries < 3) throw new ApiError({ status: 409, code: 'upload_not_found', message: 'x' }); return assetOut() },
        wait: async (ms) => { waits.push(ms) },
      })
      expect((await uploadImage(image(), 'brand_logo', { signal: signal(), deps })).status).toBe('ready')
      expect(tries).toBe(3)
      expect(waits).toHaveLength(2)
    })

    it('stops trying after a few 409s and says it can be retried', async () => {
      const { deps } = fakeDeps({ register: async () => { throw new ApiError({ status: 409, code: 'upload_not_found', message: 'x' }) } })
      const error = (await failure(uploadImage(image(), 'brand_logo', { signal: signal(), deps }))) as UploadError
      expect(error.retryable).toBe(true)
    })

    it('shows the reason when the server refuses the stored file (422)', async () => {
      const { deps } = fakeDeps({ register: async () => { throw new ApiError({ status: 422, code: 'image_too_large', message: 'The image is larger than 10 MB' }) } })
      const error = (await failure(uploadImage(image(), 'brand_logo', { signal: signal(), deps }))) as UploadError
      expect(error.message).toBe('The image is larger than 10 MB')
      expect(error.retryable).toBe(false)
    })

    it('says the upload could not be verified on a 404, without internals', async () => {
      const { deps } = fakeDeps({ register: async () => { throw new ApiError({ status: 404, code: 'asset_not_found', message: 'Asset not found' }) } })
      const error = (await failure(uploadImage(image(), 'brand_logo', { signal: signal(), deps }))) as UploadError
      expect(error.message).toMatch(/could not be verified/)
    })

    it('is an error, not a success, if the asset did not become ready', async () => {
      const { deps } = fakeDeps({ register: async () => assetOut({ status: 'pending' }) })
      expect(await failure(uploadImage(image(), 'brand_logo', { signal: signal(), deps }))).toBeInstanceOf(UploadError)
    })
  })

  it('never lets the signature, the API key or the upload address into an error, however the upload fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const scenarios = [
      fakeDeps({ send: async () => { throw rejected(401) } }).deps,
      fakeDeps({ send: async () => { throw rejected(500) } }).deps,
      fakeDeps({ send: async () => { throw new Error(`failed to POST ${UPLOAD_URL} with ${SIGNATURE} ${API_KEY}`) } }).deps,
      fakeDeps({ register: async () => { throw new Error(`boom ${SIGNATURE}`) } }).deps,
    ]
    for (const deps of scenarios) {
      const error = (await failure(uploadImage(image(), 'brand_logo', { signal: signal(), deps }))) as Error
      const text = `${error.name} ${error.message} ${JSON.stringify(error)} ${error.stack?.split('\n')[0]}`
      for (const secret of [SIGNATURE, API_KEY, UPLOAD_URL, 'cloudinary']) expect(text).not.toContain(secret)
    }
    expect(log).not.toHaveBeenCalled()
  })
})

describe('xhrSend, the real request', () => {
  // Listening to upload progress makes a browser ask permission first (a CORS preflight); the image
  // host answers it, and so does this fake.
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST' }
  const server = setupServer()
  const reply = (body: unknown, init: { status?: number } = {}) => HttpResponse.json(body as never, { ...init, headers: cors })
  const useHost = (handler: Parameters<typeof http.post>[1]) =>
    server.use(http.options(UPLOAD_URL, () => new HttpResponse(null, { status: 204, headers: cors })), http.post(UPLOAD_URL, handler))
  beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
  afterEach(() => server.resetHandlers())
  afterAll(() => server.close())
  const send = (file = image('logo.png'), controller = new AbortController(), onProgress = vi.fn()) => ({
    promise: xhrSend(signResponse(), file, { signal: controller.signal, onProgress }),
    controller,
    onProgress,
  })

  it('posts every signed field and then the file', async () => {
    let body = ''
    useHost(async ({ request }) => {
      // The raw multipart text: Node's form parser does not accept jsdom's File objects.
      body = await request.text()
      return reply({ public_id: 'x' })
    })
    await send(image('logo.png')).promise
    const names = [...body.matchAll(/form-data; name="([^"]+)"/g)].map((match) => match[1])
    expect(names).toEqual([...Object.keys(signResponse().fields), 'file'])
    for (const [name, value] of Object.entries(signResponse().fields)) {
      expect(body).toMatch(new RegExp(`name="${name}"\\r\\n\\r\\n${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\r\\n`))
    }
    expect(body).toContain('filename="logo.png"')
  })

  it('rejects with the status, and nothing else, when the host refuses', async () => {
    useHost(() => reply({ error: { message: `bad signature ${SIGNATURE}` } }, { status: 401 }))
    const error = await failure(send().promise)
    expect(error).toBeInstanceOf(UploadRejected)
    expect((error as UploadRejected).status).toBe(401)
    expect((error as Error).message).not.toContain(SIGNATURE)
  })

  it('reports a network failure', async () => {
    server.use(http.options(UPLOAD_URL, () => new HttpResponse(null, { status: 204, headers: cors })), http.post(UPLOAD_URL, () => HttpResponse.error()))
    expect(await failure(send().promise)).toBeInstanceOf(NetworkError)
  })

  it('cancels the request in flight', async () => {
    useHost(async () => { await new Promise((r) => setTimeout(r, 2000)); return reply({}) })
    const { promise, controller } = send()
    setTimeout(() => controller.abort(), 20)
    expect(isAbort(await failure(promise))).toBe(true)
  })

  it('does not send anything if it was cancelled already', async () => {
    const hit = vi.fn()
    useHost(() => { hit(); return reply({}) })
    const controller = new AbortController()
    controller.abort()
    expect(isAbort(await failure(send(image(), controller).promise))).toBe(true)
    expect(hit).not.toHaveBeenCalled()
  })
})
