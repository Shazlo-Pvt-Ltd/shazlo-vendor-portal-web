import { Box, Button, Link, Skeleton, Stack, Typography } from '@mui/material'
import { Banner, PageHeader } from '@shazlo/ui'
import { ChevronLeft } from 'lucide-react'
import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link as RouterLink, useNavigate, useParams } from 'react-router'
import { ApiError } from '../../api/errors'
import type { Schemas } from '../../api/model'
import { useIfsc, useSaveStoreSection, useStoreDetails } from '../../api/queries'
import { useCrumb } from '../../app/crumbs'
import { paths } from '../../app/paths'
import { storeCopy as copy } from '../../copy/store'
import { FORM_MAX_WIDTH, useNavMode } from '../../shell/layout'
import { StickyFooter } from '../../shell/StickyFooter'
import { ErrorSummary, touch } from './topics/controls'
import { TopicFields } from './topics/forms'
import { answersFrom, checkTopic, FIELD_ORDER, hasErrors, isTopic, placesOf, sectionBody, TOPIC_TITLES, unknownIfsc, type Topic, type TopicAnswers } from './topics/model'
import { payoutLine } from './topics/summary'
import { useFormErrors } from './topics/useFormErrors'

// What the summary page shows after a save (in the page, never a toast).
export type SavedState = { saved: Topic; wasIncomplete: boolean }

// Store details › one topic (spec §5): the same fields as sign-up, with Save instead of Continue.
// On phones it is a full-screen task (the route says so): Back in the top bar, Save in a sticky footer.
export function StoreSectionPage() {
  const { section } = useParams()
  const topic = isTopic(section) ? section : null
  useCrumb(topic ? TOPIC_TITLES[topic] : null)
  const details = useStoreDetails()

  if (!topic) return <UnknownSection />
  if (details.data) return <SectionForm key={topic} topic={topic} details={details.data} />
  if (details.isError) {
    return (
      <Frame>
        <PageHeader title={TOPIC_TITLES[topic]} />
        <Banner
          tone="error"
          title={copy.page.loadError}
          action={
            <Button variant="outlined" onClick={() => void details.refetch()} disabled={details.isFetching} sx={touch}>
              {copy.page.retry}
            </Button>
          }
        >
          {details.error.message}
        </Banner>
      </Frame>
    )
  }
  return (
    <Frame>
      <PageHeader title={TOPIC_TITLES[topic]} />
      <Stack role="status" aria-label={copy.page.loading} aria-busy="true" spacing={3}>
        {[0, 1, 2].map((i) => (
          <Box key={i}>
            <Skeleton variant="text" width={160} />
            <Skeleton variant="rounded" height={56} />
          </Box>
        ))}
      </Stack>
    </Frame>
  )
}

// Forms are one column, at most 680 px: centred on tablets, on the left beside the desktop sidebar.
function Frame({ children, onSubmit }: { children: ReactNode; onSubmit?: (e: FormEvent) => void }) {
  const mode = useNavMode()
  return (
    <Box component={onSubmit ? 'form' : 'div'} noValidate={onSubmit ? true : undefined} onSubmit={onSubmit} sx={{ maxWidth: FORM_MAX_WIDTH, mx: mode === 'tablet' ? 'auto' : 0 }}>
      {/* Phones have Back in the top bar. */}
      {mode !== 'phone' && (
        <Link component={RouterLink} to={paths.storeDetails} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, minHeight: 44, mb: 1, typography: 'body1' }}>
          <ChevronLeft size={18} strokeWidth={1.75} aria-hidden="true" />
          {copy.section.back}
        </Link>
      )}
      {children}
    </Box>
  )
}

function UnknownSection() {
  return (
    <Frame>
      <PageHeader title={copy.section.unknownTitle} subtitle={copy.section.unknownBody} />
      <Button variant="outlined" component={RouterLink} to={paths.storeDetails} sx={touch}>
        {copy.section.back}
      </Button>
    </Frame>
  )
}

function SectionForm({ topic, details }: { topic: Topic; details: Schemas['StoreDetails'] }) {
  const navigate = useNavigate()
  const save = useSaveStoreSection()
  const [answers, setAnswers] = useState<TopicAnswers>(() => answersFrom(details))
  const [failure, setFailure] = useState<string | null>(null)
  const form = useFormErrors(FIELD_ORDER[topic])
  // Saved once: a second press before the page moves on (isPending is a render late) sends nothing.
  const saving = useRef(false)
  const payout = answers.payout
  const ifsc = useIfsc(topic === 'payout' && payout.method === 'bank' ? payout.ifsc : null)

  const change = (next: TopicAnswers[Topic]) => {
    setAnswers((all) => ({ ...all, [topic]: next }))
    form.settle(checkTopic(topic, next), next)
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setFailure(null)
    const values = answers[topic]
    const problems = checkTopic(topic, values)
    const lookup = topic === 'payout' && payout.method === 'bank' && !problems.ifsc ? unknownIfsc(ifsc.error) : {}
    if (hasErrors(problems) || hasErrors(lookup)) {
      form.show(problems, lookup, values)
      return
    }
    if (saving.current) return
    saving.current = true
    if (topic === 'delivery') {
      // A place typed but not added is added now, so the form shows what was saved if the save fails.
      const d = answers.delivery
      setAnswers((all) => ({ ...all, delivery: { ...d, areas: { ...d.areas, places: d.areas.all_india === false ? placesOf(d) : d.areas.places }, place: '' } }))
    }
    save.mutate(sectionBody(topic, answers), {
      onSuccess: () => navigate(paths.storeDetails, { state: { saved: topic, wasIncomplete: !details.complete } satisfies SavedState }),
      onError: (error) => {
        saving.current = false
        if (error instanceof ApiError && error.status === 422 && hasErrors(error.fields)) {
          form.show({}, error.fields, values)
          return
        }
        setFailure(error instanceof ApiError ? error.message : copy.section.failed)
      },
    })
  }

  return (
    <Frame onSubmit={onSubmit}>
      <PageHeader title={TOPIC_TITLES[topic]} subtitle={copy.section.intro[topic]} />
      {failure && (
        <Box sx={{ mb: 3 }}>
          <Banner tone="error" title={failure} />
        </Box>
      )}
      <ErrorSummary errors={form.ordered} />
      {topic === 'payout' && details.payout && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="body2" color="text.secondary">
            {copy.payout.current}
          </Typography>
          <Typography variant="body1" sx={{ mt: 0.25 }}>
            {payoutLine(details.payout)}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {copy.payout.changeNote}
          </Typography>
        </Box>
      )}
      <TopicFields topic={topic} values={answers[topic]} onChange={change} errors={form.errors} />
      <StickyFooter>
        <Button type="submit" variant="contained" size="large" disabled={save.isPending} sx={touch}>
          {save.isPending ? copy.section.saving : copy.section.save}
        </Button>
      </StickyFooter>
    </Frame>
  )
}

export default StoreSectionPage
