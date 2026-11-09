import { Box, Button, Divider, Link, Stack, Step, StepLabel, Stepper, Typography, type StepIconProps } from '@mui/material'
import { Banner, brand, neutral } from '@shazlo/ui'
import { Check, Clock, Mail, MessageCircle, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link as RouterLink } from 'react-router'
import { ApiError } from '../../api/client'
import { useApply } from '../../api/queries'
import { paths } from '../../app/paths'
import { onboardingCopy } from '../../copy/onboarding'
import { AuthLayout, AuthTitle } from './AuthLayout'
import {
  clearDraft,
  emptyDraft,
  fieldsFromApi,
  fieldsOfStep,
  firstStepWith,
  readDraft,
  toApplication,
  validateDraft,
  withoutStep,
  writeDraft,
  type ApplyDraft,
  type BrandValues,
  type CatalogueValues,
  type ContactValues,
  type FieldMessages,
  type StepIndex,
} from './applyModel'
import { BrandStep, CatalogueStep, ContactStep } from './applySteps'
import { srOnly } from '../../lib/a11y'

const copy = onboardingCopy.apply


// Numbered dots: amber for the current step (the same fill as the main action), brown with a tick once done.
function StepDot({ active, completed, icon }: StepIconProps) {
  return (
    <Box
      component="span"
      aria-hidden="true"
      sx={{
        width: 28,
        height: 28,
        borderRadius: '50%',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '1px solid',
        borderColor: completed || active ? brand.brown : neutral.lineStrong,
        bgcolor: completed ? brand.brown : active ? brand.amber : neutral.surface,
        color: completed ? brand.offWhite : active ? brand.wine : neutral.inkSecondary,
        typography: 'body2',
        lineHeight: 1,
        fontVariantNumeric: 'lining-nums',
      }}
    >
      {completed ? <Check size={16} strokeWidth={1.5} /> : icon}
    </Box>
  )
}

const stepperSx = {
  mb: 4,
  '& .MuiStepConnector-alternativeLabel': { top: 13, left: 'calc(-50% + 22px)', right: 'calc(50% + 22px)' },
  '& .MuiStepConnector-line': { borderColor: neutral.line },
  '& .MuiStepConnector-root.Mui-active .MuiStepConnector-line, & .MuiStepConnector-root.Mui-completed .MuiStepConnector-line': { borderColor: brand.brown },
  '& .MuiStepLabel-label': { fontWeight: 400, color: 'text.secondary' },
  '& .MuiStepLabel-label.MuiStepLabel-alternativeLabel': { mt: 1 },
  '& .MuiStepLabel-label.Mui-active': { fontWeight: 400, color: 'text.primary' },
  '& .MuiStepLabel-label.Mui-completed': { fontWeight: 400, color: 'text.secondary' },
}

function Progress({ step }: { step: StepIndex }) {
  return (
    <Stepper activeStep={step} alternativeLabel aria-label={copy.stepsLabel} sx={stepperSx}>
      {copy.steps.map((s, i) => (
        <Step key={s.label} aria-current={i === step ? 'step' : undefined}>
          <StepLabel slots={{ stepIcon: StepDot }}>
            {s.label}
            {i < step && (
              <Box component="span" sx={srOnly}>
                {copy.stepDone}
              </Box>
            )}
          </StepLabel>
        </Step>
      ))}
    </Stepper>
  )
}

type Received = { name: string; email: string; brand: string }

function NextItem({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <Stack component="li" direction="row" spacing={1.5}>
      <Box sx={{ color: brand.brown, pt: '2px', flexShrink: 0, display: 'flex' }}>
        <Icon size={18} strokeWidth={1.5} aria-hidden="true" />
      </Box>
      <Typography variant="body1" sx={{ overflowWrap: 'anywhere' }}>
        {children}
      </Typography>
    </Stack>
  )
}

function ApplicationReceived({ name, email, brand: brandName }: Received) {
  const r = copy.received
  const ref = useRef<HTMLDivElement>(null)
  // The form this replaces held focus; hand it to the confirmation so it is read out.
  useEffect(() => ref.current?.focus(), [])
  return (
    <Box ref={ref} tabIndex={-1} sx={{ outline: 'none' }}>
      <AuthTitle title={r.title} subtitle={<Box component="span" sx={{ overflowWrap: 'anywhere' }}>{r.subtitle(name, brandName)}</Box>} />
      <Typography variant="h2" component="h2" sx={{ mb: 2 }}>
        {r.nextTitle}
      </Typography>
      <Stack component="ol" spacing={2} sx={{ listStyle: 'none', p: 0, m: 0 }}>
        <NextItem icon={Clock}>{r.review}</NextItem>
        <NextItem icon={Mail}>{r.approved(email)}</NextItem>
        <NextItem icon={MessageCircle}>
          {r.questions} <Link href={`mailto:${onboardingCopy.partnersEmail}`}>{onboardingCopy.partnersEmail}</Link>.
        </NextItem>
      </Stack>
      <Divider sx={{ my: 4 }} />
      <Button variant="outlined" size="large" component={RouterLink} to={paths.signIn} sx={{ minHeight: 44 }}>
        {r.backToSignIn}
      </Button>
    </Box>
  )
}

// What a step sees when it (re)mounts: messages to show and where focus goes.
type Arrival = { errors: FieldMessages; focus: 'heading' | 'field' | null; round: number }

export default function Apply() {
  const [restoredDraft] = useState(readDraft)
  const [draft, setDraft] = useState<ApplyDraft>(restoredDraft ?? emptyDraft)
  const [restored, setRestored] = useState(restoredDraft !== null)
  const [arrival, setArrival] = useState<Arrival>({ errors: {}, focus: null, round: 0 })
  const [failure, setFailure] = useState<string | null>(null)
  const [received, setReceived] = useState<Received | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const apply = useApply()
  const { step } = draft

  // Options board pick: each step is saved. The draft lives on this device until it is sent.
  useEffect(() => writeDraft(draft), [draft])

  useEffect(() => {
    if (arrival.focus === 'heading') heading.current?.focus()
  }, [arrival])

  // Keystrokes go straight to this device; React state only changes between steps.
  const save = useMemo(
    () => ({
      brand: (brand: BrandValues) => writeDraft({ ...draft, brand }),
      contact: (contact: ContactValues) => writeDraft({ ...draft, contact }),
      catalogue: (catalogue: CatalogueValues) => writeDraft({ ...draft, catalogue }),
    }),
    [draft],
  )

  function goTo(next: StepIndex, patch: Partial<ApplyDraft>, errors: FieldMessages, focus: Arrival['focus'] = 'heading') {
    setDraft((d) => ({ ...d, ...patch, step: next }))
    setArrival((a) => ({ errors, focus, round: a.round + 1 }))
  }

  function move(next: StepIndex, patch: Partial<ApplyDraft>, settled?: StepIndex) {
    setFailure(null)
    goTo(next, patch, settled === undefined ? arrival.errors : withoutStep(settled, arrival.errors))
  }

  function startOver() {
    clearDraft()
    setRestored(false)
    setFailure(null)
    goTo(0, emptyDraft, {})
  }

  function send(catalogue: CatalogueValues) {
    const full: ApplyDraft = { ...draft, catalogue }
    setFailure(null)
    setDraft(full)
    const problems = validateDraft(full)
    const stale = firstStepWith(problems)
    if (stale !== null) {
      goTo(stale, {}, problems, 'field')
      return
    }
    apply.mutate(toApplication(full), {
      onSuccess: () => {
        clearDraft()
        setDraft(emptyDraft)
        setRestored(false)
        setReceived({ name: full.contact.owner_name.trim().split(/\s+/)[0] ?? '', email: full.contact.email.trim(), brand: full.brand.brand_name.trim() })
      },
      onError: (error) => {
        setFailure(error instanceof ApiError ? error.message : copy.failed)
        const fields = error instanceof ApiError && error.status === 422 ? fieldsFromApi(error.fields) : {}
        const target = firstStepWith(fields)
        if (target !== null) goTo(target, {}, fields, 'field')
      },
    })
  }

  if (received) {
    return (
      <AuthLayout width={560}>
        <ApplicationReceived {...received} />
      </AuthLayout>
    )
  }

  const meta = copy.steps[step]
  // A fresh form on every arrival, so it starts from the saved draft.
  const key = `${step}-${arrival.round}`
  const shared = { errors: fieldsOfStep(step, arrival.errors), focusErrors: arrival.focus === 'field' }

  return (
    <AuthLayout width={560}>
      <AuthTitle title={copy.title} subtitle={copy.subtitle} />
      {restored && (
        <Box sx={{ mb: 3 }}>
          <Banner
            tone="info"
            title={copy.restored.title}
            action={
              <Button size="small" onClick={startOver} sx={{ minHeight: { xs: 44, md: 'auto' } }}>
                {copy.restored.startOver}
              </Button>
            }
          >
            {copy.restored.body}
          </Banner>
        </Box>
      )}
      <Progress step={step} />
      <Typography ref={heading} tabIndex={-1} variant="h2" component="h2" sx={{ outline: 'none' }}>
        {meta.heading}
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mt: 0.5, mb: 3 }}>
        {meta.intro}
      </Typography>
      {failure && (
        <Box sx={{ mb: 2.5 }}>
          <Banner tone="error" title={failure} />
        </Box>
      )}
      {step === 0 && <BrandStep {...shared} key={key} values={draft.brand} onChange={save.brand} onNext={(brand) => move(1, { brand }, 0)} />}
      {step === 1 && (
        <ContactStep
          {...shared}
          key={key}
          values={draft.contact}
          onChange={save.contact}
          onBack={(contact) => move(0, { contact })}
          onNext={(contact) => move(2, { contact }, 1)}
        />
      )}
      {step === 2 && (
        <CatalogueStep {...shared} key={key} values={draft.catalogue} onChange={save.catalogue} onBack={(catalogue) => move(1, { catalogue })} onNext={send} pending={apply.isPending} />
      )}
      {step === 0 && (
        <>
          <Divider sx={{ my: 3 }} />
          <Typography variant="body1" color="text.secondary">
            {copy.signInPrompt}{' '}
            <Link component={RouterLink} to={paths.signIn}>
              {copy.signIn}
            </Link>
          </Typography>
        </>
      )}
    </AuthLayout>
  )
}
