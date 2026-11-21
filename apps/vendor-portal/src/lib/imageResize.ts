// Photos shrink on the device before they upload (spec §7): a 12-megapixel phone photo becomes about
// 2000 px on its long side, so it uploads in seconds on a mobile connection and never hits the 10 MB
// limit. The result is always a JPEG or a WebP, the types the upload accepts.
//
// The type comes from the file's first bytes, not its name or the browser's label: an iPhone photo
// (HEIC) renamed to .jpg is still HEIC, and is converted like any other HEIC. Browsers that can open
// HEIC (Safari) convert it; others cannot, and the seller is asked for a JPG instead.

export const MAX_EDGE = 2000
export const QUALITY = 0.8

export type ImageKind = 'jpeg' | 'png' | 'webp' | 'gif' | 'heic' | 'avif'
type OutputKind = 'jpeg' | 'webp'

export const MIME: Record<ImageKind, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  avif: 'image/avif',
}

const EXTENSION: Record<OutputKind | 'png', string> = { jpeg: 'jpg', webp: 'webp', png: 'png' }
// Types the upload takes as they are, when no shrinking is needed.
const UPLOADABLE: readonly ImageKind[] = ['jpeg', 'png', 'webp']

// Screens show their own words for this (copy/productEditor.ts photos.unreadable).
export class ImageReadError extends Error {
  constructor() {
    super('The photo could not be opened on this device.')
    this.name = 'ImageReadError'
  }
}

const HEIF_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']

// What the first bytes of a file say it is; null when they match none of the photo formats.
export function sniffImage(bytes: Uint8Array): ImageKind | null {
  const ascii = (from: number, to: number) => (bytes.length >= to ? String.fromCharCode(...bytes.subarray(from, to)) : '')
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return 'png'
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp'
  if (ascii(0, 4) === 'GIF8') return 'gif'
  if (ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12)
    if (brand === 'avif' || brand === 'avis') return 'avif'
    if (HEIF_BRANDS.includes(brand)) return 'heic'
  }
  return null
}

// The browser's label for the file ("image/heif", "image/jpg"…); null for anything else.
export function kindFromType(type: string): ImageKind | null {
  const t = type.toLowerCase().trim()
  if (t === 'image/jpeg' || t === 'image/jpg' || t === 'image/pjpeg') return 'jpeg'
  if (t === 'image/png') return 'png'
  if (t === 'image/webp') return 'webp'
  if (t === 'image/gif') return 'gif'
  if (t === 'image/heic' || t === 'image/heif' || t === 'image/heic-sequence' || t === 'image/heif-sequence') return 'heic'
  if (t === 'image/avif') return 'avif'
  return null
}

// The size to draw at: the long side at most maxEdge, never enlarged.
export function fitWithin(width: number, height: number, maxEdge = MAX_EDGE): { width: number; height: number; scaled: boolean } {
  const long = Math.max(width, height)
  if (long <= maxEdge || long === 0) return { width, height, scaled: false }
  const scale = maxEdge / long
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scaled: true }
}

// "IMG_2231.HEIC" → "IMG_2231.jpg". A name without an extension gets one.
export function renamed(name: string, kind: OutputKind | 'png'): string {
  const base = name.replace(/\.[a-z0-9]{2,5}$/i, '') || 'photo'
  return `${base}.${EXTENSION[kind]}`
}

export type Decoded = { width: number; height: number; source: CanvasImageSource; close?: () => void }

// How a photo is opened and drawn smaller. Browsers use createImageBitmap and a canvas; tests pass
// their own.
export interface ImageTools {
  decode: (file: Blob) => Promise<Decoded>
  encode: (image: Decoded, size: { width: number; height: number }, type: string, quality: number) => Promise<Blob | null>
}

async function readHead(file: Blob, length = 32): Promise<Uint8Array> {
  const part = file.slice(0, length)
  if (typeof part.arrayBuffer === 'function') return new Uint8Array(await part.arrayBuffer())
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => resolve(new Uint8Array())
    reader.readAsArrayBuffer(part)
  })
}

// The same bytes, labelled with what they really are (a renamed PNG says image/png).
function relabel(file: File, kind: ImageKind | null): File {
  if (!kind || file.type === MIME[kind]) return file
  const name = kind === 'jpeg' || kind === 'png' || kind === 'webp' ? renamed(file.name, kind) : file.name
  return new File([file], name, { type: MIME[kind], lastModified: file.lastModified })
}

function draw(canvas: OffscreenCanvas | HTMLCanvasElement, image: Decoded, width: number, height: number): boolean {
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!ctx) return false
  // A JPEG has no transparency: a see-through PNG goes on white, not black.
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, width, height)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image.source, 0, 0, width, height)
  return true
}

// The browser's tools, or null where it has none (old browsers, and jsdom in tests): photos then
// upload as they are.
export function browserImageTools(): ImageTools | null {
  if (typeof createImageBitmap !== 'function') return null
  const offscreen = typeof OffscreenCanvas === 'function'
  if (!offscreen && typeof document === 'undefined') return null
  return {
    decode: async (file) => {
      let bitmap: ImageBitmap
      try {
        bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      } catch {
        // Older Safari rejects the options object.
        bitmap = await createImageBitmap(file)
      }
      return { width: bitmap.width, height: bitmap.height, source: bitmap, close: () => bitmap.close() }
    },
    encode: async (image, { width, height }, type, quality) => {
      if (offscreen) {
        const canvas = new OffscreenCanvas(width, height)
        if (!draw(canvas, image, width, height)) return null
        try {
          return await canvas.convertToBlob({ type, quality })
        } catch {
          return null
        }
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      if (!draw(canvas, image, width, height)) return null
      return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
    },
  }
}

export type PrepareOptions = { maxEdge?: number; quality?: number; tools?: ImageTools | null }

// The file to upload for a picked photo: shrunk to maxEdge on the long side and saved as a JPEG
// (a WebP stays a WebP). A JPEG or WebP that is already small enough goes as it is. Throws
// ImageReadError when the photo cannot be opened and the upload would not accept it either.
export async function prepareImage(file: File, { maxEdge = MAX_EDGE, quality = QUALITY, tools = browserImageTools() }: PrepareOptions = {}): Promise<File> {
  const kind = sniffImage(await readHead(file)) ?? kindFromType(file.type)
  if (!tools) return relabel(file, kind)

  let image: Decoded | null = null
  try {
    image = await tools.decode(file)
  } catch {
    image = null
  }
  if (!image) {
    if (kind && UPLOADABLE.includes(kind)) return relabel(file, kind)
    throw new ImageReadError()
  }

  try {
    const size = fitWithin(image.width, image.height, maxEdge)
    if (!size.scaled && (kind === 'jpeg' || kind === 'webp')) return relabel(file, kind)
    const wanted: OutputKind = kind === 'webp' ? 'webp' : 'jpeg'
    let out: OutputKind = wanted
    let blob = await tools.encode(image, size, MIME[wanted], quality)
    // A browser that cannot write WebP hands back a PNG instead: write a JPEG.
    if (wanted === 'webp' && blob?.type !== MIME.webp) {
      out = 'jpeg'
      blob = await tools.encode(image, size, MIME.jpeg, quality)
    }
    if (!blob || blob.type !== MIME[out]) {
      if (kind && UPLOADABLE.includes(kind)) return relabel(file, kind)
      throw new ImageReadError()
    }
    return new File([blob], renamed(file.name, out), { type: MIME[out], lastModified: file.lastModified })
  } finally {
    image.close?.()
  }
}
