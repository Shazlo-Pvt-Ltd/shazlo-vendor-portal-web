import { File as NodeFile } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import { browserImageTools, fitWithin, ImageReadError, kindFromType, prepareImage, renamed, sniffImage, type Decoded, type ImageTools } from './imageResize'

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0))
const WEBP = [...ascii('RIFF'), 0x24, 0, 0, 0, ...ascii('WEBPVP8 ')]
const HEIC = [0, 0, 0, 0x18, ...ascii('ftypheic'), 0, 0, 0, 0, ...ascii('mif1heic')]

// Node's File: it has arrayBuffer() and slice(), which the type check reads.
const photo = (bytes: number[], name: string, type: string) => new NodeFile([new Uint8Array([...bytes, ...new Array(64).fill(7)])], name, { type }) as unknown as File

// Stand-in decoder and encoder: records what was drawn, returns a blob of the asked type.
function fakeTools({ width, height, canWrite = ['image/jpeg', 'image/webp'], decodeFails = false }: { width: number; height: number; canWrite?: string[]; decodeFails?: boolean }) {
  const close = vi.fn()
  const encoded: { size: { width: number; height: number }; type: string; quality: number }[] = []
  const tools: ImageTools = {
    decode: async () => {
      if (decodeFails) throw new Error('cannot decode')
      return { width, height, source: {} as CanvasImageSource, close } satisfies Decoded
    },
    encode: async (_image, size, type, quality) => {
      encoded.push({ size, type, quality })
      // Like canvas.toBlob: a type it cannot write comes back as PNG.
      return new NodeFile([new Uint8Array([1, 2, 3])], 'x', { type: canWrite.includes(type) ? type : 'image/png' }) as unknown as Blob
    },
  }
  return { tools, encoded, close }
}

describe('sniffImage', () => {
  it('reads the format from the first bytes', () => {
    expect(sniffImage(new Uint8Array(JPEG))).toBe('jpeg')
    expect(sniffImage(new Uint8Array(PNG))).toBe('png')
    expect(sniffImage(new Uint8Array(WEBP))).toBe('webp')
    expect(sniffImage(new Uint8Array(HEIC))).toBe('heic')
    expect(sniffImage(new Uint8Array([0, 0, 0, 0x1c, ...ascii('ftypavif')]))).toBe('avif')
    expect(sniffImage(new Uint8Array(ascii('GIF89a')))).toBe('gif')
    expect(sniffImage(new Uint8Array(ascii('%PDF-1.7')))).toBeNull()
    expect(sniffImage(new Uint8Array())).toBeNull()
  })

  it('maps the browser labels, including HEIF and the non-standard image/jpg', () => {
    expect(kindFromType('image/jpg')).toBe('jpeg')
    expect(kindFromType('IMAGE/JPEG')).toBe('jpeg')
    expect(kindFromType('image/heif')).toBe('heic')
    expect(kindFromType('image/heic-sequence')).toBe('heic')
    expect(kindFromType('application/pdf')).toBeNull()
    expect(kindFromType('')).toBeNull()
  })
})

describe('fitWithin and renamed', () => {
  it('keeps the long side at 2000 px or less and never enlarges', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 2000, height: 1500, scaled: true })
    expect(fitWithin(3024, 4032)).toEqual({ width: 1500, height: 2000, scaled: true })
    expect(fitWithin(1600, 1200)).toEqual({ width: 1600, height: 1200, scaled: false })
    expect(fitWithin(2000, 2000)).toEqual({ width: 2000, height: 2000, scaled: false })
    expect(fitWithin(9000, 10, 1000)).toEqual({ width: 1000, height: 1, scaled: true })
  })

  it('gives the file the extension of what it now is', () => {
    expect(renamed('IMG_2231.HEIC', 'jpeg')).toBe('IMG_2231.jpg')
    expect(renamed('kurta front.png', 'jpeg')).toBe('kurta front.jpg')
    expect(renamed('scan.webp', 'webp')).toBe('scan.webp')
    expect(renamed('photo', 'jpeg')).toBe('photo.jpg')
  })
})

describe('prepareImage', () => {
  it('shrinks a large JPEG to 2000 px at quality 0.8', async () => {
    const { tools, encoded, close } = fakeTools({ width: 4032, height: 3024 })
    const out = await prepareImage(photo(JPEG, 'IMG_2231.jpeg', 'image/jpeg'), { tools })
    expect(encoded).toEqual([{ size: { width: 2000, height: 1500, scaled: true }, type: 'image/jpeg', quality: 0.8 }])
    expect(out.type).toBe('image/jpeg')
    expect(out.name).toBe('IMG_2231.jpg')
    expect(close).toHaveBeenCalled()
  })

  it('sends a JPEG that is already small as it is', async () => {
    const { tools, encoded } = fakeTools({ width: 1600, height: 2000 })
    const file = photo(JPEG, 'front.jpg', 'image/jpeg')
    expect(await prepareImage(file, { tools })).toBe(file)
    expect(encoded).toEqual([])
  })

  it('converts an iPhone photo renamed to .jpg by what its bytes are, not its name', async () => {
    const { tools, encoded } = fakeTools({ width: 1500, height: 2000 })
    const out = await prepareImage(photo(HEIC, 'IMG_0042.jpg', 'image/jpeg'), { tools })
    expect(encoded).toHaveLength(1)
    expect(encoded[0]!.type).toBe('image/jpeg')
    expect(out.type).toBe('image/jpeg')
    expect(out.name).toBe('IMG_0042.jpg')
  })

  it('says so when a HEIC photo cannot be opened on this device', async () => {
    const { tools } = fakeTools({ width: 1, height: 1, decodeFails: true })
    await expect(prepareImage(photo(HEIC, 'IMG_0042.HEIC', 'image/heic'), { tools })).rejects.toBeInstanceOf(ImageReadError)
  })

  it('sends a JPEG it cannot open as it is, labelled by its bytes', async () => {
    const { tools } = fakeTools({ width: 1, height: 1, decodeFails: true })
    const out = await prepareImage(photo(JPEG, 'back.png', 'image/png'), { tools })
    expect(out.type).toBe('image/jpeg')
    expect(out.name).toBe('back.jpg')
  })

  it('turns a PNG into a JPEG even when it is small', async () => {
    const { tools, encoded } = fakeTools({ width: 1200, height: 1500 })
    const out = await prepareImage(photo(PNG, 'detail.png', 'image/png'), { tools })
    expect(encoded).toEqual([{ size: { width: 1200, height: 1500, scaled: false }, type: 'image/jpeg', quality: 0.8 }])
    expect(out.type).toBe('image/jpeg')
    expect(out.name).toBe('detail.jpg')
  })

  it('keeps a WebP a WebP, or writes a JPEG where the browser cannot write WebP', async () => {
    const webp = fakeTools({ width: 3000, height: 3000 })
    expect((await prepareImage(photo(WEBP, 'worn.webp', 'image/webp'), { tools: webp.tools })).type).toBe('image/webp')

    const noWebp = fakeTools({ width: 3000, height: 3000, canWrite: ['image/jpeg'] })
    const out = await prepareImage(photo(WEBP, 'worn.webp', 'image/webp'), { tools: noWebp.tools })
    expect(noWebp.encoded.map((e) => e.type)).toEqual(['image/webp', 'image/jpeg'])
    expect(out.type).toBe('image/jpeg')
    expect(out.name).toBe('worn.jpg')
  })

  it('uses the given size and quality', async () => {
    const { tools, encoded } = fakeTools({ width: 4000, height: 1000 })
    await prepareImage(photo(JPEG, 'wide.jpg', 'image/jpeg'), { tools, maxEdge: 1000, quality: 0.7 })
    expect(encoded[0]).toMatchObject({ size: { width: 1000, height: 250 }, quality: 0.7 })
  })

  it('uploads photos as they are where the browser cannot resize, with the right label', async () => {
    expect(browserImageTools()).toBeNull()
    const png = photo(PNG, 'front.png', 'image/png')
    expect(await prepareImage(png)).toBe(png)
    const mislabelled = await prepareImage(photo(PNG, 'front.jpg', 'image/jpeg'))
    expect(mislabelled.type).toBe('image/png')
    expect(mislabelled.name).toBe('front.png')
    const unknown = photo(ascii('hello'), 'notes.txt', 'text/plain')
    expect(await prepareImage(unknown)).toBe(unknown)
  })
})
