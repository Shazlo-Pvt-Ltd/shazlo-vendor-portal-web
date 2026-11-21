import { Box, Button, Divider, Link, Stack, Typography } from '@mui/material'
import { Banner, brand } from '@shazlo/ui'
import { Clock, Handshake, MessageCircle, type LucideIcon } from 'lucide-react'
import { forwardRef, useEffect, useRef, type FormEvent, type ReactNode, type Ref } from 'react'
import { Link as RouterLink } from 'react-router'
import { paths } from '../../app/paths'
import { catalogCopy } from '../../copy/catalog'
import { onboardingCopy } from '../../copy/onboarding'
import { storeCopy } from '../../copy/store'
import { PASSWORD_MAX, PASSWORD_MIN } from '../../lib/account'
import { maskPayout } from '../../lib/storeDetails'
import { PasswordField } from '../../security/PasswordField'
import { ErrorSummary } from '../store/topics/controls'
import { BusinessFields, TermsFields, TopicFields } from '../store/topics/forms'
import { businessBody, contactBody, deliveryBody, fieldId, paymentBody, payoutBody, proposedBps, returnsBody, type Topic } from '../store/topics/model'
import { brandRows, businessRows, contactRows, deliveryRows, paymentRows, payoutRows, returnsRows, SummaryList, termsRows, type Row } from '../store/topics/summary'
import { BackButton, TaskFooter } from './AuthLayout'
import { STEP_COUNT, STEP_TOPICS, type ApplyDraft } from './applyModel'
import { ResendEmail } from './ResendEmail'
import { WaitBanner } from './WaitBanner'
import { ignoreRepeatClick } from '../../lib/clicks'

const copy = onboardingCopy.apply

// ---- page furniture -----------------------------------------------------------------------------

export const PageTitle = forwardRef<HTMLHeadingElement, { children: ReactNode }>(function PageTitle({ children }, ref) {
  return (
    <Typography
      ref={ref}
      tabIndex={-1}
      variant="pageTitle"
      component="h1"
      sx={{ fontSize: { xs: '1.75rem', sm: '2.25rem' }, lineHeight: 1.15, textWrap: 'balance', overflowWrap: 'anywhere', outline: 'none' }}
    >
      {children}
    </Typography>
  )
})

export function Restored({ onStartOver }: { onStartOver: () => void }) {
  return (
    <Box sx={{ mb: 3 }}>
      <Banner
        tone="info"
        title={copy.restored.title}
        action={
          <Button size="small" onClick={onStartOver} sx={{ minHeight: 44 }}>
            {copy.restored.startOver}
          </Button>
        }
      >
        {copy.restored.body}
      </Banner>
    </Box>
  )
}

function SignInLine() {
  return (
    <Typography variant="body1" color="text.secondary">
      {copy.signInPrompt}{' '}
      <Link component={RouterLink} to={paths.signIn} sx={{ display: 'inline-flex', alignItems: 'center', minHeight: 44 }}>
        {copy.signIn}
      </Link>
    </Typography>
  )
}

// ---- before step 1 -------------------------------------------------------------------------------

export function IntroPage({ headingRef, notice, onStart }: { headingRef: Ref<HTMLHeadingElement>; notice?: ReactNode; onStart: () => void }) {
  const i = copy.intro
  return (
    <>
      <PageTitle ref={headingRef}>{copy.title}</PageTitle>
      <Typography variant="body1" color="text.secondary" sx={{ mt: 1.5, mb: 3 }}>
        {i.subtitle}
      </Typography>
      {notice}
      <Typography variant="h2" component="h2" sx={{ mb: 1.5 }}>
        {i.needTitle}
      </Typography>
      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
        {i.need.map((item) => (
          <Typography component="li" variant="body1" key={item} sx={{ py: 0.5 }}>
            {item}
          </Typography>
        ))}
      </Box>
      <Typography variant="body1" color="text.secondary" sx={{ mt: 2.5 }}>
        {i.saved}
      </Typography>
      <Divider sx={{ my: 3 }} />
      <SignInLine />
      <TaskFooter>
        <Button variant="contained" size="large" onClick={(event) => event.detail > 1 || onStart()} sx={{ minHeight: 44 }}>
          {i.start}
        </Button>
      </TaskFooter>
    </>
  )
}

// ---- one topic per page ----------------------------------------------------------------------------

type StepPageProps = {
  step: number
  draft: ApplyDraft
  headingRef: Ref<HTMLHeadingElement>
  errors: Record<string, string>
  ordered: readonly [string, string][]
  notice?: ReactNode
  onChange: <K extends keyof ApplyDraft>(key: K, value: ApplyDraft[K]) => void
  onBack: () => void
  onContinue: () => void
}

export function StepPage({ step, draft, headingRef, errors, ordered, notice, onChange, onBack, onContinue }: StepPageProps) {
  const meta = copy.steps[step - 1]!
  const topic = STEP_TOPICS[step - 1]!
  const submit = (e: FormEvent) => {
    e.preventDefault()
    onContinue()
  }
  return (
    <>
      <BackButton onClick={onBack} label={copy.back} />
      <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
        {copy.stepOf(step, STEP_COUNT)}
      </Typography>
      <PageTitle ref={headingRef}>{meta.title}</PageTitle>
      <Typography variant="body1" color="text.secondary" sx={{ mt: 1, mb: 3 }}>
        {meta.intro}
      </Typography>
      {notice}
      <ErrorSummary errors={ordered} />
      <Box component="form" noValidate onSubmit={submit} aria-label={meta.title}>
        {step === 7 ? (
          <Stack spacing={3}>
            <BusinessFields values={draft.business} onChange={(v) => onChange('business', v)} errors={errors} />
            <TermsFields values={draft.terms} onChange={(v) => onChange('terms', v)} errors={errors} />
          </Stack>
        ) : (
          <>
            <TopicFields
              topic={topic}
              values={draft[topic]}
              onChange={(v) => onChange(topic, v as ApplyDraft[typeof topic])}
              errors={errors}
              storeName="edit"
              accountNote={copy.accountNotKept}
            />
            {step === 2 && <NewPassword value={draft.password} error={errors.password} onChange={(password) => onChange('password', password)} />}
          </>
        )}
        <TaskFooter>
          <Button type="submit" variant="contained" size="large" onClick={ignoreRepeatClick} sx={{ minHeight: 44 }}>
            {copy.next}
          </Button>
        </TaskFooter>
      </Box>
    </>
  )
}

// The Contact step's password (main's rules, src/lib/account.ts). Its id lets the error summary
// and Check your answers' Change link reach it.
function NewPassword({ value, error, onChange }: { value: string; error?: string; onChange: (value: string) => void }) {
  return (
    <Box sx={{ mt: 3 }}>
      <PasswordField
        purpose="new"
        id={fieldId('password')}
        name="password"
        label={copy.password}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        error={Boolean(error)}
        helperText={error ?? copy.passwordHint(PASSWORD_MIN)}
        fullWidth
        sx={{ '& .MuiInputBase-input': { fontSize: '1rem' } }}
        // Room for more than the rule allows, so a pasted password that is too long is named, not cut short.
        slotProps={{ htmlInput: { maxLength: PASSWORD_MAX * 2 } }}
      />
    </Box>
  )
}

// ---- Check your answers --------------------------------------------------------------------------------

function topicRows(topic: Topic, a: ApplyDraft, bankName: string | undefined): Row[] {
  switch (topic) {
    case 'brand': return brandRows({ ...a.brand, brand_name: a.brand.brand_name.trim() })
    // The password itself is never shown, only whether one is chosen.
    case 'contact': return [...contactRows(contactBody(a.contact)), { key: 'password', label: copy.passwordRow, value: a.password ? copy.passwordChosen : storeCopy.rows.notAnswered }]
    case 'delivery': return deliveryRows(a.delivery.mode ? deliveryBody(a.delivery) : { mode: '' })
    case 'returns': return returnsRows(returnsBody(a.returns))
    case 'payment': return paymentRows(paymentBody(a.payment))
    case 'payout': {
      const p = a.payout
      if (!p.method || (p.method === 'bank' && !p.account_number.trim()) || (p.method === 'upi' && !p.upi_id.trim())) return payoutRows(null)
      return payoutRows(maskPayout(payoutBody(p), bankName ?? catalogCopy.payoutMethods.bank))
    }
    case 'business': return businessRows(businessBody(a.business))
  }
}

// The Change link opens the step with that answer, focused.
export function CheckAnswersPage({
  draft,
  bankName,
  headingRef,
  notice,
  pending,
  waitSeconds,
  onBack,
  onChange,
  onSend,
}: {
  draft: ApplyDraft
  bankName: string | undefined
  headingRef: Ref<HTMLHeadingElement>
  notice?: ReactNode
  pending: boolean
  // After too many attempts: Send waits this many seconds.
  waitSeconds: number
  onBack: () => void
  onChange: (step: number, field: string) => void
  onSend: () => void
}) {
  return (
    <>
      <BackButton onClick={onBack} label={copy.back} />
      <PageTitle ref={headingRef}>{copy.check.title}</PageTitle>
      <Typography variant="body1" color="text.secondary" sx={{ mt: 1, mb: 3 }}>
        {copy.check.subtitle}
      </Typography>
      {notice}
      {waitSeconds > 0 && (
        <Box sx={{ mb: 3 }}>
          <WaitBanner seconds={waitSeconds} />
        </Box>
      )}
      <Stack spacing={3.5}>
        {copy.steps.map((meta, i) => {
          const step = i + 1
          const topic = STEP_TOPICS[i]!
          const rows =
            step === 7
              ? [
                  ...topicRows('business', draft, bankName),
                  ...termsRows({ proposedBps: proposedBps(draft.terms.commission), agreedTerms: draft.terms.agreed_terms, agreedPriceRule: draft.terms.agreed_price_rule }),
                ]
              : topicRows(topic, draft, bankName)
          return (
            <Box component="section" key={meta.title} aria-labelledby={`check-${step}`}>
              <Typography id={`check-${step}`} variant="h2" component="h2" sx={{ mb: 0.5 }}>
                {meta.title}
              </Typography>
              <SummaryList rows={rows} change={(row) => ({ onClick: () => onChange(step, row.key) })} />
            </Box>
          )
        })}
      </Stack>
      <TaskFooter>
        <Button variant="contained" size="large" onClick={(event) => event.detail > 1 || onSend()} disabled={pending || waitSeconds > 0} sx={{ minHeight: 44 }}>
          {pending ? copy.submitting : copy.submit}
        </Button>
      </TaskFooter>
    </>
  )
}

// ---- sent ------------------------------------------------------------------------------------------------

export type Received = { name: string; email: string; brand: string }

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

// The account exists now, but signing in waits until the email is confirmed (main's "Check your
// email"): say where the link went, and offer it again.
export function ApplicationReceived({ name, email, brand: brandName }: Received) {
  const r = copy.received
  const ref = useRef<HTMLHeadingElement>(null)
  // The page this replaces held focus; hand it to the confirmation so it is read out.
  useEffect(() => ref.current?.focus(), [])
  return (
    <Box>
      <PageTitle ref={ref}>{r.title}</PageTitle>
      <Typography variant="body1" color="text.secondary" sx={{ mt: 1.5, mb: 4, overflowWrap: 'anywhere' }}>
        {r.subtitle(name, brandName)}
      </Typography>
      <Box component="section" aria-labelledby="received-verify" sx={{ mb: 4 }}>
        <Typography id="received-verify" variant="h2" component="h2" sx={{ mb: 1.5 }}>
          {r.verifyTitle}
        </Typography>
        <Typography variant="body1" sx={{ overflowWrap: 'anywhere' }}>
          {r.verify(email)}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2.5 }}>
          {r.verifyHelp}
        </Typography>
        <ResendEmail email={email} />
      </Box>
      <Typography variant="h2" component="h2" sx={{ mb: 2 }}>
        {r.nextTitle}
      </Typography>
      <Stack component="ol" spacing={2} sx={{ listStyle: 'none', p: 0, m: 0 }}>
        <NextItem icon={Clock}>{r.review}</NextItem>
        <NextItem icon={Handshake}>{r.commission}</NextItem>
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
