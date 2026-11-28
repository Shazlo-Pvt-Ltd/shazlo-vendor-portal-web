import { CLOUDINARY_UPLOAD_ORIGIN } from '../../security/headers'
import type { components } from '../schema'

export type AssetKind = components['schemas']['AssetKind']
export type AssetOut = components['schemas']['AssetOut']
export type SignResponse = components['schemas']['SignResponse']
/** The image types vendor-api signs uploads for (the enum of `SignRequest.content_type`). */
export type ImageContentType = components['schemas']['SignRequest']['content_type']

/** Checked against the generated type, so the list cannot drift from the API. */
export const ALLOWED_CONTENT_TYPES: readonly ImageContentType[] = ['image/jpeg', 'image/png', 'image/webp']

/**
 * The size limit used before anything is sent: vendor-api's default `upload_max_bytes` (10 MB). The
 * server's real limit arrives with the signature and is checked again; if the server is configured
 * with a larger limit, raise this to match.
 */
export const DEFAULT_MAX_BYTES = 10 * 1024 * 1024

const TYPE_NAMES: Record<ImageContentType, string> = { 'image/jpeg': 'JPG', 'image/png': 'PNG', 'image/webp': 'WebP' }

export function formatLimit(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`
}

/** "Use a JPG, PNG or WebP under 10 MB" */
export function acceptedMessage(allowed: readonly string[], maxBytes: number): string {
  const names = allowed.map((type) => TYPE_NAMES[type as ImageContentType] ?? type.replace('image/', '').toUpperCase())
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : (names[0] ?? 'an image')
  return `Use a ${list} under ${formatLimit(maxBytes)}`
}

/**
 * Why a file cannot be uploaded, in plain words, or undefined if it can. Run before anything is
 * sent and again with the limits the server returned.
 */
export function checkFile(file: File, limits: { allowedTypes: readonly string[]; maxBytes: number }): string | undefined {
  if (!limits.allowedTypes.includes(file.type)) {
    return `That file type is not accepted. ${acceptedMessage(limits.allowedTypes, limits.maxBytes)}.`
  }
  if (file.size <= 0) {
    return 'That file is empty.'
  }
  if (file.size > limits.maxBytes) {
    return `That image is too large (${formatLimit(file.size)}). ${acceptedMessage(limits.allowedTypes, limits.maxBytes)}.`
  }
  return undefined
}

/**
 * The signature is only good for the upload host the CSP allows. Anything else (a server bug, a
 * tampered answer) must not receive the file and the signature.
 */
export function isTrustedUploadUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return (
    url.origin === CLOUDINARY_UPLOAD_ORIGIN &&
    url.username === '' &&
    url.password === '' &&
    url.search === '' &&
    /^\/v1_1\/[A-Za-z0-9_-]+\/image\/upload$/.test(url.pathname)
  )
}
