import type { AssetOut, SignResponse } from './rules'
import { UploadRejected, type UploadDeps } from './upload'

export const UPLOAD_URL = 'https://api.cloudinary.com/v1_1/democloud/image/upload'
export const SIGNATURE = 'sig-0123456789abcdef-secret'
export const API_KEY = 'key-123456789012345'

export function signResponse(overrides: Partial<SignResponse> = {}): SignResponse {
  return {
    asset_id: '3f2b8c1e-5a4d-4e7b-9c3a-1d2e3f4a5b6c',
    public_id: 'shazlo/vendors/v1/products/abc',
    upload_url: UPLOAD_URL,
    fields: { api_key: API_KEY, public_id: 'shazlo/vendors/v1/products/abc', signature: SIGNATURE, timestamp: '1762851600', overwrite: 'false' },
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    max_bytes: 10 * 1024 * 1024,
    allowed_content_types: ['image/jpeg', 'image/png', 'image/webp'],
    ...overrides,
  }
}

export function assetOut(overrides: Partial<AssetOut> = {}): AssetOut {
  return {
    id: '3f2b8c1e-5a4d-4e7b-9c3a-1d2e3f4a5b6c',
    kind: 'product_image',
    status: 'ready',
    public_id: 'shazlo/vendors/v1/products/abc',
    url: 'https://res.cloudinary.com/democloud/image/upload/v1/shazlo/abc.jpg',
    format: 'jpg',
    bytes: 1000,
    width: 800,
    height: 600,
    created_at: '2026-11-10T09:30:00Z',
    ...overrides,
  } as AssetOut
}

export const image = (name = 'logo.png', type = 'image/png', size = 1000) => new File([new Uint8Array(size)], name, { type })

/** A fake upload that succeeds at once; replace any step. `calls` records what happened, in order. */
export function fakeDeps(overrides: Partial<UploadDeps> = {}) {
  const calls: string[] = []
  const deps: UploadDeps = {
    sign: async () => { calls.push('sign'); return signResponse() },
    send: async (_signed, _file, { onProgress }) => { calls.push('send'); onProgress(0.5); onProgress(1) },
    register: async () => { calls.push('register'); return assetOut() },
    now: () => Date.now(),
    wait: async () => {},
    ...overrides,
  }
  return { deps, calls }
}

/** A step you finish yourself, to test what is shown in the middle of an upload. */
export function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

export const rejected = (status: number) => new UploadRejected(status)
