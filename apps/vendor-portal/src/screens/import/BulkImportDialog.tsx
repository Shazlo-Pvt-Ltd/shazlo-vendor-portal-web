import { Box, Button, Dialog, DialogActions, DialogContent, IconButton, Stack, Step, StepLabel, Stepper, Typography, useMediaQuery } from '@mui/material'
import { type Theme } from '@mui/material/styles'
import { neutral, status } from '@shazlo/ui'
import { CheckCircle2, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useCommitImport, useImportJob, useStartImport } from '../../api/queries'
import { paths } from '../../app/paths'
import { importCopy as copy } from '../../copy/import'
import { actionsSx } from './layout'
import { ReviewStep } from './ReviewStep'
import { TemplateStep } from './TemplateStep'
import { UploadStep } from './UploadStep'

type Stage = 'template' | 'upload' | 'review' | 'done'

function DoneStep({ created, onViewDrafts, onClose }: { created: number; onViewDrafts: () => void; onClose: () => void }) {
  return (
    <>
      <DialogContent>
        <Stack spacing={1.5} sx={{ alignItems: 'center', textAlign: 'center', py: { xs: 4, sm: 6 } }}>
          <Box sx={{ color: status.success, display: 'flex' }}>
            <CheckCircle2 size={32} strokeWidth={1.5} aria-hidden="true" />
          </Box>
          <Typography variant="h1" component="h3">
            {copy.done.title(created)}
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ maxWidth: '46ch' }}>
            {copy.done.body}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={actionsSx}>
        <Button variant="outlined" onClick={onClose}>
          {copy.done.close}
        </Button>
        <Button variant="contained" onClick={onViewDrafts}>
          {copy.done.viewDrafts}
        </Button>
      </DialogActions>
    </>
  )
}

// V-08: the import wizard in a dialog over Products (options board pick). Full screen on phones.
export function BulkImportDialog({ onClose }: { onClose: () => void }) {
  const wide = useMediaQuery((t: Theme) => t.breakpoints.up('md'))
  const navigate = useNavigate()
  const titleId = useId()
  const subtitleId = useId()
  const body = useRef<HTMLDivElement>(null)

  const [stage, setStage] = useState<Stage>('template')
  const [fileName, setFileName] = useState('')
  const [jobId, setJobId] = useState<string | null>(null)
  const [created, setCreated] = useState(0)
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
    setStage('upload')
  }

  const onFile = async (file: File) => {
    commit.reset()
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
      setCreated(result.created)
      setStage('done')
    } catch {
      // Shown in the step from commit.error.
    }
  }

  let content
  if (stage === 'template') {
    content = <TemplateStep onNext={() => setStage('upload')} />
  } else if (stage === 'done') {
    content = <DoneStep created={created} onClose={onClose} onViewDrafts={() => navigate({ pathname: paths.products, search: '?status=draft' })} />
  } else if (checked) {
    content = <ReviewStep job={checked} wide={wide} creating={commit.isPending} createError={commit.error?.message ?? null} onReplace={toUpload} onCreate={() => void onCreate()} />
  } else {
    // Uploading, checking, or the check could not read the file.
    const failed = stage === 'review' && (job.data?.status === 'failed' ? copy.upload.failed : job.isError ? job.error.message : null)
    const busy = start.isPending ? copy.upload.sending(fileName) : stage === 'review' && !failed ? copy.upload.checking(fileName) : null
    content = <UploadStep busy={busy} error={failed || (start.error?.message ?? null)} onFile={(file) => void onFile(file)} onBack={() => setStage('template')} />
  }

  return (
    <Dialog
      open
      onClose={(_, reason) => {
        // A stray click outside should not throw away a checked file.
        if (reason !== 'backdropClick') onClose()
      }}
      fullScreen={!wide}
      fullWidth
      maxWidth="md"
      scroll="paper"
      aria-labelledby={titleId}
      aria-describedby={subtitleId}
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
          <IconButton aria-label={copy.close} onClick={onClose} sx={{ mt: -0.5, mr: -1, color: neutral.inkSecondary }}>
            <X size={20} strokeWidth={1.5} aria-hidden="true" />
          </IconButton>
        </Stack>
        {wide ? (
          <Stepper activeStep={active} sx={{ mt: 3 }}>
            {copy.steps.map((label) => (
              <Step key={label}>
                <StepLabel>{label}</StepLabel>
              </Step>
            ))}
          </Stepper>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            {copy.stepOf(active + 1, copy.steps.length, stepLabel)}
          </Typography>
        )}
        <Box role="status" sx={{ position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>
          {wide ? copy.stepOf(active + 1, copy.steps.length, stepLabel) : ''}
        </Box>
      </Box>
      <Box ref={body} tabIndex={-1} sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1, outline: 'none' }}>
        {content}
      </Box>
    </Dialog>
  )
}

export default BulkImportDialog
