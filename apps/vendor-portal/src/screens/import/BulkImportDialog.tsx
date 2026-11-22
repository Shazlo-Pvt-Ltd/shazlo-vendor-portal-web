import { Box, Dialog, IconButton, Stack, Step, StepLabel, Stepper, Typography } from '@mui/material'
import { Banner, neutral } from '@shazlo/ui'
import { X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import type { Schemas } from '../../api/model'
import { useCommitImport, useImportJob, useStartImport } from '../../api/queries'
import { paths } from '../../app/paths'
import { importCopy as copy } from '../../copy/import'
import { srOnly } from '../../lib/a11y'
import { useNavMode } from '../../shell/layout'
import { PhotosStep } from './PhotosStep'
import { ReviewStep } from './ReviewStep'
import { checkImportFile, failedFileMessage, fileErrorMessage, rowNames, withRowNames } from './rules'
import { TemplateStep } from './TemplateStep'
import { UploadStep } from './UploadStep'

type Stage = 'template' | 'upload' | 'review' | 'photos'

// V-08: the import wizard in a dialog over Products. Full screen on phones, which also say a
// laptop is easier for spreadsheets. Steps: template, upload, fix errors, then photos for the
// drafts just made.
export function BulkImportDialog({ onClose }: { onClose: () => void }) {
  const mode = useNavMode()
  const phone = mode === 'phone'
  const navigate = useNavigate()
  const titleId = useId()
  const subtitleId = useId()
  const body = useRef<HTMLDivElement>(null)

  const [stage, setStage] = useState<Stage>('template')
  const [downloaded, setDownloaded] = useState(false)
  const [fileName, setFileName] = useState('')
  const [jobId, setJobId] = useState<string | null>(null)
  const [created, setCreated] = useState<Schemas['ImportCommit']['products']>([])
  // Refused before anything was sent (main's import rules): wrong type, empty, too large.
  const [fileProblem, setFileProblem] = useState<string | null>(null)
  // A CSV's product names by row, so the rows to fix say which product (vendor-api gives the row only).
  const [names, setNames] = useState<ReadonlyMap<number, string>>(new Map())
  const start = useStartImport()
  const commit = useCommitImport()
  const job = useImportJob(stage === 'review' ? jobId : null)
  // Saving makes drafts: a second press before the first is done must not save them twice.
  const saving = useRef(false)

  const ready = stage === 'review' && job.data?.status === 'ready' ? job.data : null
  const checked = useMemo(() => (ready ? { ...ready, errors: withRowNames(ready.errors, names) } : null), [ready, names])
  const active = stage === 'template' ? 0 : stage === 'upload' || (stage === 'review' && !checked) ? 1 : stage === 'review' ? 2 : 3
  const stepLabel = copy.steps[active]!

  // Each step replaces the buttons that led to it; keep keyboard focus inside the step.
  useEffect(() => {
    body.current?.focus({ preventScroll: true })
  }, [active])

  const toUpload = () => {
    start.reset()
    commit.reset()
    setJobId(null)
    setDownloaded(false)
    setFileProblem(null)
    setStage('upload')
  }

  const onFile = async (file: File) => {
    commit.reset()
    start.reset()
    // A new file starts a new check: what was said about the last one goes.
    setJobId(null)
    setStage('upload')
    setDownloaded(false)
    const problem = checkImportFile(file)
    setFileProblem(problem ?? null)
    if (problem) return
    setFileName(file.name)
    setNames(new Map())
    try {
      const [{ job_id }, sheetNames] = await Promise.all([
        start.mutateAsync(file),
        // Only a CSV can be read here; a name that cannot be read just leaves the column blank.
        /\.csv$/i.test(file.name) || file.type === 'text/csv' ? file.text().then(rowNames, () => new Map<number, string>()) : Promise.resolve(new Map<number, string>()),
      ])
      setNames(sheetNames)
      setJobId(job_id)
      setStage('review')
    } catch {
      // Shown in the drop zone from start.error.
    }
  }

  const onCreate = async () => {
    if (!jobId || saving.current) return
    saving.current = true
    try {
      const result = await commit.mutateAsync(jobId)
      setCreated(result.products)
      setStage('photos')
    } catch {
      // Shown in the step from commit.error.
    } finally {
      saving.current = false
    }
  }

  let content
  if (stage === 'template') {
    content = (
      <TemplateStep
        onNext={(didDownload) => {
          setDownloaded(didDownload)
          setStage('upload')
        }}
      />
    )
  } else if (stage === 'photos') {
    content = <PhotosStep products={created} onViewDrafts={() => navigate({ pathname: paths.products, search: '?status=draft' })} />
  } else if (checked) {
    content = <ReviewStep job={checked} wide={!phone} creating={commit.isPending} createError={commit.error ? fileErrorMessage(commit.error, { saving: true }) : null} onReplace={toUpload} onCreate={() => void onCreate()} />
  } else {
    // Uploading, checking, or the check could not read the file.
    const failedJob = job.data?.status === 'failed' ? job.data.errors[0] : undefined
    const failed = stage === 'review' && (failedJob ? failedFileMessage(failedJob) : job.data?.status === 'failed' ? copy.upload.failed : job.isError ? job.error.message : null)
    const busy = start.isPending ? copy.upload.sending(fileName) : stage === 'review' && !failed ? copy.upload.checking(fileName) : null
    content = (
      <UploadStep
        busy={busy}
        error={failed || fileProblem || (start.error ? fileErrorMessage(start.error) : null)}
        notice={downloaded ? copy.template.downloaded : null}
        onFile={(file) => void onFile(file)}
        onBack={() => setStage('template')}
      />
    )
  }

  return (
    <Dialog
      open
      onClose={(_, reason) => {
        // A stray click outside should not throw away a checked file.
        if (reason !== 'backdropClick') onClose()
      }}
      fullScreen={phone}
      fullWidth
      maxWidth="md"
      scroll="paper"
      aria-labelledby={titleId}
      aria-describedby={subtitleId}
      slotProps={{ paper: { sx: phone ? { pt: 'env(safe-area-inset-top, 0px)', pb: 'env(safe-area-inset-bottom, 0px)' } : undefined } }}
    >
      <Box sx={{ px: { xs: 2, sm: 3 }, pt: { xs: 2, sm: 3 }, pb: 2, borderBottom: `1px solid ${neutral.line}` }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography id={titleId} variant="h1" component="h2">
              {copy.title}
            </Typography>
            <Typography id={subtitleId} variant="body1" color="textSecondary" sx={{ mt: 0.5, maxWidth: '68ch' }}>
              {copy.subtitle}
            </Typography>
          </Box>
          <IconButton aria-label={copy.close} onClick={onClose} sx={{ mt: -0.5, mr: -1, width: 44, height: 44, color: neutral.inkSecondary }}>
            <X size={20} strokeWidth={1.75} aria-hidden="true" />
          </IconButton>
        </Stack>
        {phone ? (
          <>
            <Typography variant="body2" color="textSecondary" sx={{ mt: 2 }}>
              {copy.stepOf(active + 1, copy.steps.length, stepLabel)}
            </Typography>
            {stage !== 'photos' && (
              <Box sx={{ mt: 1.5 }}>
                <Banner tone="info" title={copy.laptop.title}>
                  {copy.laptop.body}
                </Banner>
              </Box>
            )}
          </>
        ) : (
          <Stepper activeStep={active} sx={{ mt: 3, '& .MuiStepIcon-root.Mui-active, & .MuiStepIcon-root.Mui-completed': { color: neutral.ink } }}>
            {copy.steps.map((label) => (
              <Step key={label}>
                <StepLabel>{label}</StepLabel>
              </Step>
            ))}
          </Stepper>
        )}
        <Box role="status" sx={srOnly}>
          {phone ? '' : copy.stepOf(active + 1, copy.steps.length, stepLabel)}
        </Box>
      </Box>
      <Box ref={body} tabIndex={-1} sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1, outline: 'none' }}>
        {content}
      </Box>
    </Dialog>
  )
}

export default BulkImportDialog
