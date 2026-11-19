import { getApiClient } from '../../api/instance'
import { ApiError, NetworkError } from '../../api/errors'
import {
  ALLOWED_CONTENT_TYPES,
  DEFAULT_MAX_BYTES,
  checkFile,
  isTrustedUploadUrl,
  type AssetKind,
  type AssetOut,
  type ImageContentType,
  type SignResponse,
} from './rules'

export type UploadStage = 'signing' | 'uploading' | 'registering'

/**
 * A failure with words for the vendor. It never carries the signature, the API key, the upload
 * address or the image host's reply: those must not reach a screen, a log or an error report.
 */
export class UploadError extends Error {
  readonly retryable: boolean
  constructor(message: string, retryable: boolean) {
    super(message)
    this.name = 'UploadError'
    this.retryable = retryable
  }
}

/** The image host answered, but not with success. Only the status is kept. */
export class UploadRejected extends Error {
  readonly status: number
  constructor(status: number) {
    super(`The upload was rejected (${status}).`)
    this.name = 'UploadRejected'
    this.status = status
  }
}

export interface SendOptions {
  signal: AbortSignal
  onProgress: (fraction: number) => void
}

/** The three network steps, replaceable in tests. */
export interface UploadDeps {
  sign: (kind: AssetKind, file: File, signal: AbortSignal) => Promise<SignResponse>
  send: (signed: SignResponse, file: File, options: SendOptions) => Promise<void>
  register: (publicId: string, signal: AbortSignal) => Promise<AssetOut>
  now: () => number
  wait: (ms: number, signal: AbortSignal) => Promise<void>
}

const UPLOAD_TIMEOUT_MS = 120_000
/** Cloudinary may take a moment to show a file it has just accepted; registering is retried. */
const REGISTER_ATTEMPTS = 4
const REGISTER_WAIT_MS = 800

function abortError(): DOMException {
  return new DOMException('The upload was cancelled.', 'AbortError')
}

export const isAbort = (error: unknown): boolean => error instanceof DOMException && error.name === 'AbortError'

/** POSTs the file to the image host with progress (`fetch` cannot report upload progress). */
export function xhrSend(signed: SignResponse, file: File, { signal, onProgress }: SendOptions): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(abortError())
    const xhr = new XMLHttpRequest()
    const form = new FormData()
    // Exactly the signed fields, then the file, which must come last.
    for (const [name, value] of Object.entries(signed.fields)) form.append(name, value)
    form.append('file', file)

    const onAbort = () => xhr.abort()
    signal.addEventListener('abort', onAbort, { once: true })
    const done = () => signal.removeEventListener('abort', onAbort)

    xhr.open('POST', signed.upload_url)
    xhr.timeout = UPLOAD_TIMEOUT_MS
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(Math.min(1, event.loaded / event.total))
    }
    xhr.onload = () => {
      done()
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new UploadRejected(xhr.status))
    }
    xhr.onerror = () => {
      done()
      reject(new NetworkError('network'))
    }
    xhr.ontimeout = () => {
      done()
      reject(new NetworkError('timeout'))
    }
    xhr.onabort = () => {
      done()
      reject(abortError())
    }
    xhr.send(form)
  })
}

export const defaultDeps: UploadDeps = {
  sign: async (kind, file, signal) => {
    const { data } = await getApiClient().POST('/v1/vendor/assets/sign', {
      body: { kind, content_type: file.type as ImageContentType, size_bytes: file.size },
      signal,
    })
    return data as SignResponse
  },
  send: xhrSend,
  register: async (publicId, signal) => {
    const { data } = await getApiClient().POST('/v1/vendor/assets', { body: { public_id: publicId }, signal })
    return data as AssetOut
  },
  now: () => Date.now(),
  wait: (ms, signal) =>
    new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(abortError())
      const timer = setTimeout(resolve, ms)
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(abortError()) }, { once: true })
    }),
}

function signFailure(error: unknown): UploadError {
  if (error instanceof ApiError) {
    if (error.status === 422) return new UploadError(error.message, false)
    if (error.status === 429) return new UploadError('Too many uploads at once. Wait a moment and try again.', true)
    if (error.status === 503) return new UploadError('Image uploads are not available right now. Try again later.', true)
  }
  if (error instanceof NetworkError) return new UploadError(error.message, true)
  return new UploadError('We could not prepare the upload. Please try again.', true)
}

function registerFailure(error: unknown): UploadError {
  if (error instanceof ApiError) {
    // The server explains why it refused the stored file ("larger than 10 MB", "Upload a JPEG...").
    if (error.status === 422) return new UploadError(error.message, false)
    if (error.status === 404) return new UploadError('This upload could not be verified. Choose the image again.', false)
    if (error.status === 409) return new UploadError('The image host has not finished receiving the file. Try again.', true)
    if (error.status === 429) return new UploadError('Too many requests. Wait a moment and try again.', true)
  }
  if (error instanceof NetworkError) return new UploadError(error.message, true)
  return new UploadError('The image was uploaded but could not be saved. Please try again.', true)
}

export interface UploadOptions {
  signal: AbortSignal
  onStage?: (stage: UploadStage) => void
  /** 0 to 1 while the file is being sent. */
  onProgress?: (fraction: number) => void
  maxBytes?: number
  deps?: UploadDeps
}

/**
 * Uploads one image in the three steps vendor-api defines for assets: sign, send to the image
 * host, register. A wrong type or a file over the limit is refused before any request leaves the
 * browser. An expired signature is replaced once, automatically. Cancelling stops the request in
 * flight and never registers: a cancelled upload leaves only the `pending` record the signature
 * created, which cannot be used on a page or product.
 *
 * Resolves with the registered asset (status `ready`); throws {@link UploadError} with words for
 * the vendor, or an `AbortError` when cancelled.
 */
export async function uploadImage(file: File, kind: AssetKind, options: UploadOptions): Promise<AssetOut> {
  const { signal, onStage, onProgress, maxBytes = DEFAULT_MAX_BYTES, deps = defaultDeps } = options

  const early = checkFile(file, { allowedTypes: ALLOWED_CONTENT_TYPES, maxBytes })
  if (early) throw new UploadError(early, false)

  let resigned = false
  let signed: SignResponse
  for (;;) {
    onStage?.('signing')
    try {
      signed = await deps.sign(kind, file, signal)
    } catch (error) {
      if (isAbort(error) || signal.aborted) throw abortError()
      throw signFailure(error)
    }

    // The server's own limits, which win over the defaults used for the early check.
    const problem = checkFile(file, { allowedTypes: signed.allowed_content_types, maxBytes: signed.max_bytes })
    if (problem) throw new UploadError(problem, false)
    if (!isTrustedUploadUrl(signed.upload_url)) {
      throw new UploadError('The upload could not be started safely. Please try again later.', false)
    }
    // A signature that has already run out is replaced before the file is sent, not after it fails.
    if (Date.parse(signed.expires_at) <= deps.now() && !resigned) {
      resigned = true
      continue
    }

    onStage?.('uploading')
    onProgress?.(0)
    try {
      await deps.send(signed, file, { signal, onProgress: (fraction) => onProgress?.(fraction) })
      break
    } catch (error) {
      if (isAbort(error) || signal.aborted) throw abortError()
      if (error instanceof UploadRejected && [400, 401, 403].includes(error.status) && !resigned) {
        // Most likely an expired or stale signature: get a new one and send the file again, once.
        resigned = true
        continue
      }
      if (error instanceof UploadRejected) {
        throw new UploadError('The image service refused the file. Try again, or use a different image.', error.status >= 500)
      }
      if (error instanceof NetworkError) throw new UploadError(error.message, true)
      throw new UploadError('The upload failed. Please try again.', true)
    }
  }

  onProgress?.(1)
  onStage?.('registering')
  let lastError: unknown
  for (let attempt = 1; attempt <= REGISTER_ATTEMPTS; attempt += 1) {
    if (signal.aborted) throw abortError()
    try {
      const asset = await deps.register(signed.public_id, signal)
      if (asset.status !== 'ready') {
        throw new UploadError('The image could not be checked. Try again, or use a different image.', false)
      }
      return asset
    } catch (error) {
      if (error instanceof UploadError) throw error
      if (isAbort(error) || signal.aborted) throw abortError()
      lastError = error
      const notYetThere = error instanceof ApiError && error.status === 409
      if (!notYetThere || attempt === REGISTER_ATTEMPTS) break
      await deps.wait(REGISTER_WAIT_MS * attempt, signal)
    }
  }
  throw registerFailure(lastError)
}
