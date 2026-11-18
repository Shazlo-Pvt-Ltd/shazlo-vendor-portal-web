import { useCallback, useEffect, useReducer, useRef } from 'react'
import type { AssetKind, AssetOut } from './rules'
import { isAbort, uploadImage, type UploadDeps, type UploadStage } from './upload'

export type UploadStatus = 'queued' | UploadStage | 'ready' | 'error' | 'cancelled'

export interface UploadItem {
  id: number
  file: File
  /** An object URL of the local file, for a preview while it uploads. Revoked when the item goes. */
  previewUrl: string
  status: UploadStatus
  /** 0 to 1 while the file is being sent. */
  progress: number
  error?: string
  canRetry: boolean
  asset?: AssetOut
}

type Action =
  | { type: 'add'; items: UploadItem[] }
  | { type: 'patch'; id: number; patch: Partial<UploadItem> }
  | { type: 'remove'; ids: number[] }

function reducer(items: UploadItem[], action: Action): UploadItem[] {
  switch (action.type) {
    case 'add':
      return [...items, ...action.items]
    case 'patch':
      return items.map((item) => (item.id === action.id ? { ...item, ...action.patch } : item))
    case 'remove':
      return items.filter((item) => !action.ids.includes(item.id))
  }
}

const ACTIVE: UploadStatus[] = ['signing', 'uploading', 'registering']

export interface UseImageUploadsOptions {
  /** How many files upload at the same time. The rest wait their turn. */
  concurrency?: number
  /** Keep at most this many items; for a single image a new file replaces the old one. */
  maxFiles?: number
  /** Called once for each file that was uploaded and registered. */
  onUploaded?: (asset: AssetOut, file: File) => void
  /** Replaces the network steps; for tests. */
  deps?: UploadDeps
  maxBytes?: number
}

/**
 * Uploads images of one kind (`brand_logo`, `brand_banner` or `product_image`) with progress,
 * cancel and retry. Several files can be added at once; two upload at a time by default.
 */
export function useImageUploads(kind: AssetKind, options: UseImageUploadsOptions = {}) {
  const { concurrency = 2, maxFiles, deps, maxBytes } = options
  const [items, dispatch] = useReducer(reducer, [])
  const itemsRef = useRef(items)
  itemsRef.current = items
  const controllers = useRef(new Map<number, AbortController>())
  const started = useRef(new Set<number>())
  const nextId = useRef(0)
  const onUploaded = useRef(options.onUploaded)
  onUploaded.current = options.onUploaded

  const run = useCallback(
    async (item: UploadItem) => {
      const controller = new AbortController()
      controllers.current.set(item.id, controller)
      dispatch({ type: 'patch', id: item.id, patch: { status: 'signing', progress: 0, error: undefined, canRetry: false } })
      try {
        const asset = await uploadImage(item.file, kind, {
          signal: controller.signal,
          deps,
          maxBytes,
          onStage: (stage) => dispatch({ type: 'patch', id: item.id, patch: { status: stage } }),
          onProgress: (progress) => dispatch({ type: 'patch', id: item.id, patch: { progress } }),
        })
        dispatch({ type: 'patch', id: item.id, patch: { status: 'ready', progress: 1, asset } })
        onUploaded.current?.(asset, item.file)
      } catch (error) {
        if (isAbort(error)) {
          dispatch({ type: 'patch', id: item.id, patch: { status: 'cancelled', progress: 0 } })
        } else {
          const retryable = typeof error === 'object' && error !== null && 'retryable' in error ? Boolean((error as { retryable: unknown }).retryable) : true
          // Only the message written for vendors is kept: never the raw error, which could hold signature fields.
          const message = error instanceof Error && error.name === 'UploadError' ? error.message : 'The upload failed. Please try again.'
          dispatch({ type: 'patch', id: item.id, patch: { status: 'error', error: message, canRetry: retryable } })
        }
      } finally {
        controllers.current.delete(item.id)
      }
    },
    [kind, deps, maxBytes],
  )

  // Start queued items while fewer than `concurrency` are active.
  useEffect(() => {
    const active = items.filter((item) => ACTIVE.includes(item.status)).length
    let free = concurrency - active
    for (const item of items) {
      if (free <= 0) break
      if (item.status === 'queued' && !started.current.has(item.id)) {
        started.current.add(item.id)
        free -= 1
        void run(item)
      }
    }
  }, [items, concurrency, run])

  const discard = useCallback((ids: number[]) => {
    for (const id of ids) {
      controllers.current.get(id)?.abort()
      const item = itemsRef.current.find((candidate) => candidate.id === id)
      if (item) URL.revokeObjectURL(item.previewUrl)
      started.current.delete(id)
    }
    dispatch({ type: 'remove', ids })
  }, [])

  const add = useCallback(
    (files: File[]) => {
      if (files.length === 0) return
      let chosen = files
      if (maxFiles !== undefined) {
        const room = Math.max(0, maxFiles - itemsRef.current.length)
        if (maxFiles === 1) {
          // A single image: the new file replaces whatever was there.
          discard(itemsRef.current.map((item) => item.id))
          chosen = files.slice(0, 1)
        } else {
          chosen = files.slice(0, room)
        }
      }
      dispatch({
        type: 'add',
        items: chosen.map((file) => {
          nextId.current += 1
          return { id: nextId.current, file, previewUrl: URL.createObjectURL(file), status: 'queued', progress: 0, canRetry: false }
        }),
      })
    },
    [discard, maxFiles],
  )

  const cancel = useCallback((id: number) => {
    controllers.current.get(id)?.abort()
    // A file still waiting in the queue has no request to stop.
    const item = itemsRef.current.find((candidate) => candidate.id === id)
    if (item?.status === 'queued') {
      started.current.add(id)
      dispatch({ type: 'patch', id, patch: { status: 'cancelled' } })
    }
  }, [])

  const retry = useCallback((id: number) => {
    started.current.delete(id)
    dispatch({ type: 'patch', id, patch: { status: 'queued', error: undefined, canRetry: false, progress: 0 } })
  }, [])

  const remove = useCallback((id: number) => discard([id]), [discard])

  // Leaving the screen stops every upload and frees the previews.
  useEffect(
    () => () => {
      for (const controller of controllers.current.values()) controller.abort()
      for (const item of itemsRef.current) URL.revokeObjectURL(item.previewUrl)
    },
    [],
  )

  return { items, add, cancel, retry, remove }
}
