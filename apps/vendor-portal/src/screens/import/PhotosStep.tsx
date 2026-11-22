import { Box, Button, DialogActions, DialogContent, LinearProgress, Stack, Typography } from '@mui/material'
import { Banner, brand, neutral, radius, status } from '@shazlo/ui'
import { Images } from 'lucide-react'
import { useRef, useState, type DragEvent, type InputHTMLAttributes, type ReactNode } from 'react'
import { useAttachProductPhoto } from '../../api/queries'
import { catalogCopy } from '../../copy/catalog'
import { importCopy } from '../../copy/import'
import { ImageReadError, prepareImage } from '../../lib/imageResize'
import { actionsSx } from './layout'
import { isPhotoFile, planImportPhotos, type Draft, type Planned } from './photoPlan'

const copy = importCopy.photos

type State = 'waiting' | 'preparing' | 'uploading' | 'done' | 'failed'
type Entry = Planned & { key: string; state: State; error: string | null }

// Folder picking is a Chromium, Firefox and desktop Safari extra; React has no prop for it.
const folderInput = { webkitdirectory: '', directory: '' } as InputHTMLAttributes<HTMLInputElement>
const canPickFolder = () => typeof HTMLInputElement !== 'undefined' && 'webkitdirectory' in HTMLInputElement.prototype

// Everything dropped, including the photos inside a dropped folder.
async function droppedFiles(transfer: DataTransfer): Promise<File[]> {
  const entries = Array.from(transfer.items ?? [])
    .map((item) => item.webkitGetAsEntry?.() ?? null)
    .filter((entry): entry is FileSystemEntry => entry !== null)
  if (!entries.some((entry) => entry.isDirectory)) return Array.from(transfer.files)
  const out: File[] = []
  async function walk(entry: FileSystemEntry): Promise<void> {
    if (entry.isFile) {
      out.push(await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject)))
      return
    }
    if (!entry.isDirectory) return
    const reader = (entry as FileSystemDirectoryEntry).createReader()
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
      if (!batch.length) break
      for (const child of batch) await walk(child)
    }
  }
  for (const entry of entries) await walk(entry)
  return out
}

const slotLabel = (entry: Planned, n: number) => (entry.angle === 'extra' || entry.angle === 'tryon' ? `${catalogCopy.photoAngles[entry.angle]} ${n}` : catalogCopy.photoAngles[entry.angle])

function FileList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box component="ul" aria-label={label} sx={{ listStyle: 'none', p: 0, m: 0, borderTop: `1px solid ${neutral.line}` }}>
      {children}
    </Box>
  )
}

// Step 4 (V-08): photos for the new drafts. The seller picks or drops many photos (or a folder);
// each is matched to a draft by its name, shrunk on the device and uploaded one at a time, each
// with its own progress and Try again.
export function PhotosStep({ products, onViewDrafts }: { products: Draft[]; onViewDrafts: () => void }) {
  const attach = useAttachProductPhoto()
  const [entries, setEntries] = useState<Entry[]>([])
  const [unmatched, setUnmatched] = useState<File[]>([])
  const [noRoom, setNoRoom] = useState<{ file: File; product: Draft }[]>([])
  const [running, setRunning] = useState(false)
  const [over, setOver] = useState(false)
  const latest = useRef<Entry[]>([])
  const input = useRef<HTMLInputElement>(null)
  const folder = useRef<HTMLInputElement>(null)
  const seq = useRef(0)
  // One run at a time, however fast "Add photos" is pressed.
  const busy = useRef(false)

  const commit = (next: Entry[]) => {
    latest.current = next
    setEntries(next)
  }
  const patch = (key: string, change: Partial<Entry>) => commit(latest.current.map((e) => (e.key === key ? { ...e, ...change } : e)))

  function add(files: File[]) {
    const photos = files.filter(isPhotoFile)
    if (!photos.length) return
    const plan = planImportPhotos(photos, products, latest.current)
    const fresh = plan.matched.map((p): Entry => {
      seq.current += 1
      return { ...p, key: `photo-${seq.current}`, state: 'waiting', error: null }
    })
    commit([...latest.current, ...fresh])
    setUnmatched((u) => [...u, ...plan.unmatched])
    setNoRoom((n) => [...n, ...plan.noRoom])
  }

  async function upload() {
    if (busy.current) return
    busy.current = true
    setRunning(true)
    try {
      for (;;) {
        const next = latest.current.find((e) => e.state === 'waiting')
        if (!next) break
        try {
          patch(next.key, { state: 'preparing' })
          const file = await prepareImage(next.file)
          patch(next.key, { state: 'uploading' })
          await attach.mutateAsync({ productId: next.product.id, file, angle: next.angle })
          patch(next.key, { state: 'done' })
        } catch (error) {
          patch(next.key, { state: 'failed', error: error instanceof ImageReadError ? copy.unreadable : error instanceof Error ? error.message : '' })
        }
      }
    } finally {
      busy.current = false
      setRunning(false)
    }
  }

  const retry = (key: string) => {
    patch(key, { state: 'waiting', error: null })
    void upload()
  }

  const onDrop = async (event: DragEvent) => {
    event.preventDefault()
    setOver(false)
    if (!running) add(await droppedFiles(event.dataTransfer))
  }

  const waiting = entries.filter((e) => e.state === 'waiting').length
  const done = entries.filter((e) => e.state === 'done').length
  const failed = entries.filter((e) => e.state === 'failed').length
  const started = entries.some((e) => e.state !== 'waiting')
  const finished = started && !running && waiting === 0

  // Numbers for "Extra 2", "Try-on 3", per product, in the order they were planned.
  const counters = new Map<string, number>()
  const numbered = entries.map((entry) => {
    const id = `${entry.product.id}:${entry.angle}`
    const n = (counters.get(id) ?? 0) + 1
    counters.set(id, n)
    return { entry, slot: slotLabel(entry, n) }
  })

  return (
    <>
      <DialogContent>
        <Stack spacing={3}>
          <Banner tone="success" title={copy.title(products.length)} />
          <Box>
            <Typography variant="body1">{copy.intro}</Typography>
            <Typography variant="body2" color="textSecondary" sx={{ mt: 0.5 }}>
              {copy.exampleName}
            </Typography>
          </Box>

          {!running && (
            <Box
              data-dropzone=""
              onDragOver={(event) => {
                event.preventDefault()
                if (!over) setOver(true)
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(event) => void onDrop(event)}
              sx={{
                display: 'grid',
                justifyItems: 'center',
                gap: 1.5,
                textAlign: 'center',
                px: { xs: 2, sm: 4 },
                py: { xs: 3, sm: 4 },
                border: `1.5px dashed ${over ? brand.brown : neutral.lineStrong}`,
                borderRadius: `${radius.card}px`,
                bgcolor: over ? neutral.placeholder : neutral.canvas,
              }}
            >
              <Box sx={{ color: brand.brown, display: 'flex' }}>
                <Images size={28} strokeWidth={1.25} aria-hidden="true" />
              </Box>
              <Typography variant="body1">
                {copy.drop}{' '}
                <Button
                  variant="text"
                  onClick={() => input.current?.click()}
                  sx={{ p: 0, minWidth: 0, minHeight: 0, verticalAlign: 'baseline', font: 'inherit', color: 'info.main', textDecoration: 'underline', textUnderlineOffset: '0.18em' }}
                >
                  {copy.choose}
                </Button>
              </Typography>
              {canPickFolder() && (
                <Button variant="outlined" onClick={() => folder.current?.click()} sx={{ minHeight: 44 }}>
                  {copy.chooseFolder}
                </Button>
              )}
              <input
                ref={input}
                type="file"
                accept="image/*"
                multiple
                hidden
                aria-label={copy.inputLabel}
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? [])
                  event.target.value = ''
                  add(files)
                }}
              />
              <input
                ref={folder}
                type="file"
                multiple
                hidden
                aria-label={copy.folderLabel}
                {...folderInput}
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? [])
                  event.target.value = ''
                  add(files)
                }}
              />
            </Box>
          )}

          {entries.length > 0 && (
            <Box>
              <Stack direction="row" spacing={2} sx={{ alignItems: 'baseline', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="h3" component="h3">
                  {copy.matchedTitle(entries.length)}
                </Typography>
                {started && (
                  <Typography role="status" variant="body2" color="textSecondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {copy.progress(done, entries.length)}
                  </Typography>
                )}
              </Stack>
              <FileList label={copy.matchedLabel}>
                {numbered.map(({ entry, slot }) => (
                  <Box component="li" key={entry.key} sx={{ py: 1.25, borderBottom: `1px solid ${neutral.line}` }}>
                    <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                          {copy.file(entry.file.name, entry.product.title, slot)}
                        </Typography>
                        {(entry.state === 'preparing' || entry.state === 'uploading') && <LinearProgress aria-label={`${copy.states[entry.state]} ${entry.file.name}`} sx={{ height: 3, mt: 0.75, maxWidth: 240 }} />}
                        {entry.state === 'failed' && (
                          <Typography variant="caption" component="p" sx={{ color: status.error, mt: 0.25 }}>
                            {entry.error}
                          </Typography>
                        )}
                      </Box>
                      {entry.state === 'failed' ? (
                        <Button size="small" onClick={() => retry(entry.key)} aria-label={copy.retryLabel(entry.file.name)} sx={{ minHeight: 44, flexShrink: 0 }}>
                          {copy.retry}
                        </Button>
                      ) : (
                        <Typography variant="caption" color={entry.state === 'done' ? 'text.primary' : 'text.secondary'} sx={{ flexShrink: 0 }}>
                          {copy.states[entry.state]}
                        </Typography>
                      )}
                    </Stack>
                  </Box>
                ))}
              </FileList>
            </Box>
          )}

          {unmatched.length > 0 && (
            <Box>
              <Typography variant="h3" component="h3">
                {copy.unmatchedTitle(unmatched.length)}
              </Typography>
              <Typography variant="body2" color="textSecondary" sx={{ mt: 0.25, mb: 1 }}>
                {copy.unmatchedHint}
              </Typography>
              <FileList label={copy.unmatchedLabel}>
                {unmatched.map((file, i) => (
                  <Box component="li" key={`${file.name}-${i}`} sx={{ py: 1, borderBottom: `1px solid ${neutral.line}` }}>
                    <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                      {file.name}
                    </Typography>
                  </Box>
                ))}
              </FileList>
            </Box>
          )}

          {noRoom.length > 0 && (
            <Box>
              <Typography variant="h3" component="h3">
                {copy.noRoomTitle(noRoom.length)}
              </Typography>
              <Typography variant="body2" color="textSecondary" sx={{ mt: 0.25 }}>
                {copy.noRoomHint} {noRoom.map((n) => n.file.name).join(', ')}
              </Typography>
            </Box>
          )}

          {finished && (failed ? <Banner tone="warning" title={copy.someFailed(failed)} /> : <Banner tone="success" title={copy.allDone(done)} />)}
        </Stack>
      </DialogContent>
      <DialogActions sx={actionsSx}>
        {waiting > 0 || running ? (
          <>
            <Button variant="outlined" onClick={onViewDrafts} disabled={running}>
              {copy.skip}
            </Button>
            <Button variant="contained" onClick={() => void upload()} disabled={running}>
              {running ? copy.adding : copy.add(waiting)}
            </Button>
          </>
        ) : (
          <Button variant={entries.length ? 'contained' : 'outlined'} onClick={onViewDrafts}>
            {entries.length ? copy.viewDrafts : copy.skip}
          </Button>
        )}
      </DialogActions>
    </>
  )
}
