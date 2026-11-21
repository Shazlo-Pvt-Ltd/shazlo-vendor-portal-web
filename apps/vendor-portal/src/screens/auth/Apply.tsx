import { Box } from '@mui/material'
import { Banner } from '@shazlo/ui'
import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import { useApply, useIfsc } from '../../api/queries'
import { onboardingCopy } from '../../copy/onboarding'
import type { FieldErrors } from '../../lib/storeDetails'
import { fieldId, hasErrors, unknownIfsc } from '../store/topics/model'
import { useFormErrors } from '../store/topics/useFormErrors'
import { AuthLayout } from './AuthLayout'
import {
  CHECK,
  checkStep,
  clearDraft,
  emptyDraft,
  errorsByStep,
  firstProblem,
  INTRO,
  isStep,
  orderOfStep,
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
// Send application, then what happens next. Answers are checked on Continue only, and saved on
// this device as the seller types (except the bank account number).
export default function Apply() {
  const [restoredDraft] = useState(readDraft)
  const [draft, setDraft] = useState<ApplyDraft>(() => restoredDraft ?? emptyDraft())
  const [restored, setRestored] = useState(restoredDraft !== null)
  const [failure, setFailure] = useState<string | null>(null)
  const [received, setReceived] = useState<Received | null>(null)
  // Server messages for steps after the one being fixed: shown when the seller gets there.
  const [later, setLater] = useState<Map<number, FieldErrors>>(() => new Map())
  const [arrival, setArrival] = useState<Arrival>({ round: 0, target: 'heading' })
  const heading = useRef<HTMLHeadingElement>(null)
  const apply = useApply()
  const { page } = draft
  const form = useFormErrors(isStep(page) ? orderOfStep(page) : [])
  const ifsc = useIfsc(draft.payout.method === 'bank' ? draft.payout.ifsc : null)

  useEffect(() => writeDraft(draft), [draft])

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

  function send() {
    setFailure(null)
    // Every step again: a restored draft has no account number, and may have skipped a step.
    const problem = firstProblem(draft)
    if (problem) {
      go(problem.step, { patch: { checking: true }, client: problem.errors })
      return
    }
    const application = toApplication(draft)
    apply.mutate(application, {
      onSuccess: () => {
        clearDraft()
        setReceived({ name: draft.contact.name.trim().split(/\s+/)[0] ?? '', email: application.email, brand: application.brand_name })
        setDraft(emptyDraft())
      },
      onError: (error) => {
        const byStep = error instanceof ApiError && error.status === 422 ? errorsByStep(error.fields) : new Map<number, FieldErrors>()
        if (byStep.size > 0) {
          // Start with the earliest step; the others wait until the seller gets to them.
          const first = Math.min(...byStep.keys())
          const rest = new Map(byStep)
          rest.delete(first)
          setLater(rest)
          go(first, { patch: { checking: true }, server: byStep.get(first) })
          return
        }
        setFailure(error instanceof ApiError ? error.message : copy.failed)
      },
    })
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
          pending={apply.isPending}
          onBack={onBack}
          onChange={(step, row) => go(step, { patch: { checking: true }, field: FIELD_OF_ROW[row] ?? row })}
          onSend={send}
        />
      )}
    </AuthLayout>
  )
}
