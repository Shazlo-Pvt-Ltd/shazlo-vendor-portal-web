import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Schemas } from '../../../api/model'
import { useAddProductImage } from '../../../api/queries'
import { catalogCopy } from '../../../copy/catalog'
import { productEditorCopy } from '../../../copy/productEditor'
import { isNamedAngle, MAX_EXTRA_PHOTOS, MAX_TRYON_PHOTOS, NAMED_PHOTO_ANGLES, tryonCount, type PhotoAngle } from '../../../lib/catalog'
import { ImageReadError, prepareImage } from '../../../lib/imageResize'

type Image = Schemas['Product']['images'][number]

export type UploadState = 'waiting' | 'preparing' | 'uploading' | 'failed'

// A photo on its way: shown from its preview at once, shrunk on the device, then uploaded through
// main's pipeline (sign → Cloudinary → register) with its own progress (0 to 1, null before the
// file is sent). `retryable` is false for a file that can never upload (wrong type, too large).
export type PendingPhoto = {
  key: string
  angle: PhotoAngle
  file: File
  preview: string
  state: UploadState
  error: string | null
  prepared: File | null
  progress: number | null
  retryable: boolean
}

export type PhotoGroup = 'product' | 'tryon'

// Where picked photos go. Product photos fill the empty named slots in order (starting at the
// tapped one, if any), then the extra slots; try-on photos fill the try-on slots. Pending uploads
// hold their slot. What does not fit is counted, with the reason.
export function planPhotos(
  count: number,
  group: PhotoGroup,
  images: readonly Pick<Image, 'angle'>[],
  pending: readonly Pick<PendingPhoto, 'angle'>[],
  start: PhotoAngle | null = null,
): { angles: PhotoAngle[]; skipped: number; reason: string | null } {
  const all = [...images, ...pending]
  const angles: PhotoAngle[] = []
  if (group === 'tryon') {
    const room = Math.max(0, MAX_TRYON_PHOTOS - tryonCount(all))
    for (let i = 0; i < Math.min(count, room); i++) angles.push('tryon')
    const skipped = count - angles.length
    return { angles, skipped, reason: skipped ? catalogCopy.errors.product.tryonFull : null }
  }
  let empty = start === 'extra' ? [] : NAMED_PHOTO_ANGLES.filter((a) => !all.some((i) => i.angle === a))
  if (start && isNamedAngle(start)) empty = [start, ...empty.filter((a) => a !== start)]
  let extraRoom = Math.max(0, MAX_EXTRA_PHOTOS - all.filter((i) => i.angle === 'extra').length)
  for (let i = 0; i < count; i++) {
    const named = empty.shift()
    if (named) angles.push(named)
    else if (extraRoom > 0) {
      angles.push('extra')
      extraRoom -= 1
    } else break
  }
  const skipped = count - angles.length
  return { angles, skipped, reason: skipped ? catalogCopy.errors.product.extraFull : null }
}

let seq = 0

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError'
// main's UploadError says whether trying again can help; anything else might.
const canRetry = (error: unknown) => !(error instanceof ImageReadError) && !(typeof error === 'object' && error !== null && 'retryable' in error && error.retryable === false)

// The editor's upload queue. It lives with the editor, not the photos card, so uploads carry on
// while a phone seller moves to the next step. One photo at a time, to spare phone memory and data.
// Cancel stops the one on its way (nothing is added) or drops one waiting or failed.
export function usePhotoUploads(productId: string | null) {
  const add = useAddProductImage(productId ?? '')
  const addRef = useRef(add)
  useEffect(() => {
    addRef.current = add
  })

  const items = useRef<PendingPhoto[]>([])
  const controllers = useRef(new Map<string, AbortController>())
  const [pending, setPending] = useState<PendingPhoto[]>([])
  const running = useRef(false)

  const publish = useCallback(() => setPending([...items.current]), [])
  const patch = useCallback(
    (key: string, change: Partial<PendingPhoto>) => {
      if (!items.current.some((i) => i.key === key)) return
      items.current = items.current.map((i) => (i.key === key ? { ...i, ...change } : i))
      publish()
    },
    [publish],
  )
  const drop = useCallback(
    (key: string) => {
      const item = items.current.find((i) => i.key === key)
      if (item) URL.revokeObjectURL(item.preview)
      controllers.current.get(key)?.abort()
      controllers.current.delete(key)
      items.current = items.current.filter((i) => i.key !== key)
      publish()
    },
    [publish],
  )

  const pump = useCallback(async () => {
    if (running.current) return
    running.current = true
    try {
      for (;;) {
        const next = items.current.find((i) => i.state === 'waiting')
        if (!next) break
        const controller = new AbortController()
        controllers.current.set(next.key, controller)
        try {
          let file = next.prepared
          if (!file) {
            patch(next.key, { state: 'preparing' })
            file = await prepareImage(next.file)
            patch(next.key, { prepared: file })
          }
          if (controller.signal.aborted) continue
          patch(next.key, { state: 'uploading', progress: null })
          await addRef.current.mutateAsync({ file, angle: next.angle, signal: controller.signal, onProgress: (fraction) => patch(next.key, { progress: fraction }) })
          drop(next.key)
        } catch (error) {
          // Cancelled: already dropped.
          if (isAbort(error) || controller.signal.aborted) continue
          const reason = error instanceof ImageReadError ? productEditorCopy.photos.unreadable : error instanceof Error ? error.message : ''
          patch(next.key, { state: 'failed', error: reason, progress: null, retryable: canRetry(error) })
        } finally {
          if (controllers.current.get(next.key) === controller) controllers.current.delete(next.key)
        }
      }
    } finally {
      running.current = false
    }
  }, [patch, drop])

  const enqueue = useCallback(
    (entries: { file: File; angle: PhotoAngle }[]) => {
      if (!entries.length) return
      const fresh = entries.map(({ file, angle }): PendingPhoto => {
        seq += 1
        return { key: `upload-${seq}`, angle, file, preview: URL.createObjectURL(file), state: 'waiting', error: null, prepared: null, progress: null, retryable: true }
      })
      items.current = [...items.current, ...fresh]
      publish()
      void pump()
    },
    [publish, pump],
  )

  const retry = useCallback(
    (key: string) => {
      patch(key, { state: 'waiting', error: null })
      void pump()
    },
    [patch, pump],
  )

  // Leaving the editor stops what is on its way, and frees the previews (object URLs).
  useEffect(
    () => () => {
      for (const controller of controllers.current.values()) controller.abort()
      for (const item of items.current) URL.revokeObjectURL(item.preview)
    },
    [],
  )

  return useMemo(() => ({ pending, enqueue, retry, cancel: drop }), [pending, enqueue, retry, drop])
}

export type PhotoUploads = ReturnType<typeof usePhotoUploads>
