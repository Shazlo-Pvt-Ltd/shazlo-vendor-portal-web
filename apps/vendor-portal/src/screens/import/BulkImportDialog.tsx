import { Box, Dialog, IconButton, Stack, Step, StepLabel, Stepper, Typography } from '@mui/material'
import { Banner, neutral } from '@shazlo/ui'
import { X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import type { Schemas } from '../../api/client'
import { useCommitImport, useImportJob, useStartImport } from '../../api/queries'
import { paths } from '../../app/paths'
import { importCopy as copy } from '../../copy/import'
import { srOnly } from '../../lib/a11y'
import { useNavMode } from '../../shell/layout'
import { PhotosStep } from './PhotosStep'
import { ReviewStep } from './ReviewStep'
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
  const start = useStartImport()
  const commit = useCommitImport()
  const job = useImportJob(stage === 'review' ? jobId : null)

  const checked = stage === 'review' && job.data?.status === 'ready' ? job.data : null
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
    setStage('upload')
  }

  const onFile = async (file: File) => {
    commit.reset()
    setDownloaded(false)
    setFileName(file.name)
    try {
      const { job_id } = await start.mutateAsync(file)
      setJobId(job_id)
      setStage('review')
    } catch {
      // Shown in the drop zone from start.error.
    }
  }

  const onCreate = async () => {
    if (!jobId) return
    try {
      const result = await commit.mutateAsync(jobId)
      setCreated(result.products)
      setStage('photos')
    } catch {
      // Shown in the step from commit.error.
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
    content = <ReviewStep job={checked} wide={!phone} creating={commit.isPending} createError={commit.error?.message ?? null} onReplace={toUpload} onCreate={() => void onCreate()} />
  } else {
    // Uploading, checking, or the check could not read the file.
    const failed = stage === 'review' && (job.data?.status === 'failed' ? copy.upload.failed : job.isError ? job.error.message : null)
    const busy = start.isPending ? copy.upload.sending(fileName) : stage === 'review' && !failed ? copy.upload.checking(fileName) : null
    content = (
      <UploadStep
        busy={busy}
        error={failed || (start.error?.message ?? null)}
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
            <Typography id={subtitleId} variant="body1" color="text.secondary" sx={{ mt: 0.5, maxWidth: '68ch' }}>
              {copy.subtitle}
            </Typography>
          </Box>
          <IconButton aria-label={copy.close} onClick={onClose} sx={{ mt: -0.5, mr: -1, width: 44, height: 44, color: neutral.inkSecondary }}>
            <X size={20} strokeWidth={1.5} aria-hidden="true" />
          </IconButton>
        </Stack>
        {phone ? (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
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
