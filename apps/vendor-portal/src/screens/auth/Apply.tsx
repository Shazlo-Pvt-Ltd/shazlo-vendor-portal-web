import { Box, Link } from '@mui/material'
import { Banner } from '@shazlo/ui'
import { useEffect, useRef, useState } from 'react'
import { Link as RouterLink } from 'react-router'
import { ApiError } from '../../api/errors'
import { useIfsc, useSignUp } from '../../api/queries'
import { paths } from '../../app/paths'
import { onboardingCopy } from '../../copy/onboarding'
import { failureOf } from '../../lib/failure'
import type { FieldErrors } from '../../lib/storeDetails'
import { registerSensitiveReset } from '../../security/sensitiveState'
import { useCountdown } from '../../session/useCountdown'
import { fieldId, hasErrors, unknownIfsc } from '../store/topics/model'
import { useFormErrors } from '../store/topics/useFormErrors'
import { AuthLayout } from './AuthLayout'
import {
  CHECK,
  checkStep,
  clearDraft,
  emptyDraft,
  firstProblem,
  INTRO,
  isStep,
  orderOfStep,
  problemsByStep,
  readDraft,
  settleDelivery,
  STEP_COUNT,
  toApplication,
  valuesOfStep,
  writeDraft,
  type ApplyDraft,
} from './applyModel'
import { ApplicationReceived, CheckAnswersPage, IntroPage, Restored, StepPage, type Received } from './applySteps'

const copy = onboardingCopy.apply

// Where focus goes on a new page: its heading, the error summary, or an answer picked on Check
// your answers.
type Arrival = { round: number; target: 'heading' | 'summary' | { field: string } }

// A Change link on Check your answers names a row; this is the input it opens on.
const FIELD_OF_ROW: Record<string, string> = { pickup_address: 'pickup_address.line1' }

// V-02 Apply to sell (spec §5): an intro, one topic per page with Continue, Check your answers,
// Send application, then "confirm your email". Answers are checked on Continue only. They are
// kept in memory while the tab is open (src/session/drafts.ts), never the password or the bank
// account number. Sending creates the account (POST /v1/auth/signup with the store details).
export default function Apply() {
  const [restoredDraft] = useState(readDraft)
  const [draft, setDraft] = useState<ApplyDraft>(() => restoredDraft ?? emptyDraft())
  const [restored, setRestored] = useState(restoredDraft !== null)
  const [failure, setFailure] = useState<string | null>(null)
  // The API said the email already has an account (409).
  const [taken, setTaken] = useState<string | null>(null)
  const [received, setReceived] = useState<Received | null>(null)
  // Server messages for steps after the one being fixed: shown when the seller gets there.
  const [later, setLater] = useState<Map<number, FieldErrors>>(() => new Map())
  const [arrival, setArrival] = useState<Arrival>({ round: 0, target: 'heading' })
  const heading = useRef<HTMLHeadingElement>(null)
  // A second tap on Send while the first is on its way sends nothing.
  const sending = useRef(false)
  const signUp = useSignUp()
  const wait = useCountdown()
  const { page } = draft
  const form = useFormErrors(isStep(page) ? orderOfStep(page) : [])
  const ifsc = useIfsc(draft.payout.method === 'bank' ? draft.payout.ifsc : null)

  useEffect(() => writeDraft(draft), [draft])

  // The password and account number never outlive the session (nor this page: they are not kept).
  useEffect(
    () =>
      registerSensitiveReset(() =>
        setDraft((d) => ({ ...d, password: '', payout: { ...d.payout, account_number: '', account_number_again: '' } })),
      ),
    [],
  )

  useEffect(() => {
    // The summary focuses itself (useFormErrors).
    if (arrival.round === 0 || arrival.target === 'summary') return
    const field = typeof arrival.target === 'object' ? document.getElementById(fieldId(arrival.target.field)) : null
    if (field) field.focus()
    else heading.current?.focus()
  }, [arrival])

  function go(next: number, { patch, client = {}, server = {}, field }: { patch?: Partial<ApplyDraft>; client?: FieldErrors; server?: FieldErrors; field?: string } = {}) {
    const nextDraft = { ...draft, ...patch, page: next }
    setDraft(nextDraft)
    setFailure(null)
    setTaken(null)
    if (page !== next) setRestored(false)
    const waiting = { ...later.get(next), ...server }
    if (later.has(next)) {
      setLater((m) => {
        const copyOf = new Map(m)
        copyOf.delete(next)
        return copyOf
      })
    }
    window.scrollTo(0, 0)
    if (isStep(next) && (hasErrors(client) || hasErrors(waiting))) {
      form.show(client, waiting, valuesOfStep(next, nextDraft))
      setArrival((a) => ({ round: a.round + 1, target: 'summary' }))
    } else {
      form.clear()
      setArrival((a) => ({ round: a.round + 1, target: field ? { field } : 'heading' }))
    }
  }

  function update<K extends keyof ApplyDraft>(key: K, value: ApplyDraft[K]) {
    const next = { ...draft, [key]: value }
    setDraft(next)
    form.settle(checkStep(page, next), valuesOfStep(page, next))
  }

  function onContinue() {
    const problems = checkStep(page, draft)
    // A well-formed IFSC that belongs to no bank: say so now rather than after Send.
    const lookup = page === 6 && draft.payout.method === 'bank' && !problems.ifsc ? unknownIfsc(ifsc.error) : {}
    if (hasErrors(problems) || hasErrors(lookup)) {
      form.show(problems, lookup, valuesOfStep(page, draft))
      return
    }
    const patch = page === 3 ? { delivery: settleDelivery(draft.delivery) } : undefined
    const waiting = [...later.keys()].filter((s) => s > page).sort((a, b) => a - b)[0]
    go(waiting ?? (draft.checking || page === STEP_COUNT ? CHECK : page + 1), { patch })
  }

  function onBack() {
    if (page === CHECK) go(STEP_COUNT)
    else if (draft.checking) go(CHECK)
    else go(page - 1)
  }

  function startOver() {
    clearDraft()
    setLater(new Map())
    go(INTRO, { patch: emptyDraft() })
    setRestored(false)
  }

  async function send() {
    if (sending.current || wait.active) return
    setFailure(null)
    setTaken(null)
    // Every step again: a kept draft has no password or account number, and may have skipped a step.
    const problem = firstProblem(draft)
    if (problem) {
      go(problem.step, { patch: { checking: true }, client: problem.errors })
      return
    }
    const application = toApplication(draft)
    sending.current = true
    try {
      await signUp.mutateAsync(application)
      clearDraft()
      setReceived({ name: draft.contact.name.trim().split(/\s+/)[0] ?? '', email: application.email, brand: application.brand_name })
      setDraft(emptyDraft())
    } catch (error) {
      const byStep = problemsByStep(error)
      if (byStep.size > 0) {
        // Start with the earliest step; the others wait until the seller gets to them.
        const first = Math.min(...byStep.keys())
        const rest = new Map(byStep)
        rest.delete(first)
        setLater(rest)
        go(first, { patch: { checking: true }, server: byStep.get(first) })
        return
      }
      if (error instanceof ApiError && error.status === 409) {
        setTaken(application.email)
        return
      }
      const { message, retryAfter } = failureOf(error)
      // "Too many attempts" is said once, by the countdown. A 422 about nothing the pages show has no plain words to pass on.
      if (retryAfter) wait.start(retryAfter)
      else setFailure(error instanceof ApiError && error.status === 422 ? (error.fields._form ?? copy.failed) : message)
    } finally {
      sending.current = false
      // What was sent (the password, the account number) leaves the mutation.
      signUp.reset()
    }
  }

  if (received) {
    return (
      <AuthLayout task>
        <ApplicationReceived {...received} />
      </AuthLayout>
    )
  }

  const notice = (
    <>
      {restored && <Restored onStartOver={startOver} />}
      {taken && (
        <Box sx={{ mb: 3 }}>
          <Banner
            tone="error"
            title={<Box component="span" sx={{ overflowWrap: 'anywhere' }}>{copy.taken.title(taken)}</Box>}
            action={
              <Link component={RouterLink} to={paths.signIn} sx={{ display: 'inline-flex', alignItems: 'center', minHeight: 44 }}>
                {copy.taken.signIn}
              </Link>
            }
          >
            {copy.taken.body}
          </Banner>
        </Box>
      )}
      {failure && (
        <Box sx={{ mb: 3 }}>
          <Banner tone="error" title={failure} />
        </Box>
      )}
    </>
  )

  return (
    <AuthLayout task>
      {page === INTRO && <IntroPage headingRef={heading} notice={notice} onStart={() => go(1)} />}
      {isStep(page) && (
        <StepPage
          key={page}
          step={page}
          draft={draft}
          headingRef={heading}
          errors={form.errors}
          ordered={form.ordered}
          notice={notice}
          onChange={update}
          onBack={onBack}
          onContinue={onContinue}
        />
      )}
      {page === CHECK && (
        <CheckAnswersPage
          draft={draft}
          bankName={ifsc.data?.bank}
          headingRef={heading}
          notice={notice}
          pending={signUp.isPending}
          waitSeconds={wait.remaining}
          onBack={onBack}
          onChange={(step, row) => go(step, { patch: { checking: true }, field: FIELD_OF_ROW[row] ?? row })}
          onSend={() => void send()}
        />
      )}
    </AuthLayout>
  )
}
